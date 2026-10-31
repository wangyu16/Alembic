-- Shared elements (docs/specs/v3/element-sharing-v3.md): a figure or a section of a published page, shared at a
-- permanent address /e/<id>. Rows are written by the server only (the share action re-checks the right to edit the
-- page); members read their course's rows; the public element page reads active rows with the service role.
create table if not exists public.shared_elements (
  id          text primary key check (id ~ '^el-[a-z0-9]{12}$'),
  package_id  text not null references public.packages (id) on delete cascade,
  path        text not null check (length(path) between 1 and 300),
  kind        text not null check (kind in ('figure', 'section')),
  anchor      text check (anchor is null or anchor ~ '^blk-[a-z0-9-]{1,60}$'),
  page        text not null check (length(page) between 1 and 300),
  title       text not null check (length(title) between 1 and 200),
  shared_by   uuid references public.profiles (id) on delete set null,
  shared_at   timestamptz not null default now(),
  stopped_at  timestamptz,
  check ((kind = 'section') = (anchor is not null))
);
create index if not exists shared_elements_package_idx on public.shared_elements (package_id) where stopped_at is null;
-- One active share per element: sharing it again while shared is the same address.
create unique index if not exists shared_elements_one_active on public.shared_elements (package_id, path, coalesce(anchor, '')) where stopped_at is null;

alter table public.shared_elements enable row level security;
drop policy if exists shared_elements_members_read on public.shared_elements;
create policy shared_elements_members_read on public.shared_elements for select to authenticated
  using (public.course_role(package_id) is not null);
