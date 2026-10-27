-- 0042: Publish records and course-plan approvals (workspace v3, A11).
--
-- publisher-v3 §3, queue-and-jobs §5. publish_runs: one row per run, written
-- 'pending' BEFORE the public commit (with its trailer id) and 'committed'
-- right after, so a crash never makes the next run mistake its own commit for
-- drift. published_files: what each public path holds and which unit it
-- belongs to (per-file publication, replacing storage = 'github').
-- approvals: a course-plan part approved at an exact content version.
-- All service-role written; members read their course's rows.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: any.

create table public.publish_runs (
  id            uuid primary key default gen_random_uuid(),
  package_id    text not null references public.packages (id) on delete cascade,
  by_user       uuid not null references public.profiles (id),
  working_sha   text not null,
  public_parent text,               -- the public head the commit was built on (null = first publish)
  public_sha    text,               -- set when committed
  status        text not null check (status in ('pending', 'committed', 'site-built', 'site-failed', 'stopped')),
  choices       jsonb not null default '{}',
  results       jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  committed_at  timestamptz
);
create index publish_runs_pkg on public.publish_runs (package_id, created_at desc);

create table public.published_files (
  package_id text not null references public.packages (id) on delete cascade,
  path       text not null,
  unit       text not null,
  blob_sha   text not null,          -- git blob id in the public repo
  version    text,                   -- sha256 of the text (null for binary)
  run_id     uuid not null references public.publish_runs (id),
  primary key (package_id, path)
);

create table public.public_acknowledged (
  package_id text primary key references public.packages (id) on delete cascade,
  public_sha text not null,          -- the public head Alembic last wrote or acknowledged (drift baseline)
  updated_at timestamptz not null default now()
);

create table public.approvals (
  package_id    text not null references public.packages (id) on delete cascade,
  part_path     text not null check (part_path ~ '^(concepts|assessment-support)/'),
  version       text not null check (version ~ '^[0-9a-f]{64}$'),
  approver_id   uuid not null references public.profiles (id),
  approver_role text not null check (approver_role in ('owner', 'deputy')),
  at            timestamptz not null default now(),
  primary key (package_id, part_path, version)
);

do $$
declare t text;
begin
  foreach t in array array['publish_runs','published_files','public_acknowledged','approvals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy "members read" on public.%I for select to authenticated using ((select public.course_role(package_id)) is not null)', t);
  end loop;
end $$;

-- approve_part: owner or deputy approves a course-plan part at a version.
create function public.approve_part(p text, p_path text, p_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_role text := public.course_role(p);
begin
  if v_role not in ('owner', 'deputy') then
    raise exception 'Only the owner or deputy approves the course plan' using errcode = '42501';
  end if;
  insert into public.approvals (package_id, part_path, version, approver_id, approver_role)
  values (p, p_path, p_version, (select auth.uid()), v_role)
  on conflict do nothing;
end $$;
revoke execute on function public.approve_part(text, text, text) from public, anon;
grant execute on function public.approve_part(text, text, text) to authenticated;
