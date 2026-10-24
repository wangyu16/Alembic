-- Closed loop r5 (round-5 correctness audit, 2026-10-24), MEDIUM (P5.A.1.w):
-- ids a whole drain set aside that keep failing no longer block the rest of
-- the pass. NOT APPLIED anywhere yet. Requires 0031_loop_r4b_1 (the queue
-- columns and the function redefined here, its latest definition). Apply
-- after 0032_decisions_1_a11y_neutral.
--
-- WHY (repro /tmp/p5r5/sql/held.test.ts). discovery_flush_one retries the ids
--   an earlier slice of a whole drain set aside (held_doc_ids) first, id by
--   id. When any of them still failed it recorded the failure and RETURNED —
--   before the pass. A whole drain that met one permanently failing element
--   at a slice deadline (its chunk set aside, the cursor saved) therefore
--   never moved its cursor again: every later drain retried the held ids,
--   failed on the one bad id, and stopped. The rest of the course (every
--   chunk after the cursor) and the course row were never refreshed, and
--   every later refresh of that course merged into the same whole entry
--   (a whole entry absorbs every list) — so nothing of that course was ever
--   re-projected again. A scoped entry carrying held ids was blocked the same
--   way.
--
-- THE FIX. A held failure is recorded (the ids still failing stay held, with
--   last_error, attempts + 1 and the back-off — as before) and the drain FALLS
--   THROUGH to the entry's work:
--   - a whole entry continues its pass from the cursor (at least one chunk,
--     even when the held retry spent the slice — the cursor always moves);
--     when the pass ends, what is left is exactly the held ids plus the ids of
--     chunks that failed in this pass: a scoped entry (the r4b rule, which now
--     also applies when only held ids are left);
--   - a scoped entry refreshes its ids (split on failure, r4b); the held ids
--     still owed join its list (held_doc_ids cleared), so the entry is never
--     deleted while anything is owed.
--   One failure per drain: a drain that fails in more than one step (held and
--   a chunk, say) counts ONE attempt and sets ONE back-off (v_bumped), so the
--   back-off grows 1, 2, 4 … minutes per drain as before, not faster.
--
-- COMPOSITION (DecisionLog 2026-10-23, "Composition rule"). discovery_flush_one
-- starts from its latest definition (0031_loop_r4b_1 §5; 0031_loop_r4b_2/3 and
-- 0032 do not touch it) and keeps every rule:
--   r3c: the package's projector lock first, try, never wait, and the entry
--     untouched without it; skip-locked row; an entry backing off waits; a
--     failure records attempts / last_error and backs off 1, 2, 4 … minutes,
--     at most an hour; the outer handler (anything unexpected) the same.
--   r2c/r3c: scoped entry = one refresh; whole entry = ≤ 1,000-element chunks
--     in doc-id order over documents ∪ projection, resuming after the cursor,
--     until done or the budget is spent; the course row last.
--   r4b: held ids retried id by id (discovery_refresh_ids); each chunk in its
--     own sub-transaction, a failed chunk set aside and the drain moves on;
--     the course row in its own sub-transaction; a finished pass with failures
--     becomes a scoped entry of exactly what failed; drained_at on every
--     unfinished drain. (discovery_pend, discovery_refresh_ids,
--     discovery_drain_next, discovery_flush_pending, discovery_drain and the
--     schedule are unchanged.)
-- loop-r5-sql.sql.test.ts asserts the composition (P5.A.1.r).
--
-- GRANTS. CREATE OR REPLACE keeps the existing ones (none for the API roles —
-- 0031_loop_r4b_1); the revoke is repeated to say so.
--
-- READ-ONLY PRE-CHECK (entries the hole holds today — they drain after this):
--   select package_id, cardinality(held_doc_ids) held, cursor_doc_id, attempts, last_error
--   from public.discovery_pending where held_doc_ids is not null;
--
-- DEPLOY ORDER: after 0032_decisions_1_a11y_neutral (and before or after
-- 0033_loop_r5_2 — independent); either order with the r5 code (no code calls
-- anything new). Rollback: re-run §5 of 0031_loop_r4b_1 (the r4b body).

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
  -- r5: this drain already counted its failure (attempts + 1, back-off set)
  v_bumped boolean := false;
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
        -- r5 (P5.A.1.w): record what is still held and the failure, then FALL
        -- THROUGH to the entry's own work (it used to stop here, for good)
        update public.discovery_pending
        set held_doc_ids = nullif(v_r.left_ids, '{}'),
            attempts = attempts + 1,
            last_error = v_r.error,
            next_attempt_at = now() + least(interval '1 minute' * power(2, least(attempts, 10)), interval '1 hour'),
            drained_at = clock_timestamp()
        where package_id = p_package_id;
        v_bumped := true;
      else
        update public.discovery_pending set held_doc_ids = null where package_id = p_package_id;
      end if;
    end if;

    if v_q.doc_ids is not null then
      -- a scoped entry: one refresh; r4b: split id by id when it fails
      select * into v_r from public.discovery_refresh_ids(p_package_id, v_q.content, v_q.doc_ids, v_deadline);
      if v_r.ok and not exists (select 1 from public.discovery_pending
                                where package_id = p_package_id and held_doc_ids is not null) then
        delete from public.discovery_pending where package_id = p_package_id;
        return not exists (select 1 from public.discovery_pending where package_id = p_package_id);
      end if;
      -- r5: what is owed = the ids that failed (or the deadline left) plus the
      -- held ids still failing; one failure per drain
      update public.discovery_pending
      set doc_ids = array(select distinct u from unnest(v_r.left_ids || coalesce(held_doc_ids, '{}')) as u order by u),
          held_doc_ids = null,
          attempts = attempts + (case when v_bumped or v_r.ok then 0 else 1 end),
          last_error = coalesce(v_r.error, last_error),
          next_attempt_at = case when v_bumped or v_r.ok then next_attempt_at
            else now() + least(interval '1 minute' * power(2, least(attempts, 10)), interval '1 hour') end,
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
            attempts = attempts + (case when v_err is null or v_bumped then 0 else 1 end),
            last_error = coalesce(v_err, last_error),
            next_attempt_at = case when v_err is null or v_bumped then next_attempt_at
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
          attempts = attempts + (case when v_bumped then 0 else 1 end),
          last_error = left(sqlerrm, 500),
          next_attempt_at = case when v_bumped then next_attempt_at
            else now() + least(interval '1 minute' * power(2, least(attempts, 10)), interval '1 hour') end,
          drained_at = clock_timestamp()
      where package_id = p_package_id;
      return false;
    end;
    if cardinality(v_failed) > 0
       or exists (select 1 from public.discovery_pending
                  where package_id = p_package_id and held_doc_ids is not null) then
      -- r4b: what is left is exactly the ids whose chunks failed — a scoped
      -- entry; r5: and the held ids still failing
      update public.discovery_pending
      set doc_ids = array(select distinct u from unnest(coalesce(held_doc_ids, '{}') || v_failed) as u order by u),
          held_doc_ids = null,
          cursor_doc_id = null,
          attempts = attempts + (case when v_bumped then 0 else 1 end),
          last_error = coalesce(v_err, last_error),
          next_attempt_at = case when v_bumped then next_attempt_at
            else now() + least(interval '1 minute' * power(2, least(attempts, 10)), interval '1 hour') end,
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

revoke all on function public.discovery_flush_one(text, interval) from public, anon, authenticated;
