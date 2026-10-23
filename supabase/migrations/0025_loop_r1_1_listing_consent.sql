-- Security loop r1 (2026-10-23), finding H1: listing consent must come from
-- the package's owner. NOT APPLIED anywhere yet.
--
-- THE HOLE. The portal_registrations write policies (0004, re-created in 0018)
-- checked only `auth.uid() = owner_id`. Any signed-in user could insert a
-- registration row for SOMEONE ELSE's published package (its id is public
-- through the element search) with themselves as owner_id, and the discovery
-- projection (0022) treated any registration row as the Tier-3 consent: the
-- course was listed with the attacker's snapshot, and the real owner could not
-- unlist it (their delete matched no row they "own"). The same row opened the
-- owner's suggestion inbox to the attacker (the inbox policies keyed on the
-- registration's owner_id).
--
-- THE FIX (class: every API-role write policy whose row names a package
-- requires the caller to own that package):
--   1. portal_registrations: insert/update require owning the package; the
--      owner may delete any row on their package (so a stray row can always be
--      removed); owner_id is no longer readable by anon/authenticated (no app
--      code reads it; column grants).
--   2. Listability (projection, public read policy, search, facets) requires
--      the registration's owner_id to BE the package owner.
--   3. suggestions: the sender must own from_package_id; the inbox is read and
--      resolved by the target PACKAGE's owner; consent = a registration the
--      package owner wrote.
--   4. package_changes and ai_invocations: a row naming a package requires
--      owning it. (documents and sandbox_files already required it;
--      research_events loses its client insert policy in
--      0025_loop_r1_research_events.sql.)
--   5. Clean-up: registration rows whose owner_id is not the package owner are
--      deleted (the projection drops them through its trigger).
--
-- OPERATOR PRE-CHECK (run first; reports how many rows step 5 will delete):
--   select r.package_id, r.owner_id as registered_by, p.owner_id as package_owner, r.registered_at
--   from public.portal_registrations r join public.packages p on p.id = r.package_id
--   where r.owner_id <> p.owner_id;
-- Also worth a look (suggestions sent "from" a package the sender does not own;
-- not deleted here — they are readable only by their sender and the target's owner):
--   select s.id from public.suggestions s join public.packages p on p.id = s.from_package_id
--   where p.owner_id <> s.from_user_id;
--
-- DEPLOY ORDER: deploy the loop-r1 web code FIRST, then apply this file. The
-- new registerPackageAction no longer sends owner_id (it defaults to the
-- caller, see step 1); the old code's upsert sets owner_id and would be refused
-- once owner_id is no longer selectable ("Could not list the package"). The new
-- code works before and after this file. Requires 0018 and 0022.

-- ---------------------------------------------------------------------------
-- 0. One definition of "the caller owns this package" for the policies.
--    Runs as the caller: the packages RLS already shows a user only their own
--    rows (and nothing to a banned account).
-- ---------------------------------------------------------------------------
create or replace function public.caller_owns_package(p_package_id text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.packages p
    where p.id = p_package_id and p.owner_id = (select auth.uid())
  )
$$;
revoke all on function public.caller_owns_package(text) from public;
grant execute on function public.caller_owns_package(text) to anon, authenticated, service_role;

-- Consent: a registration row written by the package's owner. Security
-- definer because a suggestion's sender cannot read the target package row;
-- it discloses only "is this package's listing consent on record".
create or replace function public.listing_consented(p_package_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.portal_registrations r
    join public.packages p on p.id = r.package_id
    where r.package_id = p_package_id and r.owner_id = p.owner_id
  )
$$;
revoke all on function public.listing_consented(text) from public, anon;
grant execute on function public.listing_consented(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. portal_registrations
-- ---------------------------------------------------------------------------
drop policy if exists "owner insert" on public.portal_registrations;
create policy "owner insert" on public.portal_registrations
  for insert with check (
    (select auth.uid()) = owner_id
    and (select public.is_active_user())
    and public.caller_owns_package(package_id)
  );

drop policy if exists "owner update" on public.portal_registrations;
create policy "owner update" on public.portal_registrations
  for update
  using (
    (select auth.uid()) = owner_id
    and (select public.is_active_user())
    and public.caller_owns_package(package_id)
  )
  with check (
    (select auth.uid()) = owner_id
    and (select public.is_active_user())
    and public.caller_owns_package(package_id)
  );

drop policy if exists "owner delete" on public.portal_registrations;
create policy "owner delete" on public.portal_registrations
  for delete using (
    (select public.is_active_user())
    and ((select auth.uid()) = owner_id or public.caller_owns_package(package_id))
  );

-- No public reader needs the owner's user id. Column grants (RLS restricts
-- rows, not columns): every column but owner_id stays publicly readable.
-- An upsert that SETs owner_id reads `excluded.owner_id`, which now needs a
-- privilege the API roles lack, so the column defaults to the caller and the
-- app (loop-r1 code) no longer sends it — hence code first, then this file.
alter table public.portal_registrations alter column owner_id set default auth.uid();
revoke select on public.portal_registrations from anon, authenticated;
grant select (package_id, title, description, discipline, license, public_repo_url,
              site_url, registered_at, accessibility_status, keywords)
  on public.portal_registrations to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Listability: the consent row must be the package owner's.
-- ---------------------------------------------------------------------------
create or replace function public.discovery_course_listable(p_package_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.packages p
    join public.portal_registrations r on r.package_id = p.id and r.owner_id = p.owner_id
    where p.id = p_package_id
      and p.storage = 'github'
      and p.archived_at is null
      and public.discovery_open_license(p.manifest ->> 'license')
      and coalesce(p.manifest -> 'publicRepo' ->> 'owner', '') <> ''
      and coalesce(p.manifest -> 'publicRepo' ->> 'name', '') <> ''
  )
$$;

create or replace function public.discovery_course_matches(p_q text)
returns table (package_id text, relevance double precision)
language sql
stable
security definer
set search_path = ''
set pg_trgm.word_similarity_threshold = 0.45
as $$
  with q as (
    select v.q, v.q <> '' as has_q,
           case when v.q <> '' then websearch_to_tsquery('english', v.q) end as web,
           public.discovery_prefix_query(v.q) as prefix
    from (select left(btrim(coalesce(p_q, '')), 200) as q) v
  )
  select c.package_id,
         case when q.has_q
              then public.discovery_relevance(c.search_vector, c.search_text, q.web, q.prefix, q.q)
              else 1.0 end
  from public.discovery_courses c
  cross join q
  join public.packages p on p.id = c.package_id
  where p.storage = 'github'
    and p.archived_at is null
    and public.discovery_open_license(p.manifest ->> 'license')
    and exists (select 1 from public.portal_registrations r
                where r.package_id = c.package_id and r.owner_id = p.owner_id)
    and (not q.has_q
         or c.search_vector @@ q.web
         or c.search_vector @@ q.prefix
         or q.q operator(extensions.<%) c.search_text)
$$;
revoke all on function public.discovery_course_matches(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. suggestions
-- ---------------------------------------------------------------------------
drop policy if exists "send to a registered package" on public.suggestions;
create policy "send to a registered package" on public.suggestions
  for insert with check (
    (select auth.uid()) = from_user_id
    and (select public.is_active_user())
    and public.caller_owns_package(from_package_id)
    and public.listing_consented(target_package_id)
  );

drop policy if exists "owner or sender reads" on public.suggestions;
create policy "owner or sender reads" on public.suggestions
  for select using (
    (select auth.uid()) = from_user_id
    or public.caller_owns_package(target_package_id)
  );

drop policy if exists "owner resolves" on public.suggestions;
create policy "owner resolves" on public.suggestions
  for update
  using ((select public.is_active_user()) and public.caller_owns_package(target_package_id))
  with check ((select public.is_active_user()) and public.caller_owns_package(target_package_id));

-- ---------------------------------------------------------------------------
-- 4. package_changes, ai_invocations
-- ---------------------------------------------------------------------------
drop policy if exists "owner manages changes" on public.package_changes;
create policy "owner manages changes" on public.package_changes
  for all
  using (
    (select auth.uid()) = user_id
    and (select public.is_active_user())
    and public.caller_owns_package(package_id)
  )
  with check (
    (select auth.uid()) = user_id
    and (select public.is_active_user())
    and public.caller_owns_package(package_id)
  );

drop policy if exists "insert own invocations" on public.ai_invocations;
create policy "insert own invocations" on public.ai_invocations
  for insert with check (
    (select auth.uid()) = user_id
    and (select public.is_active_user())
    and (package_id is null or public.caller_owns_package(package_id))
  );

-- ---------------------------------------------------------------------------
-- 5. Clean-up: consent rows the package owner did not write.
-- ---------------------------------------------------------------------------
delete from public.portal_registrations r
using public.packages p
where p.id = r.package_id
  and r.owner_id <> p.owner_id;
