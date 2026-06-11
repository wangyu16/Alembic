-- Alembic platform schema, v0.1 / M1.
-- Platform records only: all package CONTENT state here (sandbox_files) is
-- either sandbox-canonical (pre-GitHub) or a rebuildable projection once a
-- package graduates — repositories are the source of truth after graduation.

-- ---------------------------------------------------------------------------
-- profiles: one row per platform user, keyed to Supabase Auth.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  github_username text,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "read own profile" on public.profiles
  for select using ((select auth.uid()) = id);

create policy "update own profile" on public.profiles
  for update using ((select auth.uid()) = id);

-- Auto-create a profile on signup, copying GitHub identity from user metadata.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, github_username, display_name)
  values (
    new.id,
    new.raw_user_meta_data ->> 'user_name',
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'user_name')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- packages: one row per package (platform record, not package content).
-- ---------------------------------------------------------------------------
create table public.packages (
  id text primary key, -- contract packageId (pkg-…)
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  manifest jsonb not null,
  storage text not null default 'sandbox' check (storage in ('sandbox', 'github')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index packages_owner_idx on public.packages (owner_id);

alter table public.packages enable row level security;

create policy "owner full access" on public.packages
  for all using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- ---------------------------------------------------------------------------
-- sandbox_files: trial-sandbox package content, partitioned by repo kind so
-- the public/private separation physically exists before GitHub does.
-- ---------------------------------------------------------------------------
create table public.sandbox_files (
  package_id text not null references public.packages (id) on delete cascade,
  repo text not null check (repo in ('public', 'private')),
  path text not null,
  content text not null,
  updated_at timestamptz not null default now(),
  primary key (package_id, repo, path)
);

alter table public.sandbox_files enable row level security;

create policy "owner full access" on public.sandbox_files
  for all using (
    (select auth.uid()) = (select owner_id from public.packages p where p.id = package_id)
  )
  with check (
    (select auth.uid()) = (select owner_id from public.packages p where p.id = package_id)
  );

-- ---------------------------------------------------------------------------
-- research_events: append-only instrumentation (platform records, never
-- package documents). Users can insert their own events but never read the
-- event store; export is a service-role/admin operation.
-- ---------------------------------------------------------------------------
create table public.research_events (
  id bigint generated always as identity primary key,
  type text not null,
  user_id uuid not null,
  package_id text,
  duration_ms integer check (duration_ms >= 0),
  detail jsonb not null default '{}',
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index research_events_user_idx on public.research_events (user_id, occurred_at);

alter table public.research_events enable row level security;

create policy "insert own events" on public.research_events
  for insert with check ((select auth.uid()) = user_id);
-- No select/update/delete policies: append-only for users by design.
