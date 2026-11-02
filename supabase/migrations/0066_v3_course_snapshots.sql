-- 0066: course snapshots (history-v3 §5). A snapshot is a tag `snapshot/<slug>`
-- on the course's working repo plus this row; the row's commit is the
-- authority (a tag pushed or moved on GitHub is ignored). Members read; the
-- server writes.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: before the web app that lists them.

create table public.course_snapshots (
  package_id  text not null references public.packages (id) on delete cascade,
  slug        text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 70),
  name        text not null check (length(name) between 1 and 120),
  commit_sha  text not null check (commit_sha ~ '^[0-9a-f]{40}$'),
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  primary key (package_id, slug)
);
alter table public.course_snapshots enable row level security;
revoke all on public.course_snapshots from anon, authenticated;
grant select on public.course_snapshots to authenticated;
create policy "members read their course snapshots" on public.course_snapshots
  for select to authenticated using ((select public.course_role(package_id)) is not null);
