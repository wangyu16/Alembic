-- Correctness loop r3 (round-3 audit, 2026-10-24), findings M3-1 (P5.A.1.s)
-- and M3-2 (P5.A.1.t), with security r3 LOW-2: the discovery queue never
-- loses a refresh, and every queued refresh is drained on a schedule and has
-- an observable age. NOT APPLIED anywhere yet. Requires 0029_loop_r2c_1 (the
-- queue and the functions redefined here). Apply after 0030_loop_r3c_2.
--
-- COMPOSITION. Every function redefined here starts from its LATEST
-- definition (0029_loop_r2c_1 §1 and §5) and keeps every rule:
--   discovery_pend            whole entry absorbs any list; a whole pend
--                             restarts the drain; content flags OR-ed.
--   discovery_flush_one       scoped entry = one refresh; whole entry = course
--                             row + ≤ 1,000-element chunks in doc-id order over
--                             documents ∪ projection, resuming after the
--                             cursor, until done or the budget is spent; the
--                             course row last; a failure records attempts /
--                             last_error and keeps the entry.
--   discovery_flush_package   owner only (caller_owns_package), else a silent
--                             no-op answering true; 2 s budget.
--   discovery_flush_pending   service role; oldest first; one shared budget.
-- loop-r3c.sql.test.ts extends the composition test (P5.A.1.r).
--
-- THE HOLES.
--   M3-1 (P5.A.1.s). (a) A scoped refresh merged into a whole-package entry
--     KEPT the entry's cursor: a doc id behind the cursor (an owner's edit
--     queued while a big drain was half-way — lock lost or after a cancel) was
--     never re-projected; Discover served the old description indefinitely
--     (repro /tmp/p5r3/lostref.mts). (b) discovery_flush_one ran its chunks
--     through discovery_refresh_package, whose try-lock — when another
--     transaction held the package — queued the chunk INTO THE ENTRY BEING
--     DRAINED, which the drain then deleted or moved its cursor past: a chunk
--     skipped.
--   M3-2 (P5.A.1.t). Nothing drained the queue on a schedule: an entry waited
--     for the owner's next write or edit-page visit (a course nobody edits
--     stayed stale until a rebuild); no age was observable; and an entry that
--     kept failing was retried — and charged — on every edit-page load.
--   Security LOW-2. Another user can briefly hold a victim package's advisory
--     lock (a write naming it as adaptedFrom refreshes the source); without a
--     scheduled drain the victim's queued refresh could wait indefinitely.
--
-- THE FIX.
--   1. discovery_pend: when a scoped list merges into a whole entry whose
--      drain is under way, the cursor restarts (null) if any merged id is at
--      or behind it (ids ahead of it are covered by the remaining chunks).
--      The first-queued time is kept across merges (first_queued_at) — the
--      age an operator sees, and the drain order (no starvation by edits).
--   2. discovery_flush_one takes the package's advisory lock up front
--      (pg_try_advisory_xact_lock, same key as the projector; re-entrant, so
--      the chunks it runs can never queue into its own entry) and returns
--      false WITHOUT touching the entry when it cannot — the next drain
--      retries. A failure backs off: next_attempt_at = now() + min(2^attempts
--      minutes, 1 hour); every drain (owner or scheduled) skips the entry
--      until then, so an edit-page load is not charged for an entry that keeps
--      failing.
--   3. A scheduled drain: with Supabase's pg_cron enabled, the job
--      'alembic-discovery-drain' runs discovery_flush_pending(25, 25 s) every
--      5 minutes (scheduled below when pg_cron is present; otherwise a NOTICE
--      says how to enable it — see "OWNER ACTION").
--   4. Observable age: public.discovery_pending_health() (service role) →
--      pending, overdue (first queued > 1 h ago), oldest_queued_at; the admin
--      page shows it. The view public.discovery_pending_overdue lists the
--      overdue entries for an operator's SQL editor (service role only).
--
-- OWNER ACTION (Supabase, once): Dashboard → Database → Extensions → enable
-- "pg_cron" (or `create extension if not exists pg_cron;`), then in the SQL
-- editor:
--   select cron.schedule('alembic-discovery-drain', '*/5 * * * *',
--     $job$select public.discovery_flush_pending(25, interval '25 seconds')$job$);
-- (Applying this migration after pg_cron is enabled schedules it by itself.)
-- Check: select jobname, schedule, active from cron.job;
--        select * from public.discovery_pending_health();
--
-- READ-ONLY PRE-CHECK (what is queued now; all of it is kept):
--   select count(*), min(queued_at), max(attempts) from public.discovery_pending;
--
-- DEPLOY ORDER: either order with the r3c code. The r3c admin page calls
-- discovery_pending_health (it shows "unavailable" until this is applied).

