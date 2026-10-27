-- 0037: the course write queue and its single consumer (workspace v3, A4/A6).
--
-- docs/specs/v3/queue-and-jobs-v3.md. Every commit to a course's working repo
-- is a queue row; one worker per course (fenced lease) commits rows in strict
-- order. Members never write these tables: the web server checks the
-- permission in TypeScript (`can()` in @alembic/package-contract — one matrix,
-- not duplicated in SQL) and inserts with the service role, setting the actor
-- from the verified session. Members may read their course's rows (status).
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: any (no code depends on it yet).

create table public.write_queue (
  id              uuid primary key default gen_random_uuid(),
  package_id      text not null references public.packages (id) on delete cascade,
  seq             bigint generated always as identity,
  kind            text not null check (kind in ('sync', 'changeset', 'outside', 'restore', 'system')),
  actor_id        uuid references public.profiles (id),
  invoker_id      uuid references public.profiles (id),
  pusher_login    text,
  payload         jsonb not null,
  idem_key        text not null,
  priority        smallint not null default 0 check (priority in (0, 1)),
  depends_on      uuid references public.write_queue (id),
  status          text not null default 'queued'
                  check (status in ('queued', 'processing', 'retry', 'done', 'bounced', 'refused', 'failed')),
  attempts        int not null default 0,
  abandons        int not null default 0,   -- reclaimed while 'processing' (worker died); distinct from retries
  planned_shas    text[] not null default '{}', -- commits built for this row, recorded before the ref move
  next_attempt_at timestamptz not null default now(),
  last_error      text,
  result          jsonb,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz,
  unique (package_id, kind, idem_key),
  check (depends_on is null or depends_on <> id),
  check ((kind in ('sync', 'restore') and actor_id is not null)
      or (kind = 'changeset' and invoker_id is not null)
      or kind in ('outside', 'system'))
);
create index write_queue_open_idx on public.write_queue (package_id, priority desc, seq)
  where status in ('queued', 'processing', 'retry');

alter table public.write_queue enable row level security;
revoke all on public.write_queue from anon, authenticated;
grant select on public.write_queue to authenticated;
create policy "members read their course queue" on public.write_queue
  for select to authenticated using ((select public.course_role(package_id)) is not null);

create table public.course_committer (
  package_id  text primary key references public.packages (id) on delete cascade,
  holder      text not null,
  fence       bigint not null default 1,
  lease_until timestamptz not null,
  last_retry_at timestamptz   -- the course's last outage/retry: rows created before it were processed "after an outage"
);
alter table public.course_committer enable row level security;
revoke all on public.course_committer from anon, authenticated;

