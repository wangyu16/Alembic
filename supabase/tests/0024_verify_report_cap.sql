-- Verification for migration 0024 (Phase 5 hardening; portal-governance.md).
-- Run in the Supabase SQL editor AFTER applying 0023 and 0024. Section 1 is
-- read-only; section 2 runs inside a transaction that is rolled back.

-- ---------------------------------------------------------------------------
-- 1. Grants. Expected: every column false except service_can_file = true.
-- ---------------------------------------------------------------------------
select
  has_table_privilege('anon', 'public.portal_reports', 'INSERT') as anon_can_insert,
  has_table_privilege('authenticated', 'public.portal_reports', 'INSERT') as authenticated_can_insert,
  has_function_privilege('anon', 'public.file_portal_report(text, text, uuid)', 'EXECUTE') as anon_can_file,
  has_function_privilege('authenticated', 'public.file_portal_report(text, text, uuid)', 'EXECUTE') as authenticated_can_file,
  has_function_privilege('service_role', 'public.file_portal_report(text, text, uuid)', 'EXECUTE') as service_can_file,
  exists (select 1 from pg_policies where tablename = 'portal_reports' and policyname = 'anyone can report')
    as old_policy_present;

-- ---------------------------------------------------------------------------
-- 2. Live attempt with the public anon role. Before 0024 the insert SUCCEEDS
--    (that is the hole). After 0024 it must raise:
--      ERROR: permission denied for table portal_reports
-- ---------------------------------------------------------------------------
begin;
set local role anon;
insert into public.portal_reports (package_id, reason) values ('verify-0024', 'verification');
rollback;
