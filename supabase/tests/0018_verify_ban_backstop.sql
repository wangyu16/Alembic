-- Verification for migrations 0017 + 0018 (docs/specs/user-governance.md §2.1).
-- Run in the Supabase SQL editor AFTER applying both. Every mutating block is
-- rolled back; nothing here changes your data.
--
-- What it proves: a banned account cannot write, even while holding an access
-- token minted before the ban. That is the window Supabase's own ban leaves
-- open (a JWT is stateless and cannot be revoked), and it is the whole reason
-- is_active_user() exists.

-- ---------------------------------------------------------------------------
-- 1. The pieces exist and the owner is bootstrapped.
--    Expect: one row, is_admin = true, ai_status = 'approved'.
-- ---------------------------------------------------------------------------
select p.id, p.github_username, p.is_admin, p.ai_status
  from public.profiles p
 where p.is_admin;

-- Expect: exactly the 8 write policies from 0018 mention is_active_user.
select tablename, policyname
  from pg_policies
 where schemaname = 'public'
   and (qual like '%is_active_user%' or with_check like '%is_active_user%')
 order by tablename, policyname;

-- Expect: 'none' — a brand-new account has no AI until an admin grants it.
select column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles' and column_name = 'ai_status';

-- ---------------------------------------------------------------------------
-- 2. The live test. Find-and-replace the placeholder uuid below with a REAL,
--    NON-ADMIN profiles.id (it appears 7 times). Banning yourself and rolling
--    back is safe; banning yourself and forgetting to roll back is not — so do
--    not use the owner account.
--
--    Run each `begin … rollback` block on its own. The SQL editor has no psql
--    variables, hence the literal uuids.
-- ---------------------------------------------------------------------------

-- 2a. Baseline: an ACTIVE user may insert a package.  Expect: INSERT 0 1
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
  insert into public.packages (id, owner_id, title, manifest, storage)
  values ('pkg-rls-probe', '00000000-0000-0000-0000-000000000000', 'probe', '{}'::jsonb, 'sandbox');
rollback;

-- 2b. Now ban them, keep the SAME session/JWT (this models the residual token
--     window), and retry. Expect: ERROR — new row violates row-level security.
begin;
  update auth.users
     set banned_until = now() + interval '100 years'
   where id = '00000000-0000-0000-0000-000000000000';

  set local role authenticated;
  set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';

  -- must fail:
  insert into public.packages (id, owner_id, title, manifest, storage)
  values ('pkg-rls-probe-2', '00000000-0000-0000-0000-000000000000', 'probe', '{}'::jsonb, 'sandbox');
rollback;   -- undoes BOTH the ban and the insert

-- 2c. is_active_user() itself, from the banned user's seat. Expect: false.
begin;
  update auth.users
     set banned_until = now() + interval '100 years'
   where id = '00000000-0000-0000-0000-000000000000';
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
  select public.is_active_user() as should_be_false;
rollback;

-- ---------------------------------------------------------------------------
-- 3. A user still cannot approve their own AI (0016 column grants + 0017).
--    Expect: false, false.
-- ---------------------------------------------------------------------------
select
  has_column_privilege('authenticated', 'public.profiles', 'ai_status', 'UPDATE') as can_set_ai_status,
  has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'UPDATE')  as can_set_is_admin;

-- Expect: 0 rows — the audit log is not readable by ordinary users.
select has_table_privilege('authenticated', 'public.admin_audit', 'SELECT') as can_read_audit;
