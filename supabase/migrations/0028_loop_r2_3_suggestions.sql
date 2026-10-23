-- Security loop r2 (round-2 audit, 2026-10-23), finding NEW-4 (P5.S.1.e): a
-- suggestion arrives pending, bounded and rate-limited. NOT APPLIED anywhere
-- yet. Requires 0023 (rate_limit_hit) and 0025_loop_r1_1 (the policies it
-- redefines).
--
-- THE HOLE. The sender's insert policy checked only who sends and to which
-- listed package. So a sender could insert a row already 'accepted' with a
-- decided_at (it never reaches the owner's pending inbox but reads as an
-- accepted contribution), set created_at, and insert 2,000 rows of 100 KB in
-- ONE statement (repro /tmp/alembic-r2/probe4.mts: 200 MB into the victim's
-- inbox table). The owner's "resolve" policy also let the owner rewrite the
-- sender's text.
--
-- THE FIX.
--   1. Column grants: the API roles may INSERT only the sender's fields
--      (target/from package, sender, chapter path, block id, title, body, note,
--      status) — id, created_at and decided_at are the server's — and UPDATE
--      only status and decided_at (resolving).
--   2. The insert policy also requires status = 'pending' and decided_at is
--      null.
--   3. Length bounds (NOT VALID: existing rows are not rechecked; see the
--      pre-check): body ≤ 20,000 characters, title ≤ 500, note ≤ 2,000,
--      chapter path ≤ 300, block id ≤ 200.
--   4. A BEFORE INSERT trigger (security definer, so it can use the private
--      rate-limit counters): at most 20 suggestions per sender per hour, at
--      most 20 pending from one sender to one course, and at most 200 pending
--      in one course's inbox.
--
--   Not required: the sending package being published. Suggest-back comes
--   from an ADAPTATION, and an adaptation starts as a trial course
--   (adaptFromPortalAction); the target must be listed (0025_1), the sender
--   must own the sending package (0025_1).
--
-- READ-ONLY PRE-CHECK (rows the new bounds would not admit; they stay):
--   select count(*) filter (where length(suggested_body) > 20000 or length(coalesce(suggested_title, '')) > 500
--                           or length(note) > 2000 or length(chapter_path) > 300
--                           or length(source_block_id) > 200) as oversized,
--          count(*) as total
--   from public.suggestions;
--
-- DEPLOY ORDER: either order with the r2 code (the code sends only granted
-- columns; it now refuses an over-long body before sending). Apply after
-- 0028_loop_r2_2.

-- ---------------------------------------------------------------------------
-- 1. Column grants.
-- ---------------------------------------------------------------------------
revoke insert, update on public.suggestions from anon, authenticated;
grant insert (target_package_id, from_package_id, from_user_id, chapter_path, source_block_id,
              suggested_title, suggested_body, note, status)
  on public.suggestions to authenticated;
grant update (status, decided_at) on public.suggestions to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A suggestion arrives pending.
-- ---------------------------------------------------------------------------
drop policy if exists "send to a registered package" on public.suggestions;
create policy "send to a registered package" on public.suggestions
  for insert with check (
    (select auth.uid()) = from_user_id
    and (select public.is_active_user())
    and public.caller_owns_package(from_package_id)
    and public.listing_consented(target_package_id)
    and status = 'pending'
    and decided_at is null
  );

-- ---------------------------------------------------------------------------
-- 3. Bounded text.
-- ---------------------------------------------------------------------------
alter table public.suggestions
  drop constraint if exists suggestions_text_bounds;
alter table public.suggestions
  add constraint suggestions_text_bounds check (
    length(suggested_body) <= 20000
    and length(coalesce(suggested_title, '')) <= 500
    and length(note) <= 2000
    and length(chapter_path) <= 300
    and length(source_block_id) <= 200
  ) not valid;

-- ---------------------------------------------------------------------------
-- 4. Arrival limits.
-- ---------------------------------------------------------------------------
create or replace function public.suggestions_arrival_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.rate_limit_hit('suggest:' || coalesce(new.from_user_id::text, ''), 3600) > 20 then
    raise exception 'too many suggestions this hour' using errcode = 'program_limit_exceeded';
  end if;
  if (select count(*) from public.suggestions s
      where s.target_package_id = new.target_package_id
        and s.from_user_id = new.from_user_id
        and s.status = 'pending') >= 20 then
    raise exception 'too many pending suggestions to this course' using errcode = 'program_limit_exceeded';
  end if;
  if (select count(*) from public.suggestions s
      where s.target_package_id = new.target_package_id
        and s.status = 'pending') >= 200 then
    raise exception 'this course''s suggestion inbox is full' using errcode = 'program_limit_exceeded';
  end if;
  return new;
end;
$$;

drop trigger if exists suggestions_arrival_limits on public.suggestions;
create trigger suggestions_arrival_limits
  before insert on public.suggestions
  for each row execute function public.suggestions_arrival_limits();

revoke all on function public.suggestions_arrival_limits() from public, anon, authenticated;
