-- Closed loop r4, part B (round-4 audits, 2026-10-24): security MEDIUM-1 and
-- correctness LOW (P5.A.1.u, P5.A.1.t, P5.A.1.s): the discovery drain is fair,
-- splits what fails, and never holds a package's queue row long enough to
-- stall its owner's saves. NOT APPLIED anywhere yet. Requires
-- 0030_loop_r3c_3 (the queue columns and every function redefined here).
--
-- COMPOSITION. Every function redefined here starts from its LATEST
-- definition (0030_loop_r3c_3 §2, §3) and keeps every rule:
--   discovery_pend            whole entry absorbs any list; a whole pend
--                             restarts the drain; content flags OR-ed; a list
--                             merged at or behind a running drain's cursor
--                             restarts it (r3c); first_queued_at kept.
--   discovery_flush_one       package lock first (try, never wait) and the
--                             entry left untouched without it (r3c); scoped
--                             entry = one refresh; whole entry = ≤ 1,000-element
--                             chunks in doc-id order over documents ∪
--                             projection, resuming after the cursor, until done
--                             or the budget is spent; the course row last; a
--                             failure records attempts / last_error and backs
--                             off 1, 2, 4 … minutes, at most an hour (r3c).
--   discovery_flush_package   owner only, else a silent no-op answering true;
--                             2 s budget.
--   discovery_flush_pending   service role; skips entries backing off.
-- loop-r4b-queue.sql.test.ts extends the composition test (P5.A.1.r).
--
-- THE HOLES (repro /tmp/alembic-r4/r4q.test.ts).
--   MEDIUM-1 (security) / LOW (correctness). discovery_flush_pending handed
--     the WHOLE budget to the oldest entry. A course with a few thousand files
--     whose owner edits its title between runs (each edit restarts the drain,
--     and first_queued_at is kept) took every scheduled run's entire 25 s:
--     every other course's queued refresh waited indefinitely ("drained 0",
--     run after run).
--   An entry whose refresh kept failing absorbed every later refresh of that
--     package: a whole entry failing in one chunk rolled back every chunk and
--     never finished, so a single-doc edit merged into it was never
--     re-projected; a scoped entry with one bad id took every id merged into it
--     down with it. And new work merged into an entry that was backing off
--     waited out the old back-off.
--   The scheduled drain ran as ONE transaction (a function cannot commit):
--     every package lock and queue row it touched was held until the whole
--     25 s run ended, so an owner's save of a package drained early in the run
--     — whose projector then queues its refresh into the locked row — waited
--     up to 25 s (past the signed-in 8 s statement timeout: the save failed).
--
-- THE FIX.
--   1. Fair drains. Each entry gets a slice of the run: least(what is left,
--      budget / 5, 2 s) (2 s = the owner's own flush). An entry a drain worked
--      on without finishing records drained_at (kept across merges and
--      restarts) and sorts BEHIND every entry no drain has touched yet, then
--      least recently drained first (round robin): order by drained_at nulls
--      first, first_queued_at, package_id — never-touched entries oldest first.
--      One shared chooser, discovery_drain_next(skip), for both drains.
--   2. Split what fails. A whole drain runs each chunk in its own
--      sub-transaction: a chunk that fails is set aside (held_doc_ids) and the
--      drain moves on, so the rest of the course and the course row still
--      land; when the pass is done the entry becomes a scoped entry of exactly
--      the ids that failed. A scoped refresh that fails is retried id by id
--      (until the slice ends): ids that refresh are done, ids that fail stay.
--      Either way the failure backs off as before.
--   3. New work resets the back-off. A merge that changes what the entry must
--      do (adds ids, turns a list into the whole package, restarts the cursor,
--      or newly marks content changed) clears next_attempt_at; attempts are
--      kept, so the next failure still backs off longer.
--   4. Commit per entry. The scheduled job now runs the PROCEDURE
--      public.discovery_drain(25, 25 s), which commits after each entry: a
--      package lock and its queue row are held for one slice (≤ 2 s plus one
--      chunk), not the whole run. (A procedure that commits can have neither
--      SECURITY DEFINER nor a SET clause, so it is security invoker, qualifies
--      every name, and touches the queue only through the definer functions
--      discovery_drain_next / discovery_flush_one.) discovery_flush_pending
--      stays for an operator's one-off call (one transaction; documented).
--   5. The package lock is taken through public.discovery_try_lock (same key
--      as the projector's), so the losing side is testable on a
--      single-connection test database.
--
-- READ-ONLY PRE-CHECKS (what is queued now; all of it is kept):
--   select count(*), min(first_queued_at), max(attempts),
--          count(*) filter (where next_attempt_at > now()) as backing_off
--   from public.discovery_pending;
--   select jobname, schedule, command, active from cron.job;   -- (pg_cron)
--
-- DEPLOY ORDER: either order with the r4b code (no code calls anything new).
-- After applying, check the job runs as a procedure call:
--   select status, return_message, start_time from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'alembic-discovery-drain')
--   order by start_time desc limit 3;
-- If it ever reports "invalid transaction termination" (a pg_cron mode that
-- wraps commands in a transaction), reschedule the function form:
--   select cron.schedule('alembic-discovery-drain', '*/5 * * * *',
--     $job$select public.discovery_flush_pending(25, interval '25 seconds')$job$);

-- ---------------------------------------------------------------------------
-- 1. The queue's new columns (additive).
-- ---------------------------------------------------------------------------
alter table public.discovery_pending
  add column if not exists drained_at timestamptz,
  add column if not exists held_doc_ids text[];

comment on column public.discovery_pending.drained_at is
  'When a drain last worked on this entry without finishing it (0031_loop_r4b_1). Kept across merges; such entries sort behind untouched ones.';
comment on column public.discovery_pending.held_doc_ids is
  'Ids of whole-drain chunks that failed, set aside so the drain could move on (0031_loop_r4b_1). Retried id by id.';

-- ---------------------------------------------------------------------------
-- 2. The package lock (same key as discovery_refresh_package's).
-- ---------------------------------------------------------------------------
create or replace function public.discovery_try_lock(p_package_id text)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('alembic.discovery:' || p_package_id, 0))
$$;

-- ---------------------------------------------------------------------------
-- 3. Queue (or merge into) a pending refresh — 0030_loop_r3c_3 §2 + r4b.
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
    -- r4b: new work resets the back-off — a list becomes the whole package,
    -- ids the list did not have, a restarted cursor, or content newly changed
    -- (attempts are kept: the next failure backs off longer)
    next_attempt_at = case
      when (q.doc_ids is not null and excluded.doc_ids is null)
        or (q.doc_ids is not null and excluded.doc_ids is not null
            and not (excluded.doc_ids <@ q.doc_ids))
        or (q.doc_ids is null and q.cursor_doc_id is not null
            and (excluded.doc_ids is null
                 or exists (select 1 from unnest(excluded.doc_ids) as u where u <= q.cursor_doc_id)))
        or (excluded.content and not q.content)
      then null
      else q.next_attempt_at
    end,
    queued_at = now();
    -- (first_queued_at and drained_at are kept: the entry's age and its place
    -- behind untouched entries survive merges — r3c M3-2, r4b MEDIUM-1)
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Refresh a list of ids, split on failure (r4b).
--
-- ok = everything landed. Otherwise left_ids = the ids still owed (those that
-- failed alone, and those the deadline left), error = the last error. An empty
-- list (the course row only) that fails is not ok with nothing left to split.
-- ---------------------------------------------------------------------------
create or replace function public.discovery_refresh_ids(
  p_package_id text,
  p_content boolean,
  p_doc_ids text[],
  p_deadline timestamptz,
  out ok boolean,
  out left_ids text[],
  out error text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i integer := 0;
  v_n integer := coalesce(cardinality(p_doc_ids), 0);
begin
  ok := true;
  left_ids := '{}';
  error := null;
  begin
    perform public.discovery_refresh_package(p_package_id, p_content, coalesce(p_doc_ids, '{}'));
    return;
  exception when others then
    error := left(sqlerrm, 500);
  end;
  if v_n = 0 then
    ok := false;
    return;
  end if;
  -- one id at a time: what refreshes is done, what fails stays
  while v_i < v_n loop
    v_i := v_i + 1;
    if pg_catalog.clock_timestamp() >= p_deadline then
      left_ids := left_ids || p_doc_ids[v_i:v_n];
      exit;
    end if;
    begin
      perform public.discovery_refresh_package(p_package_id, p_content, array[p_doc_ids[v_i]]);
    exception when others then
      left_ids := left_ids || p_doc_ids[v_i];
      error := left(sqlerrm, 500);
    end;
  end loop;
  ok := cardinality(left_ids) = 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Draining one entry — 0030_loop_r3c_3 §3 + r4b (split, drained_at).
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
  v_deadline timestamptz;
  v_chunk text[];
  v_last text;
  v_failed text[] := '{}';
  v_err text;
  v_r record;
begin
  v_deadline := v_start + coalesce(p_budget, interval '2 seconds');
  -- r3c (M3-1): the package's projector lock, up front and without waiting.
  -- Held, the chunks below take it re-entrantly and can never queue into this
  -- entry; not available (another refresh of this package is running), the
  -- entry is left exactly as it is for the next drain.
  if coalesce(current_setting('alembic.discovery_nolock', true), '') <> 'on'
     and not public.discovery_try_lock(p_package_id) then
    return false;
  end if;

  select * into v_q from public.discovery_pending
  where package_id = p_package_id
  for update skip locked;
  if not found then
    return not exists (select 1 from public.discovery_pending where package_id = p_package_id);
  end if;
  -- r3c (M3-2): an entry that failed waits out its back-off (r4b: new work
  -- merged into it cleared next_attempt_at — discovery_pend).
  if v_q.next_attempt_at is not null and v_q.next_attempt_at > now() then
    return false;
  end if;

  begin
    -- r4b: chunks an earlier whole drain set aside, id by id
    if v_q.held_doc_ids is not null then
      select * into v_r from public.discovery_refresh_ids(p_package_id, v_q.content, v_q.held_doc_ids, v_deadline);
      if not v_r.ok then
        update public.discovery_pending
        set held_doc_ids = nullif(v_r.left_ids, '{}'),
            attempts = attempts + 1,
            last_error = v_r.error,
            next_attempt_at = now() + least(interval '1 minute' * power(2, least(attempts, 10)), interval '1 hour'),
            drained_at = clock_timestamp()
        where package_id = p_package_id;
        return false;
      end if;
      update public.discovery_pending set held_doc_ids = null where package_id = p_package_id;
    end if;

    if v_q.doc_ids is not null then
      -- a scoped entry: one refresh; r4b: split id by id when it fails
      select * into v_r from public.discovery_refresh_ids(p_package_id, v_q.content, v_q.doc_ids, v_deadline);
      if v_r.ok then
        delete from public.discovery_pending where package_id = p_package_id;
        return not exists (select 1 from public.discovery_pending where package_id = p_package_id);
      end if;
      update public.discovery_pending
      set doc_ids = v_r.left_ids,
          attempts = attempts + 1,
          last_error = v_r.error,
          next_attempt_at = now() + least(interval '1 minute' * power(2, least(attempts, 10)), interval '1 hour'),
          drained_at = clock_timestamp()
      where package_id = p_package_id;
      return false;
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
      -- r4b: each chunk in its own sub-transaction; a chunk that fails is set
      -- aside (retried id by id later) and the drain moves on
      begin
        perform public.discovery_refresh_package(p_package_id, v_q.content, v_chunk);
      exception when others then
        v_failed := v_failed || v_chunk;
        v_err := left(sqlerrm, 500);
      end;
      v_last := v_chunk[cardinality(v_chunk)];
      if clock_timestamp() >= v_deadline then
        update public.discovery_pending
        set cursor_doc_id = v_last,
            drained_at = clock_timestamp(),
            held_doc_ids = case when cardinality(v_failed) > 0
              then array(select distinct u from unnest(coalesce(held_doc_ids, '{}') || v_failed) as u order by u)
              else held_doc_ids end,
            attempts = attempts + (case when v_err is null then 0 else 1 end),
            last_error = coalesce(v_err, last_error),
            next_attempt_at = case when v_err is null then next_attempt_at
              else now() + least(interval '1 minute' * power(2, least(attempts, 10)), interval '1 hour') end
        where package_id = p_package_id;
        return false;
      end if;
    end loop;
    -- every element done: the course row (element_count) last — r4b: in its
    -- own sub-transaction, so a failure keeps this pass's chunks and the cursor
    begin
      perform public.discovery_refresh_package(p_package_id, v_q.content, '{}');
    exception when others then
      update public.discovery_pending
      set cursor_doc_id = v_last,
          held_doc_ids = case when cardinality(v_failed) > 0
            then array(select distinct u from unnest(coalesce(held_doc_ids, '{}') || v_failed) as u order by u)
            else held_doc_ids end,
          attempts = attempts + 1,
          last_error = left(sqlerrm, 500),
          next_attempt_at = now() + least(interval '1 minute' * power(2, least(attempts, 10)), interval '1 hour'),
          drained_at = clock_timestamp()
      where package_id = p_package_id;
      return false;
    end;
    if cardinality(v_failed) > 0 then
      -- r4b: what is left is exactly the ids whose chunks failed — a scoped entry
      update public.discovery_pending
      set doc_ids = array(select distinct u from unnest(coalesce(held_doc_ids, '{}') || v_failed) as u order by u),
          held_doc_ids = null,
          cursor_doc_id = null,
          attempts = attempts + 1,
          last_error = v_err,
          next_attempt_at = now() + least(interval '1 minute' * power(2, least(attempts, 10)), interval '1 hour'),
          drained_at = clock_timestamp()
      where package_id = p_package_id;
      return false;
    end if;
    delete from public.discovery_pending where package_id = p_package_id;
    return not exists (select 1 from public.discovery_pending where package_id = p_package_id);
  exception when others then
    update public.discovery_pending
    set attempts = attempts + 1,
        last_error = left(sqlerrm, 500),
        -- r3c (M3-2): back off 1, 2, 4 … minutes, at most an hour
        next_attempt_at = now() + least(interval '1 minute' * power(2, least(attempts, 10)), interval '1 hour'),
        drained_at = clock_timestamp()
    where package_id = p_package_id;
    raise warning 'discovery: pending refresh of % failed: %', p_package_id, sqlerrm;
    return false;
  end;
end;
$$;

-- (discovery_flush_package — the owner after a write, 2 s — is unchanged.)

-- ---------------------------------------------------------------------------
-- 6. The fair order (r4b): untouched entries first, oldest first-queued
--    first; then entries a drain already worked on, least recently first.
-- ---------------------------------------------------------------------------
create or replace function public.discovery_drain_next(p_skip text[] default '{}')
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select q.package_id from public.discovery_pending q
  where (q.next_attempt_at is null or q.next_attempt_at <= now())
    and not (q.package_id = any (coalesce(p_skip, '{}')))
  order by q.drained_at nulls first, q.first_queued_at, q.package_id
  limit 1
$$;

-- One transaction (a function cannot commit): for an operator's one-off call.
-- The schedule uses discovery_drain below, which commits per entry.
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
  v_seen text[] := '{}';
  v_done integer := 0;
  v_start timestamptz := clock_timestamp();
  v_budget interval := coalesce(p_budget, interval '20 seconds');
begin
  loop
    exit when cardinality(v_seen) >= greatest(coalesce(p_max, 10), 0)
      or clock_timestamp() - v_start >= v_budget;
    v_id := public.discovery_drain_next(v_seen);
    exit when v_id is null;
    v_seen := v_seen || v_id;
    -- r4b: a slice per entry, never the whole budget
    if public.discovery_flush_one(v_id,
         least(v_budget - (clock_timestamp() - v_start), v_budget / 5, interval '2 seconds')) then
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end;
$$;

-- The scheduled drain: the same, committing after each entry.
create or replace procedure public.discovery_drain(
  p_max integer default 25,
  p_budget interval default interval '25 seconds'
)
language plpgsql
as $$
declare
  v_id text;
  v_seen text[] := '{}';
  v_start timestamptz := pg_catalog.clock_timestamp();
  v_budget interval := coalesce(p_budget, interval '25 seconds');
begin
  loop
    exit when pg_catalog.cardinality(v_seen) >= greatest(coalesce(p_max, 25), 0)
      or pg_catalog.clock_timestamp() - v_start >= v_budget;
    v_id := public.discovery_drain_next(v_seen);
    exit when v_id is null;
    v_seen := v_seen || v_id;
    perform public.discovery_flush_one(v_id,
      least(v_budget - (pg_catalog.clock_timestamp() - v_start), v_budget / 5, interval '2 seconds'));
    commit;
  end loop;
end;
$$;

revoke all on function public.discovery_try_lock(text) from public, anon, authenticated;
revoke all on function public.discovery_pend(text, boolean, text[]) from public, anon, authenticated;
revoke all on function public.discovery_refresh_ids(text, boolean, text[], timestamptz) from public, anon, authenticated;
revoke all on function public.discovery_flush_one(text, interval) from public, anon, authenticated;
revoke all on function public.discovery_drain_next(text[]) from public, anon, authenticated;
revoke all on function public.discovery_flush_pending(integer, interval) from public, anon, authenticated;
grant execute on function public.discovery_flush_pending(integer, interval) to service_role;
revoke all on procedure public.discovery_drain(integer, interval) from public, anon, authenticated;
grant execute on procedure public.discovery_drain(integer, interval) to service_role;

-- ---------------------------------------------------------------------------
-- 7. The schedule: the committing procedure (pg_cron, when enabled).
-- ---------------------------------------------------------------------------
do $$
begin
  -- (scheduling a job name again replaces it)
  if pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule(
      'alembic-discovery-drain',
      '*/5 * * * *',
      $job$call public.discovery_drain(25, interval '25 seconds')$job$
    );
  else
    raise notice 'pg_cron is not enabled: enable it (Database → Extensions) and schedule alembic-discovery-drain — see the header of 0031_loop_r4b_1_discovery_drain.sql';
  end if;
end;
$$;
