-- Phase 5 loop r1b: the document registry stays true to the stored bytes, and
-- a docId belongs to exactly one package.
-- Spec: docs/specs/permalinks-and-registration.md (identity), storage-and-
-- write-paths.md (the registry is part of the projection of every write).
--
-- Claims:
--   P5.B.1.m  After any write, every touched live file's registry hash equals
--             the hash of its stored content; a page load notices a content
--             change with a content-free query.            (§1, §2)
--   P5.B.1.n  A docId belongs to exactly one package; a registration run is
--             atomic (no tombstone without its upsert).    (§3, §4, §5)
--
-- Depends on 0026 (discovery_defer_begin / discovery_defer_end).
-- Deploy: apply 0026 then 0027, THEN deploy the r1b code (the code selects
-- sandbox_files.content_sha256, writes documents.content_sha256 and calls
-- documents_apply / documents_foreign_doc_ids). Old code keeps working on the
-- new schema: every addition is a nullable/generated column, a new function,
-- or a guard that refuses only what was always wrong (moving a docId to
-- another package).
--
-- Cost: §1 adds a STORED generated column to sandbox_files, which rewrites the
-- table once under an ACCESS EXCLUSIVE lock (every file's bytes are hashed).
-- Run it in a quiet window.

-- ---------------------------------------------------------------------------
-- 1. The digest of the stored bytes, computed by the database.
--    Same value as package-contract's sha256Hex(content) (UTF-8, lower hex).
-- ---------------------------------------------------------------------------

-- `convert_to` is only STABLE (it depends on the server encoding), so wrap it:
-- the database encoding is UTF8 and never changes, which makes this IMMUTABLE
-- in fact, as a generated column requires.
create or replace function public.content_sha256(p_content text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_content, 'UTF8')), 'hex')
$$;

alter table public.sandbox_files
  add column if not exists content_sha256 text
  generated always as (public.content_sha256(content)) stored;

-- ---------------------------------------------------------------------------
-- 2. The digest a registration saw. Null on rows registered before r1b:
--    the page-load check treats null as "unknown" and re-verifies once.
-- ---------------------------------------------------------------------------

alter table public.documents
  add column if not exists content_sha256 text
  check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');

-- ---------------------------------------------------------------------------
-- 3. A docId never moves to another package. documents.doc_id is the global
--    primary key, so before r1b an `on conflict (doc_id) do update` from a
--    copy that carried another package's embedded uid MOVED the row (same
--    owner) — the original's permalink then pointed into the copy.
-- ---------------------------------------------------------------------------

create or replace function public.documents_no_cross_package_move()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.package_id is distinct from old.package_id then
    raise exception 'docId % belongs to another package', old.doc_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists documents_no_cross_package_move on public.documents;
create trigger documents_no_cross_package_move
  before update on public.documents
  for each row execute function public.documents_no_cross_package_move();

-- ---------------------------------------------------------------------------
-- 4. One registration run = one transaction, one discovery refresh.
--    SECURITY INVOKER: the caller's RLS applies exactly as for a plain write.
-- ---------------------------------------------------------------------------

create or replace function public.documents_apply(
  p_package_id text,
  p_tombstones text[],
  p_rows jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_package_id is null then
    raise exception 'documents_apply: package id required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where r ->> 'package_id' is distinct from p_package_id
  ) then
    raise exception 'documents_apply: every row must belong to package %', p_package_id;
  end if;

  perform public.discovery_defer_begin();

  if coalesce(cardinality(p_tombstones), 0) > 0 then
    update public.documents
    set tombstoned = true
    where package_id = p_package_id
      and doc_id = any (p_tombstones)
      and not tombstoned;
  end if;

  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 0 then
    insert into public.documents as d (
      doc_id, package_id, repo, path, space, kind, format_version, source_hash,
      origin, author, registered_at, license, description, tags, alt_text,
      discoverable, permalink_class, tombstoned, adapted_from, content_sha256
    )
    select
      x.doc_id, x.package_id, x.repo, x.path, x.space, x.kind,
      coalesce(x.format_version, 0), x.source_hash, x.origin, x.author,
      coalesce(x.registered_at, now()), x.license, x.description,
      coalesce(x.tags, '{}'), x.alt_text, coalesce(x.discoverable, false),
      x.permalink_class, coalesce(x.tombstoned, false), x.adapted_from,
      x.content_sha256
    from jsonb_to_recordset(p_rows) as x (
      doc_id text, package_id text, repo text, path text, space text,
      kind text, format_version integer, source_hash text, origin text,
      author uuid, registered_at timestamptz, license text, description text,
      tags text[], alt_text text, discoverable boolean, permalink_class text,
      tombstoned boolean, adapted_from text, content_sha256 text
    )
    on conflict (doc_id) do update set
      -- package_id deliberately included: §3's trigger refuses a change.
      package_id = excluded.package_id,
      repo = excluded.repo,
      path = excluded.path,
      space = excluded.space,
      kind = excluded.kind,
      format_version = excluded.format_version,
      source_hash = excluded.source_hash,
      origin = excluded.origin,
      author = excluded.author,
      registered_at = excluded.registered_at,
      license = excluded.license,
      description = excluded.description,
      tags = excluded.tags,
      alt_text = excluded.alt_text,
      discoverable = excluded.discoverable,
      permalink_class = excluded.permalink_class,
      tombstoned = excluded.tombstoned,
      adapted_from = excluded.adapted_from,
      content_sha256 = excluded.content_sha256;
  end if;

  perform public.discovery_defer_end();
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. "Is this id taken by another package?" — across owners (RLS would hide
--    another owner's row and the id would look free; the upsert would then be
--    refused). Answers only the ids that are taken elsewhere: nothing about
--    the other package, its owner or the file. Ids are ~62-bit random, so
--    this reveals nothing a caller does not already hold.
-- ---------------------------------------------------------------------------

create or replace function public.documents_foreign_doc_ids(
  p_package_id text,
  p_doc_ids text[]
)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select d.doc_id
  from public.documents d
  where d.doc_id = any (p_doc_ids[1:1000])
    and d.package_id is distinct from p_package_id
$$;

-- content_sha256(text) stays executable by every role: the generated column
-- is evaluated with the inserting role's privileges (a pure hash; harmless).
revoke all on function public.documents_no_cross_package_move() from public, anon, authenticated;
revoke all on function public.documents_apply(text, text[], jsonb) from public, anon;
grant execute on function public.documents_apply(text, text[], jsonb) to authenticated, service_role;
revoke all on function public.documents_foreign_doc_ids(text, text[]) from public, anon;
grant execute on function public.documents_foreign_doc_ids(text, text[]) to authenticated, service_role;
