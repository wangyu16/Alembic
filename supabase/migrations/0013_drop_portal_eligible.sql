-- Cleanup: drop the vestigial portal-listing eligibility gate.
--
-- Public portal listing is now open to every educator (the grant-period
-- participant-only gate was removed from registerPackageAction). The
-- profiles.portal_eligible column (migration 0010) and its /admin toggle no
-- longer gate anything; this drops the column.
--
-- Ordering: apply AFTER the code that stopped selecting this column is
-- deployed. Once deployed, no code references portal_eligible, so dropping it
-- is safe; apply whenever convenient.

alter table public.profiles
  drop column if exists portal_eligible;
