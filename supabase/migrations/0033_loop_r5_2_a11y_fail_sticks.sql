-- Closed loop r5 (round-5 audit, 2026-10-24), LOW (P5.R.5.h), on owner
-- decision 2 of 2026-10-24 (no current check is neutral in Discover —
-- 0032_decisions_1_a11y_neutral): a FAILED accessibility check is not escaped
-- by moving the head. NOT APPLIED anywhere yet. Requires 0030_loop_r3c_4 (the
-- function redefined here, its latest definition; 0031_loop_r4b_3 re-created
-- only the listing trigger, 0032 touched neither). Apply after
-- 0032_decisions_1_a11y_neutral.
--
-- WHY. Since 0032 a course without a current check ("unknown") ranks NEUTRAL
--   (the accessibility term is left out), above a `fail`. And the expiry rule
--   (packages_a11y_expires, 0030_loop_r3c_4) turned ANY recorded result into
--   "unknown" as soon as the recorded public head moved. So a course whose
--   last completed check FAILED became neutral — no "needs work" badge, no
--   `fail` facet, ranked above every failed course — on its next save, and
--   stayed so whenever the automatic re-check did not complete: the per-course
--   a11yAuto bucket bounds re-checks (an owner saving more than its rate gets
--   no further checks), and a check that cannot read the published copy or
--   whose audit throws records nothing. An owner could escape a fail by saving
--   often or making the audit throw.
--
-- THE FIX. Only a `pass` or `warn` expires when the head moves: a `fail`
--   stays until a newer COMPLETED check records a result (recordA11yCheck sets
--   a11y_status, a11y_checked_at and a11y_checked_sha together, for the head it
--   audited — unchanged). "unknown" (neutral) is now exactly: never checked, or
--   the last completed check was pass/warn and the head moved since.
--   The smallest mechanism: no new column, no change to the projector, the
--   ranking (0032), the listing trigger (0031_loop_r4b_3) or the app — they
--   all read packages.a11y_status, which keeps saying `fail`.
--
-- WHAT IS SHOWN (the choice). Everything that reads the record shows the fail
--   for the changed course, consistently: the anon-readable listing row
--   (portal_registrations.accessibility_status, server-owned since 0030), the
--   Discover row, its facet and badge ("Accessibility: needs work"), and the
--   owner's status line ("needs work (checked … ago)" — the time of the failing
--   check). A fail describes earlier bytes; showing it for later ones can only
--   understate a course, never advertise accessibility nobody checked, and the
--   next completed check (automatic after every save) replaces it.
--
-- THE GAP, documented, not closed: a course whose fail ALREADY expired to
--   "unknown" under 0030 before this migration cannot be told apart from an
--   expired pass/warn (the expired result is not stored anywhere), so it stays
--   neutral until its next completed check. An operator who wants those
--   re-checked can list them (pre-check below) and trigger "Check now".
--
-- COMPOSITION (DecisionLog 2026-10-23, "Composition rule").
--   packages_a11y_expires starts from its latest definition (0030_loop_r3c_4
--   §2) and keeps every rule: it acts only when the recorded head
--   (last_synced_sha) moves, never when the same update records a check
--   (a11y_checked_sha or a11y_status set in the update), never when the head
--   moves to the audited head, and it is a BEFORE UPDATE trigger function
--   with an empty search_path (invoker). Its earlier "<> 'unknown'" guard is
--   subsumed by the new "in ('pass', 'warn')". The trigger itself
--   (packages_a11y_expires, BEFORE UPDATE FOR EACH ROW) and the listing
--   trigger (packages_a11y_to_registration, AFTER UPDATE … WHEN, no column
--   list — 0031_loop_r4b_3) are not touched.
-- loop-r5-sql.sql.test.ts asserts the composition (P5.A.1.r).
--
-- GRANTS. CREATE OR REPLACE keeps the existing ones (none for the API roles —
-- 0030_loop_r3c_4); the revoke is repeated to say so.
--
-- READ-ONLY PRE-CHECKS:
--   -- courses that had a recorded check and now show "not checked" (the gap):
--   select id, a11y_checked_at from public.packages
--   where a11y_status = 'unknown' and a11y_checked_at is not null;
--   -- failed courses (they keep their fail across saves after this):
--   select count(*) from public.packages where a11y_status = 'fail';
--
-- DEPLOY ORDER: after 0032_decisions_1_a11y_neutral (and before or after
-- 0033_loop_r5_1 — independent); either order with the r5 code (no code
-- change). Rollback: re-run the function body of 0030_loop_r3c_4 §2.

create or replace function public.packages_a11y_expires()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- the recorded head moved past the audited bytes, and this same update is
  -- not itself recording a check; r5 (P5.R.5.h): only a pass or warn expires
  -- — a fail stays until a newer completed check records a result
  if new.last_synced_sha is distinct from old.last_synced_sha
     and new.a11y_checked_sha is not distinct from old.a11y_checked_sha
     and new.a11y_status is not distinct from old.a11y_status
     and new.a11y_status in ('pass', 'warn')
     and new.last_synced_sha is distinct from new.a11y_checked_sha then
    new.a11y_status := 'unknown';
  end if;
  return new;
end;
$$;

revoke all on function public.packages_a11y_expires() from public, anon, authenticated;
