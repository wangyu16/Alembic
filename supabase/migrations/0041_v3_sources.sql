-- 0041: sources — the authority for source files (workspace v3, module B4).
--
-- package-contract-v3 §5; design §4.4 (R20, R27: files live in Cloudflare R2,
-- never in Git). This row is the ONLY authority for ownership, flags and the
-- storage key; the repo pointer file is a server-written mirror. Members see
-- the pointer facts of their course's sources but never the storage key;
-- links to a file are issued by the server after
-- can(role, 'source.see-file', {uploaderId, sharedWithCourse}).
-- Fingerprints (copy-check, no readable text) stay after a file is removed.
--
-- READ-ONLY PRE-CHECK: none. DEPLOY ORDER: any.

create table public.sources (
  id                 text primary key check (id ~ '^src_[a-z2-7]{26}$'),
  package_id         text not null references public.packages (id) on delete cascade,
  uploader_id        uuid not null references public.profiles (id),
  title              text not null check (length(title) between 1 and 500),
  kind               text not null check (kind in ('file', 'link', 'book-description')),
  rights_note        text not null default '' check (length(rights_note) <= 4000),
  ai_allowed         boolean not null default false,
  shared_with_course boolean not null default false,
  sha256             text check (sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes         bigint check (size_bytes >= 0 and size_bytes <= 524288000),
  storage_key        text,          -- '<package_id>/<128-bit random>'; never exposed to members
  removed_at         timestamptz,
  created_at         timestamptz not null default now(),
  check ((kind = 'file') = (storage_key is not null) or removed_at is not null)
);
create index sources_package_idx on public.sources (package_id);

create table public.source_fingerprints (
  source_id text not null references public.sources (id) on delete cascade,
  n         int not null,
  hashes    text[] not null,
  primary key (source_id, n)
);

alter table public.sources enable row level security;
alter table public.source_fingerprints enable row level security;
revoke all on public.sources from anon, authenticated;
revoke all on public.source_fingerprints from anon, authenticated;
-- Members read the pointer facts — every column except storage_key.
grant select (id, package_id, uploader_id, title, kind, rights_note, ai_allowed, shared_with_course,
              sha256, size_bytes, removed_at, created_at) on public.sources to authenticated;
create policy "members read their course sources" on public.sources
  for select to authenticated using ((select public.course_role(package_id)) is not null);

-- The uploader may change their own source's sharing and AI flag (and nothing else).
create function public.source_set_flags(p_id text, p_ai_allowed boolean, p_shared boolean, p_attest boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.sources;
begin
  select * into s from public.sources where id = p_id for update;
  if not found or s.uploader_id is distinct from (select auth.uid()) or public.course_role(s.package_id) is null then
    raise exception 'Only the person who uploaded this source can change it' using errcode = '42501';
  end if;
  if p_shared and not s.shared_with_course and not p_attest then
    raise exception 'Sharing a source with the course needs your confirmation that its license allows it' using errcode = '22023';
  end if;
  update public.sources set ai_allowed = p_ai_allowed, shared_with_course = p_shared where id = p_id;
end $$;
revoke execute on function public.source_set_flags(text, boolean, boolean, boolean) from public, anon;
grant execute on function public.source_set_flags(text, boolean, boolean, boolean) to authenticated;
