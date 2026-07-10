-- G0 — close a privilege-escalation hole in `profiles`.
-- See docs/specs/user-governance.md §0.
--
-- RLS policies restrict ROWS, not COLUMNS. The policy from 0001_init.sql:
--
--   create policy "update own profile" on public.profiles
--     for update using ((select auth.uid()) = id);
--
-- lets a user update *their own row*, but says nothing about which columns. And
-- NEXT_PUBLIC_SUPABASE_ANON_KEY ships to the browser by design (the sign-in page
-- uses it), so any signed-in user can skip the Next.js app entirely, call
-- PostgREST with their own JWT, and set:
--
--   * is_admin = true               -> full admin (requireAdmin() trusts this column)
--   * github_installation_id = <someone else's>
--       -> clientForUser() then mints a GitHub App token for THAT installation,
--          i.e. commit access to another account's repositories.
--
-- No application code writes those columns, which is why this went unnoticed.
-- Postgres has a column-level GRANT for exactly this; RLS cannot express it.
--
-- After this migration `authenticated` may update ONLY `display_name` on its own
-- row (the row restriction still comes from the RLS policy). Everything else —
-- is_admin, github_username, github_installation_id, and the account-status
-- columns added in 0017 — is writable only by the service role, i.e. only by
-- server code running behind an explicit gate.

-- Blanket UPDATE is what the default `grant all ... to authenticated` handed out.
revoke update on public.profiles from authenticated, anon;
-- profiles has no INSERT/DELETE policy, so RLS already blocks these. Revoke the
-- table privilege too, so the block does not depend on a policy staying absent.
revoke insert, delete on public.profiles from authenticated, anon;

-- The one column a user may set on themselves.
grant update (display_name) on public.profiles to authenticated;

-- Make the row restriction explicit on both sides. Postgres defaults an UPDATE
-- policy's `with check` to its `using` expression; stating it removes the
-- reliance on that default (and on a reader knowing it).
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

comment on table public.profiles is
  'One row per platform user. authenticated may UPDATE only display_name (column grant, 0016); is_admin/status/ai_status/github_* are service-role only.';
