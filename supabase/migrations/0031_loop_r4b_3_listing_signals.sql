-- Closed loop r4, part B (round-4 security audit, 2026-10-24), LOW-1 (class a)
-- (P5.S.3.h, P5.S.17), and the round-4 listing_history LOW (P5.S.1.h): the
-- anon-readable listing row follows EVERY change of the server's
-- accessibility record. NOT APPLIED anywhere yet. Requires 0030_loop_r3c_4
-- (the trigger re-created here, its latest definition). Apply after
-- 0031_loop_r4b_2.
--
-- COMPOSITION. No function is redefined. The trigger packages_a11y_to_registration
-- (0030_loop_r3c_4 §1) is re-created on the same function with the same WHEN
-- clause (new.a11y_status is distinct from old.a11y_status); only its column
-- list (`of a11y_status`) goes. The expiry rule (packages_a11y_expires) and the
-- badge are untouched (owner decision pending on the expiry semantics).
--
-- THE HOLE (repro /tmp/alembic-r4/a11y.test.ts). `AFTER UPDATE OF a11y_status`
--   fires only when the UPDATE statement's SET list names a11y_status. The
--   r3c expiry is a BEFORE trigger (packages_a11y_expires) that changes
--   new.a11y_status when a save moves last_synced_sha — a statement that never
--   names a11y_status. So packages and Discover said "not checked" while the
--   anon-readable portal_registrations row kept advertising "pass" for bytes
--   nobody checked.
--
-- THE FIX.
--   1. The trigger fires on every UPDATE of packages and its WHEN clause (which
--      sees the row after every BEFORE trigger) decides. A generic test
--      (loop-r4b-listing.sql.test.ts, P5.S.17) now flags any `update of <col>`
--      trigger whose column a BEFORE UPDATE trigger of the same table assigns.
--   2. Listing rows that went stale since 0030_loop_r3c_4 are corrected (the
--      BEFORE trigger on portal_registrations re-derives the value).
--   3. listing_history (0030_loop_r3c_4 §3) is back-filled again from the
--      listing rows (idempotent: a missing first-listing record is added, an
--      earlier listing time wins). THE GAP, documented, not closed: a course
--      unlisted BEFORE 0030_loop_r3c_4 was applied has no listing row to
--      back-fill from, so its next listing counts as its first; and a listing
--      row whose registered_at an unlist/re-list refreshed before that
--      migration seeded the ledger with the refreshed time. The only other
--      record (research_events 'portal.registered') is research data; using it
--      for a product signal is an owner decision (DecisionLog 2026-10-24).
--
-- READ-ONLY PRE-CHECKS:
--   -- listing rows advertising a status the server no longer records (§2 corrects them):
--   select count(*) from public.portal_registrations r join public.packages p on p.id = r.package_id
--   where r.accessibility_status is distinct from p.a11y_status;
--   -- listing rows without a first-listing record (§3 adds them):
--   select count(*) from public.portal_registrations r
--   where not exists (select 1 from public.listing_history h where h.package_id = r.package_id);
--
-- DEPLOY ORDER: either order with the r4b code; no code change depends on it.

-- ---------------------------------------------------------------------------
-- 1. Every change of the record reaches the listing row.
-- ---------------------------------------------------------------------------
drop trigger if exists packages_a11y_to_registration on public.packages;
create trigger packages_a11y_to_registration
  after update on public.packages
  for each row
  when (new.a11y_status is distinct from old.a11y_status)
  execute function public.packages_a11y_to_registration();

-- ---------------------------------------------------------------------------
-- 2. Correct what is stored.
-- ---------------------------------------------------------------------------
update public.portal_registrations r
set accessibility_status = p.a11y_status
from public.packages p
where p.id = r.package_id
  and r.accessibility_status is distinct from p.a11y_status;

-- ---------------------------------------------------------------------------
-- 3. The first-listing ledger, back-filled again where a listing row exists.
-- ---------------------------------------------------------------------------
insert into public.listing_history (package_id, first_listed_at)
select package_id, registered_at from public.portal_registrations
on conflict (package_id) do update
  set first_listed_at = least(public.listing_history.first_listed_at, excluded.first_listed_at);
