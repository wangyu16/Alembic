-- Portal / discovery index (M7). Public-safe metadata for registered packages.
-- This is a projection: the source of truth stays in the repos. Registration
-- is an explicit, gated educator action (Tier 3).

create table public.portal_registrations (
  package_id text primary key references public.packages (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  description text not null default '',
  discipline text not null default 'chemistry',
  license text not null,
  public_repo_url text not null,
  site_url text not null,
  registered_at timestamptz not null default now()
);

create index portal_registrations_time_idx
  on public.portal_registrations (registered_at desc);

alter table public.portal_registrations enable row level security;

-- The index is public: anyone (including signed-out visitors) can read it.
create policy "public read" on public.portal_registrations
  for select using (true);

-- Only the owner may register / update / remove their own package.
create policy "owner insert" on public.portal_registrations
  for insert with check ((select auth.uid()) = owner_id);
create policy "owner update" on public.portal_registrations
  for update using ((select auth.uid()) = owner_id);
create policy "owner delete" on public.portal_registrations
  for delete using ((select auth.uid()) = owner_id);