-- ---------------------------------------------------------------------------
-- queue_insert: the only way in (service role). A repeated key returns the
-- existing row only when kind AND actor match; otherwise it is refused, so a
-- key can't be pre-claimed by someone else (G0 round 3, H2).
-- ---------------------------------------------------------------------------
create function public.queue_insert(
  p_package text, p_kind text, p_idem text, p_payload jsonb,
  p_actor uuid default null, p_invoker uuid default null, p_pusher text default null,
  p_priority smallint default 0, p_depends uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_existing public.write_queue;
begin
  if p_depends is not null and not exists (
    select 1 from public.write_queue where id = p_depends and package_id = p_package
  ) then
    raise exception 'depends_on must be a row of the same course' using errcode = '22023';
  end if;
  -- A front-of-line row can't wait on a row behind it (G2 finding 5).
  if p_depends is not null and p_priority > (select priority from public.write_queue where id = p_depends) then
    raise exception 'a priority row cannot depend on a lower-priority row' using errcode = '22023';
  end if;
  insert into public.write_queue (package_id, kind, idem_key, payload, actor_id, invoker_id, pusher_login, priority, depends_on)
  values (p_package, p_kind, p_kind || ':' || p_idem, p_payload, p_actor, p_invoker, p_pusher, p_priority, p_depends)
  on conflict (package_id, kind, idem_key) do nothing
  returning id into v_id;
  if v_id is not null then return v_id; end if;
  select * into v_existing from public.write_queue
   where package_id = p_package and kind = p_kind and idem_key = p_kind || ':' || p_idem;
  if v_existing.actor_id is distinct from p_actor or v_existing.invoker_id is distinct from p_invoker then
    raise exception 'This change key belongs to someone else' using errcode = '42501';
  end if;
  return v_existing.id;
end $$;

-- ---------------------------------------------------------------------------
-- The lease. committer_acquire takes a free or expired lease (incrementing
-- the fence) or renews the caller's own; returns the fence, or null if
-- another holder has it.
-- ---------------------------------------------------------------------------
create function public.committer_acquire(p_package text, p_holder text, p_seconds int default 60)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v public.course_committer;
begin
  insert into public.course_committer (package_id, holder, fence, lease_until)
  values (p_package, p_holder, 1, now() + make_interval(secs => p_seconds))
  on conflict (package_id) do nothing;
  select * into v from public.course_committer where package_id = p_package for update;
  if v.holder = p_holder and v.lease_until > now() then
    update public.course_committer set lease_until = now() + make_interval(secs => p_seconds) where package_id = p_package;
    return v.fence;
  end if;
  if v.lease_until <= now() or v.holder = p_holder then
    update public.course_committer
       set holder = p_holder, fence = v.fence + 1, lease_until = now() + make_interval(secs => p_seconds)
     where package_id = p_package;
    return v.fence + 1;
  end if;
  return null;
end $$;

create function public.committer_holds(p_package text, p_holder text, p_fence bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.course_committer
                  where package_id = p_package and holder = p_holder and fence = p_fence and lease_until > now())
$$;

-- ---------------------------------------------------------------------------
-- committer_next: the course's next row in strict order (priority desc, seq).
-- If that row is waiting (retry not yet due, or its dependency still open),
-- the course waits: nothing overtakes it. A dependency that ended badly ends
-- the dependent as 'bounced'. Returns the claimed row, marked processing.
-- ---------------------------------------------------------------------------
create function public.committer_next(p_package text, p_holder text, p_fence bigint)
returns setof public.write_queue language plpgsql security definer set search_path = '' as $$
declare r public.write_queue; dep text;
begin
  if not public.committer_holds(p_package, p_holder, p_fence) then
    raise exception 'lease lost' using errcode = '40001';
  end if;
  loop
    select * into r from public.write_queue
     where package_id = p_package and status in ('queued', 'processing', 'retry')
     order by priority desc, seq
     limit 1
     for update;
    if not found then return; end if;
    if r.depends_on is not null then
      select status into dep from public.write_queue where id = r.depends_on;
      if dep in ('bounced', 'refused', 'failed') then
        update public.write_queue
           set status = 'bounced', finished_at = now(),
               result = jsonb_build_object('reason', 'depends on a change that did not land')
         where id = r.id;
        continue;
      end if;
      if dep is distinct from 'done' then return; end if;   -- wait, in order
    end if;
    if r.status = 'retry' and r.next_attempt_at > now() then return; end if;  -- wait, in order
    -- A row reclaimed while 'processing' (worker died, lease lost) counts an
    -- abandonment; the committer decides — after checking whether it landed —
    -- whether to fail it (G2 r2: never fail here, before the landed check).
    if r.status = 'processing' then
      -- A worker died: rows created until now were processed "after an outage" (G2 r3).
      update public.course_committer set last_retry_at = now() where package_id = p_package;
    end if;
    update public.write_queue
       set status = 'processing', attempts = attempts + 1,
           abandons = abandons + (case when r.status = 'processing' then 1 else 0 end)
     where id = r.id
     returning * into r;
    return next r;
    return;
  end loop;
end $$;

-- committer_finish: record a row's outcome — only by the current lease holder.
create function public.committer_finish(
  p_id uuid, p_holder text, p_fence bigint, p_status text,
  p_result jsonb default null, p_error text default null, p_retry_after_seconds int default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_pkg text;
begin
  select package_id into v_pkg from public.write_queue where id = p_id;
  if v_pkg is null or not public.committer_holds(v_pkg, p_holder, p_fence) then
    raise exception 'lease lost' using errcode = '40001';
  end if;
  if p_status not in ('done', 'bounced', 'refused', 'failed', 'retry') then
    raise exception 'bad status %', p_status using errcode = '22023';
  end if;
  -- The outage mark moves on every retry AND when a retried row finally ends,
  -- so every row created during the outage falls before it (G2 r3 MEDIUM).
  if p_status = 'retry' or (select attempts from public.write_queue where id = p_id) > 1 then
    update public.course_committer set last_retry_at = now() where package_id = v_pkg;
  end if;
  update public.write_queue
     set status = p_status,
         result = coalesce(p_result, result),
         last_error = p_error,
         next_attempt_at = case when p_status = 'retry' then now() + make_interval(secs => coalesce(p_retry_after_seconds, 60)) else next_attempt_at end,
         finished_at = case when p_status = 'retry' then null else now() end
   where id = p_id and status = 'processing';
  if not found then raise exception 'row is not being processed' using errcode = '22023'; end if;
end $$;

-- committer_claim_current: is this attempt still the live one? Checked right
-- before every ref move, so an attempt abandoned at its deadline can never
-- commit after the row moved on (G2 r2 HIGH).
create function public.committer_claim_current(p_id uuid, p_holder text, p_fence bigint, p_attempts int)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.write_queue q
     where q.id = p_id and q.status = 'processing' and q.attempts = p_attempts
       and public.committer_holds(q.package_id, p_holder, p_fence)
  )
$$;

-- committer_record_planned: remember the commits built for this attempt
-- before the ref moves; a later attempt treats the row as landed only if one
-- of them is in the branch (G2 r2 design risk: no reliance on commit authors).
create function public.committer_record_planned(p_id uuid, p_holder text, p_fence bigint, p_attempts int, p_shas text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.committer_claim_current(p_id, p_holder, p_fence, p_attempts) then
    raise exception 'claim lost' using errcode = '40001';
  end if;
  -- Re-checked in the update itself, so a reclaim between the check and the
  -- write can't let a superseded attempt append (G2 r3 LOW).
  update public.write_queue set planned_shas = planned_shas || p_shas
   where id = p_id and status = 'processing' and attempts = p_attempts;
  if not found then raise exception 'claim lost' using errcode = '40001'; end if;
end $$;

-- course_role_of: a given user's role (the committer's re-check at execution).
create function public.course_role_of(p text, p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not exists (
      select 1 from auth.users u
       where u.id = p_user and (u.banned_until is null or u.banned_until <= now())
    ) then null
    else (
      select case
        when m.role = 'owner' then 'owner'
        when m.deputy_until is not null and m.deputy_until > now() then 'deputy'
        else 'co-author'
      end
      from public.course_members m
      where m.package_id = p and m.user_id = p_user
    )
  end
$$;
revoke execute on function public.course_role_of(text, uuid) from public, anon, authenticated;
grant execute on function public.course_role_of(text, uuid) to service_role;

revoke execute on function public.committer_claim_current(uuid, text, bigint, int) from public, anon, authenticated;
revoke execute on function public.committer_record_planned(uuid, text, bigint, int, text[]) from public, anon, authenticated;
grant execute on function public.committer_claim_current(uuid, text, bigint, int) to service_role;
grant execute on function public.committer_record_planned(uuid, text, bigint, int, text[]) to service_role;
revoke execute on function public.queue_insert(text, text, text, jsonb, uuid, uuid, text, smallint, uuid) from public, anon, authenticated;
revoke execute on function public.committer_acquire(text, text, int) from public, anon, authenticated;
revoke execute on function public.committer_holds(text, text, bigint) from public, anon, authenticated;
revoke execute on function public.committer_next(text, text, bigint) from public, anon, authenticated;
revoke execute on function public.committer_finish(uuid, text, bigint, text, jsonb, text, int) from public, anon, authenticated;
grant execute on function public.queue_insert(text, text, text, jsonb, uuid, uuid, text, smallint, uuid) to service_role;
grant execute on function public.committer_acquire(text, text, int) to service_role;
grant execute on function public.committer_holds(text, text, bigint) to service_role;
grant execute on function public.committer_next(text, text, bigint) to service_role;
grant execute on function public.committer_finish(uuid, text, bigint, text, jsonb, text, int) to service_role;
