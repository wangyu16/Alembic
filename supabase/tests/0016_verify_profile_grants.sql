-- Verification for migration 0016 (docs/specs/user-governance.md §0).
-- Run in the Supabase SQL editor AFTER applying 0016. Everything below is
-- read-only or rolled back; it changes nothing.
--
-- This is a real test, not a formality: the hole it closes let any signed-in
-- user grant themselves `is_admin`, or point `github_installation_id` at
-- another account's GitHub App installation.

-- ---------------------------------------------------------------------------
-- 1. The grants themselves. Expected:
--      can_display_name = true   (the one column a user may set)
--      everything else  = false
-- ---------------------------------------------------------------------------
select
  has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE')
    as can_display_name,
  has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'UPDATE')
    as can_is_admin,
  has_column_privilege('authenticated', 'public.profiles', 'github_username', 'UPDATE')
    as can_github_username,
  has_column_privilege('authenticated', 'public.profiles', 'github_installation_id', 'UPDATE')
    as can_installation_id,
  has_table_privilege('authenticated', 'public.profiles', 'INSERT') as can_insert,
  has_table_privilege('authenticated', 'public.profiles', 'DELETE') as can_delete;

-- ---------------------------------------------------------------------------
-- 2. Live attempt, as a real authenticated user, against their OWN row.
--    Before 0016 this SUCCEEDS (that is the bug). After 0016 each `update`
--    must raise:  ERROR: permission denied for column ...
--
--    Replace the uuid with any real profiles.id, then run each block.
--    Every block ends in `rollback`, so nothing is written either way.
-- ---------------------------------------------------------------------------

-- 2a. self-elevation to admin -> must fail
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
  -- expect: permission denied for column is_admin
  update public.profiles set is_admin = true
   where id = '00000000-0000-0000-0000-000000000000';
rollback;

-- 2b. stealing another account's GitHub App installation -> must fail
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
  -- expect: permission denied for column github_installation_id
  update public.profiles set github_installation_id = 12345
   where id = '00000000-0000-0000-0000-000000000000';
rollback;

-- 2c. the allowed write -> must SUCCEED (0 or 1 rows; RLS still scopes the row)
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
  update public.profiles set display_name = 'still allowed'
   where id = '00000000-0000-0000-0000-000000000000';
rollback;

-- ---------------------------------------------------------------------------
-- 3. Exposure audit. Anyone who exploited the hole would show up here.
--    Expect exactly one row (the owner) once 0017 seeds the bootstrap admin,
--    and ZERO rows before that.
-- ---------------------------------------------------------------------------
select id, github_username, display_name, is_admin, created_at
  from public.profiles
 where is_admin
 order by created_at;
