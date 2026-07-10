-- G1 — user governance schema. See docs/specs/user-governance.md.
--
-- Two axes, stored where their authority lives:
--   * "may this account sign in?"  -> auth.users.banned_until (Supabase native,
--     set via auth.admin.updateUserById({ban_duration})). NOT mirrored here:
--     two copies of one fact drift the first time one write succeeds and the
--     other fails.
--   * "may it use the AI assistant?" -> public.profiles.ai_status, below.
--
-- Depends on 0016: blanket UPDATE on profiles is revoked from `authenticated`,
-- and column privileges are granted one at a time. The columns added here are
-- therefore NOT user-writable — a user cannot approve their own AI access. Do
-- not `grant update (...)` on them.

-- ---------------------------------------------------------------------------
-- AI access. Default 'none' so an account nobody has thought about has no AI.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists ai_status text not null default 'none'
    check (ai_status in ('none', 'requested', 'approved')),
  add column if not exists ai_requested_at timestamptz,
  add column if not exists ai_decided_at timestamptz,
  add column if not exists ai_decided_by uuid references public.profiles (id) on delete set null;

comment on column public.profiles.ai_status is
  'none -> requested (educator asks) -> approved (admin grants). Service-role writes only; see 0016 column grants.';

-- ---------------------------------------------------------------------------
-- is_active_user(): the RLS backstop for a banned account.
--
-- Banning stops new sign-ins and refresh-token exchange, but an access token
-- minted before the ban stays valid until it expires (~1h) — a JWT is stateless
-- and cannot be revoked, and auth.admin.signOut() needs the target's own JWT,
-- which an admin does not have. This closes that window in the database, where
-- it costs no application call sites.
--
-- Reads auth.users directly, so banned_until stays the single source of truth.
-- SECURITY DEFINER because `authenticated` cannot select from auth.users.
-- ---------------------------------------------------------------------------
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users
    where id = (select auth.uid())
      and (banned_until is null or banned_until < now())
  );
$$;

revoke all on function public.is_active_user() from public;
grant execute on function public.is_active_user() to authenticated;

comment on function public.is_active_user() is
  'True when the caller exists and is not banned. Used in write RLS policies; always call as (select public.is_active_user()) so Postgres hoists it to an InitPlan instead of re-evaluating per row.';

-- ---------------------------------------------------------------------------
-- can_use_ai(): the single question GovernedProvider asks before every model
-- call. One round trip, one definition, and the answer is composed here rather
-- than in TypeScript so it cannot drift from the RLS rules above.
--
-- SECURITY DEFINER so it can read auth.users (banned_until); it discloses only
-- a boolean about the *caller*, never about anyone else.
-- ---------------------------------------------------------------------------
create or replace function public.can_use_ai()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.id = (select auth.uid())
       and p.ai_status = 'approved'
       and (u.banned_until is null or u.banned_until < now())
  );
$$;

revoke all on function public.can_use_ai() from public;
grant execute on function public.can_use_ai() to authenticated;

comment on function public.can_use_ai() is
  'True only when the caller is not banned AND ai_status = approved. Callers must fail CLOSED on error — unlike the rate-limit/budget checks beside it, which fail open by design.';

-- ---------------------------------------------------------------------------
-- Bootstrap admins. A table rather than a hard-coded literal, so the signup
-- trigger can also flag a matching account on a fresh database (or after a
-- re-signup) without anyone remembering to run SQL by hand.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_bootstrap_logins (
  login text primary key
);
alter table public.admin_bootstrap_logins enable row level security;
revoke all on public.admin_bootstrap_logins from authenticated, anon;
-- No policies: unreachable except by the service role and SECURITY DEFINER code.

insert into public.admin_bootstrap_logins (login) values ('wangyu16')
  on conflict (login) do nothing;

-- ---------------------------------------------------------------------------
-- Admin audit trail. Who did what, to whom, when, and why.
-- ---------------------------------------------------------------------------
create table if not exists public.admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  target_id uuid references public.profiles (id) on delete set null,
  action text not null check (
    action in ('disable_user', 'enable_user', 'approve_ai', 'revoke_ai')
  ),
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_target_idx on public.admin_audit (target_id, created_at desc);

alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from authenticated, anon;
-- No policies: service-role only. An audit log a user can read or write is not
-- an audit log.

-- ---------------------------------------------------------------------------
-- Signup trigger: create the profile, and flag a bootstrap admin.
-- Replaces the 0001_init.sql definition.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  -- NOT named `login`: that would collide with admin_bootstrap_logins.login and
  -- make `b.login = login` an ambiguous reference.
  gh_login text := new.raw_user_meta_data ->> 'user_name';
  bootstrap boolean := exists (
    select 1 from public.admin_bootstrap_logins b where b.login = gh_login
  );
begin
  insert into public.profiles (id, github_username, display_name, is_admin, ai_status, ai_decided_at)
  values (
    new.id,
    gh_login,
    coalesce(new.raw_user_meta_data ->> 'full_name', gh_login),
    bootstrap,
    case when bootstrap then 'approved' else 'none' end,
    case when bootstrap then now() else null end
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Seed the existing owner account. Matches on either the stored username or the
-- original OAuth login, because api/github/installed/route.ts overwrites
-- profiles.github_username with the *installation account* login, which may be
-- an organisation.
-- ---------------------------------------------------------------------------
update public.profiles p
   set is_admin = true,
       ai_status = 'approved',
       ai_decided_at = coalesce(p.ai_decided_at, now())
  from auth.users u
 where u.id = p.id
   and (
     exists (select 1 from public.admin_bootstrap_logins b where b.login = p.github_username)
     or exists (select 1 from public.admin_bootstrap_logins b where b.login = (u.raw_user_meta_data ->> 'user_name'))
   );
