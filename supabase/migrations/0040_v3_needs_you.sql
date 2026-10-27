-- 0040: "Needs you" items (workspace v3, module A10).
--
-- Design §6.3, build spec §18.7, agent-runtime §4.4. One table of items with
-- a life cycle (waiting → shown → answered | obsolete | superseded), a dedupe
-- key so an answered item never comes back for unchanged content, and an
-- origin: the platform may create any kind, the agent only "question".
-- Members read their course's items; answering goes through a definer that
-- checks the role per kind (the matrix in TypeScript decides; here only the
-- coarse role floor is enforced, defence in depth).
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: any.

create table public.needs_you (
  id           uuid primary key default gen_random_uuid(),
  package_id   text not null references public.packages (id) on delete cascade,
  kind         text not null check (kind in (
                 'approve', 'question', 'to-confirm', 'problem', 'review', 'edited-elsewhere',
                 'both-changed', 'suggestion', 'update', 'ready', 'credit', 'method-version', 'reconnect')),
  origin       text not null check (origin in ('platform', 'agent')),
  chapter      text,
  target_path  text,
  dedupe_key   text not null,
  state        text not null default 'waiting' check (state in ('waiting', 'shown', 'answered', 'obsolete', 'superseded')),
  interrupt    boolean not null default false,
  addressed_to uuid[] not null default '{}',
  payload      jsonb not null default '{}',
  answer       jsonb,
  answered_by  uuid references public.profiles (id),
  answered_at  timestamptz,
  shown_at     timestamptz,
  created_at   timestamptz not null default now(),
  -- The agent can only ask questions (agent-runtime §4.4, R-4).
  check (origin = 'platform' or kind = 'question')
);
-- One live item per dedupe key; an answered key never reopens (§18.7).
create unique index needs_you_live on public.needs_you (package_id, dedupe_key)
  where state in ('waiting', 'shown');
create index needs_you_answered on public.needs_you (package_id, dedupe_key) where state = 'answered';

alter table public.needs_you enable row level security;
revoke all on public.needs_you from anon, authenticated;
grant select on public.needs_you to authenticated;
create policy "members read their course items" on public.needs_you
  for select to authenticated using ((select public.course_role(package_id)) is not null);

-- needs_you_raise (service role): create an item unless the same key is live
-- or was already answered. A newer item of a key supersedes the live one when
-- `p_supersede` is set (e.g. a re-proposed course-plan change).
create function public.needs_you_raise(
  p_package text, p_kind text, p_origin text, p_dedupe text, p_payload jsonb,
  p_chapter text default null, p_target text default null, p_interrupt boolean default false,
  p_addressed uuid[] default '{}', p_supersede boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if exists (select 1 from public.needs_you where package_id = p_package and dedupe_key = p_dedupe and state = 'answered') then
    return null;  -- answered once: never comes back for unchanged content
  end if;
  if p_supersede then
    update public.needs_you set state = 'superseded'
     where package_id = p_package and dedupe_key = p_dedupe and state in ('waiting', 'shown');
  end if;
  insert into public.needs_you (package_id, kind, origin, dedupe_key, payload, chapter, target_path, interrupt, addressed_to)
  values (p_package, p_kind, p_origin, p_dedupe, p_payload, p_chapter, p_target, p_interrupt, p_addressed)
  on conflict (package_id, dedupe_key) where state in ('waiting', 'shown') do nothing
  returning id into v_id;
  return v_id;
end $$;

-- needs_you_obsolete (service role): the target changed so the items no longer apply.
create function public.needs_you_obsolete(p_package text, p_target text, p_kinds text[])
returns int language sql security definer set search_path = '' as $$
  with u as (
    update public.needs_you set state = 'obsolete'
     where package_id = p_package and target_path = p_target and kind = any (p_kinds) and state in ('waiting', 'shown')
     returning 1)
  select count(*)::int from u
$$;

-- needs_you_checkpoint (service role): show up to `p_cap` waiting items, in
-- rank order (interrupts, approvals, blockers, questions, information; then
-- chapter, then age). Returns the ids shown.
create function public.needs_you_checkpoint(p_package text, p_cap int default 10)
returns setof uuid language plpgsql security definer set search_path = '' as $$
declare v_shown int;
begin
  select count(*) into v_shown from public.needs_you where package_id = p_package and state = 'shown';
  return query
  with pick as (
    select id from public.needs_you
     where package_id = p_package and state = 'waiting'
     order by interrupt desc,
              case kind when 'approve' then 0 when 'to-confirm' then 1 when 'problem' then 1 when 'both-changed' then 1
                        when 'reconnect' then 1 when 'question' then 2 when 'review' then 2 when 'suggestion' then 3
                        when 'update' then 3 when 'edited-elsewhere' then 3 else 4 end,
              chapter nulls first, created_at
     limit greatest(p_cap - v_shown, 0))
  update public.needs_you n set state = 'shown', shown_at = now() from pick where n.id = pick.id
  returning n.id;
end $$;

-- needs_you_answer (authenticated): the coarse role floor; the server checks
-- the full matrix (can(role, action, ctx)) before calling this.
create function public.needs_you_answer(p_id uuid, p_answer jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare n public.needs_you; v_role text;
begin
  select * into n from public.needs_you where id = p_id for update;
  if not found or n.state not in ('waiting', 'shown') then
    raise exception 'This item is no longer open' using errcode = '22023';
  end if;
  v_role := public.course_role(n.package_id);
  if v_role is null then raise exception 'Not a member of this course' using errcode = '42501'; end if;
  if n.kind in ('approve', 'to-confirm', 'suggestion', 'update', 'method-version', 'reconnect', 'ready')
     and v_role not in ('owner', 'deputy') then
    raise exception 'Only the owner (or deputy) can decide this' using errcode = '42501';
  end if;
  if n.kind = 'method-version' and v_role <> 'owner' then
    raise exception 'Only the owner can take a new method version' using errcode = '42501';
  end if;
  if n.kind = 'both-changed' and v_role = 'co-author' and not ((select auth.uid()) = any (n.addressed_to)) then
    raise exception 'This item is for someone else' using errcode = '42501';
  end if;
  update public.needs_you set state = 'answered', answer = p_answer, answered_by = (select auth.uid()), answered_at = now()
   where id = p_id;
end $$;

revoke execute on function public.needs_you_raise(text, text, text, text, jsonb, text, text, boolean, uuid[], boolean) from public, anon, authenticated;
revoke execute on function public.needs_you_obsolete(text, text, text[]) from public, anon, authenticated;
revoke execute on function public.needs_you_checkpoint(text, int) from public, anon, authenticated;
revoke execute on function public.needs_you_answer(uuid, jsonb) from public, anon;
grant execute on function public.needs_you_raise(text, text, text, text, jsonb, text, text, boolean, uuid[], boolean) to service_role;
grant execute on function public.needs_you_obsolete(text, text, text[]) to service_role;
grant execute on function public.needs_you_checkpoint(text, int) to service_role;
grant execute on function public.needs_you_answer(uuid, jsonb) to authenticated;
