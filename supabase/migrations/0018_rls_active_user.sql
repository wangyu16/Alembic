-- G2 — deny writes from a banned account. See docs/specs/user-governance.md §2.1.
--
-- Banning (auth.users.banned_until) blocks new sign-ins and refresh-token
-- exchange, but an access token minted before the ban remains valid until it
-- expires. This closes that window at the database, so it needs no application
-- call sites and no future action can forget it.
--
-- Every policy below is recreated with its ORIGINAL predicate unchanged, plus
-- `and (select public.is_active_user())`. The `(select ...)` wrapper is not
-- cosmetic: it lets Postgres hoist the call to an InitPlan evaluated once per
-- statement, instead of once per row (the same reason the existing policies say
-- `(select auth.uid())`).
--
-- Deliberately NOT touched:
--   * profiles              — a banned user updating their own display_name is
--                             harmless, and locking it would complicate G0.
--   * portal_registrations "public read" — anonymous discovery must keep working.
--   * portal_reports "anyone can report" — abuse reporting is open by design
--                             (reporter_id is nullable); see spec §2.5.
--   * documents / suggestions SELECT policies — reads, not writes.

-- ---------------------------------------------------------------------------
-- packages, sandbox_files: `for all`, so the check lands on reads too. That is
-- intended under the login-block model — a banned account should reach nothing.
-- ---------------------------------------------------------------------------
drop policy if exists "owner full access" on public.packages;
create policy "owner full access" on public.packages
  for all
  using ((select auth.uid()) = owner_id and (select public.is_active_user()))
  with check ((select auth.uid()) = owner_id and (select public.is_active_user()));

drop policy if exists "owner full access" on public.sandbox_files;
create policy "owner full access" on public.sandbox_files
  for all
  using (
    (select auth.uid()) = (select owner_id from public.packages p where p.id = package_id)
    and (select public.is_active_user())
  )
  with check (
    (select auth.uid()) = (select owner_id from public.packages p where p.id = package_id)
    and (select public.is_active_user())
  );

-- ---------------------------------------------------------------------------
-- package_changes: `for all`.
-- ---------------------------------------------------------------------------
drop policy if exists "owner manages changes" on public.package_changes;
create policy "owner manages changes" on public.package_changes
  for all
  using ((select auth.uid()) = user_id and (select public.is_active_user()))
  with check ((select auth.uid()) = user_id and (select public.is_active_user()));

-- ---------------------------------------------------------------------------
-- portal_registrations: writes only. "public read" stays untouched.
-- ---------------------------------------------------------------------------
drop policy if exists "owner insert" on public.portal_registrations;
create policy "owner insert" on public.portal_registrations
  for insert with check ((select auth.uid()) = owner_id and (select public.is_active_user()));

drop policy if exists "owner update" on public.portal_registrations;
create policy "owner update" on public.portal_registrations
  for update using ((select auth.uid()) = owner_id and (select public.is_active_user()));

drop policy if exists "owner delete" on public.portal_registrations;
create policy "owner delete" on public.portal_registrations
  for delete using ((select auth.uid()) = owner_id and (select public.is_active_user()));

-- ---------------------------------------------------------------------------
-- documents: insert + update. The owner SELECT policy is untouched.
-- ---------------------------------------------------------------------------
drop policy if exists "owner inserts documents" on public.documents;
create policy "owner inserts documents" on public.documents
  for insert with check (
    (select auth.uid()) = (select owner_id from public.packages p where p.id = package_id)
    and (select public.is_active_user())
  );

drop policy if exists "owner updates documents" on public.documents;
create policy "owner updates documents" on public.documents
  for update
  using (
    (select auth.uid()) = (select owner_id from public.packages p where p.id = package_id)
    and (select public.is_active_user())
  )
  with check (
    (select auth.uid()) = (select owner_id from public.packages p where p.id = package_id)
    and (select public.is_active_user())
  );

-- ---------------------------------------------------------------------------
-- suggestions: insert (send) + update (resolve). The SELECT policy is untouched.
-- ---------------------------------------------------------------------------
drop policy if exists "send to a registered package" on public.suggestions;
create policy "send to a registered package" on public.suggestions
  for insert with check (
    (select auth.uid()) = from_user_id
    and (select public.is_active_user())
    and exists (
      select 1 from public.portal_registrations r
      where r.package_id = target_package_id
    )
  );

drop policy if exists "owner resolves" on public.suggestions;
create policy "owner resolves" on public.suggestions
  for update using (
    (select public.is_active_user())
    and exists (
      select 1 from public.portal_registrations r
      where r.package_id = target_package_id and r.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- research_events, ai_invocations: append-only inserts.
--
-- Both are written on paths whose failures are swallowed (research logging must
-- never break an educator workflow; ai_invocations is written after a call the
-- AI gate has already authorised). Adding the check costs nothing and keeps the
-- rule uniform: a banned account writes nothing.
-- ---------------------------------------------------------------------------
drop policy if exists "insert own events" on public.research_events;
create policy "insert own events" on public.research_events
  for insert with check ((select auth.uid()) = user_id and (select public.is_active_user()));

drop policy if exists "insert own invocations" on public.ai_invocations;
create policy "insert own invocations" on public.ai_invocations
  for insert with check ((select auth.uid()) = user_id and (select public.is_active_user()));