-- ---------------------------------------------------------------------------
-- 1. The queue's new columns (additive).
-- ---------------------------------------------------------------------------
alter table public.discovery_pending
  add column if not exists first_queued_at timestamptz,
  add column if not exists next_attempt_at timestamptz;
update public.discovery_pending set first_queued_at = queued_at where first_queued_at is null;
alter table public.discovery_pending
  alter column first_queued_at set default now(),
  alter column first_queued_at set not null;

-- ---------------------------------------------------------------------------
-- 2. Queue (or merge into) a pending refresh.
-- ---------------------------------------------------------------------------
create or replace function public.discovery_pend(
  p_package_id text,
  p_content_changed boolean default false,
  p_doc_ids text[] default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_package_id is null then
    return;
  end if;
  insert into public.discovery_pending as q (package_id, content, doc_ids)
  values (p_package_id, coalesce(p_content_changed, false), p_doc_ids)
  on conflict (package_id) do update set
    content = q.content or excluded.content,
    doc_ids = case
      when q.doc_ids is null or excluded.doc_ids is null then null
      else array(select distinct u from unnest(q.doc_ids || excluded.doc_ids) as u order by u)
    end,
    -- a whole pend restarts the drain; r3c (M3-1): so does a list merged into
    -- a whole entry when any of its ids is at or behind the cursor
    cursor_doc_id = case
      when excluded.doc_ids is null then null
      when q.doc_ids is null and q.cursor_doc_id is not null
        and exists (select 1 from unnest(excluded.doc_ids) as u where u <= q.cursor_doc_id) then null
      else q.cursor_doc_id
    end,
    queued_at = now();
    -- (first_queued_at is kept: the entry's age survives merges — r3c M3-2)
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Draining one entry: lock first, back off on failure.
-- ---------------------------------------------------------------------------
create or replace function public.discovery_flush_one(
  p_package_id text,
  p_budget interval default interval '2 seconds'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q public.discovery_pending%rowtype;
  v_start timestamptz := clock_timestamp();
  v_chunk text[];
  v_last text;
begin
  -- r3c (M3-1): the package's projector lock, up front and without waiting.
  -- Held, the chunks below take it re-entrantly and can never queue into this
  -- entry; not available (another refresh of this package is running), the
  -- entry is left exactly as it is for the next drain.
  if coalesce(current_setting('alembic.discovery_nolock', true), '') <> 'on'
     and not pg_catalog.pg_try_advisory_xact_lock(
       pg_catalog.hashtextextended('alembic.discovery:' || p_package_id, 0)) then
    return false;
  end if;

  select * into v_q from public.discovery_pending
  where package_id = p_package_id
  for update skip locked;
  if not found then
    return not exists (select 1 from public.discovery_pending where package_id = p_package_id);
  end if;
  -- r3c (M3-2): an entry that failed waits out its back-off.
  if v_q.next_attempt_at is not null and v_q.next_attempt_at > now() then
    return false;
  end if;

  begin
    if v_q.doc_ids is not null then
      delete from public.discovery_pending where package_id = p_package_id;
      perform public.discovery_refresh_package(p_package_id, v_q.content, v_q.doc_ids);
      return not exists (select 1 from public.discovery_pending where package_id = p_package_id);
    end if;

    v_last := v_q.cursor_doc_id;
    loop
      select array_agg(i order by i) into v_chunk
      from (
        select i from (
          select d.doc_id as i from public.documents d where d.package_id = p_package_id
          union
          select e.doc_id from public.discovery_elements e where e.package_id = p_package_id
        ) u
        where v_last is null or i > v_last
        order by i
        limit 1000
      ) s;
      exit when v_chunk is null;
      perform public.discovery_refresh_package(p_package_id, v_q.content, v_chunk);
      v_last := v_chunk[cardinality(v_chunk)];
      if clock_timestamp() - v_start >= p_budget then
        update public.discovery_pending set cursor_doc_id = v_last where package_id = p_package_id;
        return false;
      end if;
    end loop;
    -- every element done: the course row (element_count) last
    delete from public.discovery_pending where package_id = p_package_id;
    perform public.discovery_refresh_package(p_package_id, v_q.content, '{}');
    return not exists (select 1 from public.discovery_pending where package_id = p_package_id);
  exception when others then
    update public.discovery_pending
    set attempts = attempts + 1,
        last_error = left(sqlerrm, 500),
        -- r3c (M3-2): back off 1, 2, 4 … minutes, at most an hour
        next_attempt_at = now() + least(interval '1 minute' * power(2, least(attempts, 10)), interval '1 hour')
    where package_id = p_package_id;
    raise warning 'discovery: pending refresh of % failed: %', p_package_id, sqlerrm;
    return false;
  end;
end;
$$;

-- The owner, after a write (unchanged from 0029 but for the back-off, which
-- discovery_flush_one applies). Anyone else's package: a no-op answering true.
create or replace function public.discovery_flush_package(p_package_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.caller_owns_package(p_package_id) then
    return true;
  end if;
  return public.discovery_flush_one(p_package_id, interval '2 seconds');
end;
$$;

-- Service role / operator / the scheduled job: drain up to p_max packages,
-- OLDEST FIRST by first-queued time (r3c: edits cannot push an entry back),
-- skipping entries still backing off.
create or replace function public.discovery_flush_pending(
  p_max integer default 10,
  p_budget interval default interval '20 seconds'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
  v_done integer := 0;
  v_start timestamptz := clock_timestamp();
begin
  for v_id in
    select package_id from public.discovery_pending
    where next_attempt_at is null or next_attempt_at <= now()
    order by first_queued_at, package_id
    limit greatest(coalesce(p_max, 10), 0)
  loop
    exit when clock_timestamp() - v_start >= p_budget;
    if public.discovery_flush_one(v_id, p_budget - (clock_timestamp() - v_start)) then
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Observable age (service role only).
-- ---------------------------------------------------------------------------
create or replace function public.discovery_pending_health()
returns table (pending integer, overdue integer, failing integer, oldest_queued_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer,
         (count(*) filter (where first_queued_at < now() - interval '1 hour'))::integer,
         (count(*) filter (where attempts > 0))::integer,
         min(first_queued_at)
  from public.discovery_pending
$$;

-- (an owner-privileged view: the API roles have no access to it or the queue)
create or replace view public.discovery_pending_overdue as
  select package_id, doc_ids is null as whole_package, cursor_doc_id, first_queued_at,
         now() - first_queued_at as age, queued_at, attempts, last_error, next_attempt_at
  from public.discovery_pending
  where first_queued_at < now() - interval '1 hour';

revoke all on public.discovery_pending_overdue from public, anon, authenticated;
grant select on public.discovery_pending_overdue to service_role;

revoke all on function public.discovery_pend(text, boolean, text[]) from public, anon, authenticated;
revoke all on function public.discovery_flush_one(text, interval) from public, anon, authenticated;
revoke all on function public.discovery_flush_package(text) from public, anon;
grant execute on function public.discovery_flush_package(text) to authenticated, service_role;
revoke all on function public.discovery_flush_pending(integer, interval) from public, anon, authenticated;
grant execute on function public.discovery_flush_pending(integer, interval) to service_role;
revoke all on function public.discovery_pending_health() from public, anon, authenticated;
grant execute on function public.discovery_pending_health() to service_role;

-- ---------------------------------------------------------------------------
-- 5. The scheduled drain (pg_cron, when the owner has enabled it).
-- ---------------------------------------------------------------------------
do $$
begin
  -- (pg_cron's cron.schedule(job_name, schedule, command) exists once the
  -- extension is enabled; scheduling a job name again replaces it.)
  if pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule(
      'alembic-discovery-drain',
      '*/5 * * * *',
      $job$select public.discovery_flush_pending(25, interval '25 seconds')$job$
    );
  else
    raise notice 'pg_cron is not enabled: enable it (Database → Extensions) and schedule alembic-discovery-drain — see the header of 0030_loop_r3c_3_discovery_queue.sql';
  end if;
end;
$$;
