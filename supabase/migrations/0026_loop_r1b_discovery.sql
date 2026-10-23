-- Phase 5 loop r1b: discovery projection cost and rebuildable recency.
-- Redefines parts of 0022_trackA_discovery.sql (already applied in
-- production; never edit it). Spec: docs/specs/discovery-index.md.
--
-- Claims:
--   P5.A.1.m  A one-file save rewrites at most the changed element rows, and
--             there is at most one refresh per package per statement batch.
--             (§3 guard + doc scope, §4 deferral.)
--   P5.A.1.i  discovery_rebuild() from empty tables reproduces every derived
--             column of the projection, including updated_at and listed_at.
--             (§1 recency columns, §3 projector.)
--
-- Backward compatible with the current web/worker code: no caller passes the
-- new arguments, nothing reads the new columns, and the new functions are
-- only used by a later migration (0027, the registry flush RPC). Apply it
-- before or with that code. The final statement re-projects everything once
-- (the fingerprints change shape, so every projection row is rewritten one
-- time).

-- ---------------------------------------------------------------------------
-- 1. Recency lives in the base tables (so a rebuild can reproduce it).
--
-- documents.content_changed_at  — when the file's CONTENT last changed (its
--   source_hash), or when it was registered.
-- packages.listing_changed_at   — when what the course LISTING says last
--   changed (title, description, keywords, chapter titles, discipline,
--   course context, licence, accessibility status, lineage).
--
-- Both are owned by BEFORE triggers: a client-supplied value is ignored on
-- insert and on update, so nobody can forge recency (a ranking signal). Column
-- privileges on `packages` are the other loop-r1 fix's area; whatever they
-- grant, this column cannot be set from outside the trigger.
-- ---------------------------------------------------------------------------

alter table public.documents add column if not exists content_changed_at timestamptz;
alter table public.packages add column if not exists listing_changed_at timestamptz;

-- Back-fill BEFORE the owning triggers exist (they would keep the old null),
-- with the projection triggers off (the back-fill changes nothing they read).
-- Values come from the current projection, so recency never moves backwards.
alter table public.documents disable trigger discovery_documents_update;
update public.documents d
set content_changed_at = coalesce(
  (select e.updated_at from public.discovery_elements e where e.doc_id = d.doc_id),
  d.registered_at)
where d.content_changed_at is null;
alter table public.documents enable trigger discovery_documents_update;

alter table public.packages disable trigger discovery_packages;
update public.packages p
set listing_changed_at = c.updated_at
from public.discovery_courses c
where c.package_id = p.id
  and p.listing_changed_at is null;
alter table public.packages enable trigger discovery_packages;

create or replace function public.documents_content_changed_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.content_changed_at := now();
  elsif new.source_hash is distinct from old.source_hash then
    new.content_changed_at := now();
  else
    new.content_changed_at := old.content_changed_at;
  end if;
  return new;
end;
$$;

-- (security definer like every discovery trigger function: it runs inside an
-- educator's RLS session and calls internal helpers.)
create trigger documents_content_changed_at
  before insert or update on public.documents
  for each row execute function public.documents_content_changed_at();

-- What the course listing says, as one comparable value. Chapter TITLES only
-- (plus how many chapters), so re-ordering files inside a chapter is not a
-- listing change.
create or replace function public.discovery_listing_key(p_title text, p_manifest jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_array(
    p_title,
    p_manifest -> 'title',
    p_manifest -> 'description',
    p_manifest -> 'keywords',
    (select coalesce(jsonb_agg(c -> 'title' order by n), '[]'::jsonb)
     from jsonb_array_elements(
       case when jsonb_typeof(p_manifest -> 'chapters') = 'array'
            then p_manifest -> 'chapters' else '[]'::jsonb end
     ) with ordinality as t(c, n)),
    p_manifest -> 'discipline',
    p_manifest -> 'courseContext',
    p_manifest -> 'license',
    p_manifest -> 'accessibility' -> 'status',
    p_manifest -> 'adaptedFrom'
  )
$$;

create or replace function public.packages_listing_changed_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.listing_changed_at := now();
  elsif public.discovery_listing_key(new.title, new.manifest)
        is distinct from public.discovery_listing_key(old.title, old.manifest) then
    new.listing_changed_at := now();
  else
    new.listing_changed_at := old.listing_changed_at;
  end if;
  return new;
end;
$$;

create trigger packages_listing_changed_at
  before insert or update on public.packages
  for each row execute function public.packages_listing_changed_at();

-- ---------------------------------------------------------------------------
-- 2. The deferral queue (P5.A.1.m): while a transaction has called
-- discovery_defer_begin(), refreshes are queued here — one row per package,
-- doc ids merged — and run once by discovery_defer_end() (or, if the caller
-- never calls end, by a deferred constraint trigger at COMMIT, so a refresh
-- is never lost). Rows are keyed by the transaction id and never outlive it.
-- Only the security-definer projector functions read or write the table.
-- ---------------------------------------------------------------------------

create table if not exists public.discovery_refresh_queue (
  txid bigint not null,
  package_id text not null,
  content boolean not null default false,
  -- null = the whole package; otherwise only these elements (+ the course row)
  doc_ids text[],
  primary key (txid, package_id)
);

alter table public.discovery_refresh_queue enable row level security;
revoke all on public.discovery_refresh_queue from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The projector, redefined.
--   * p_doc_ids (new): when not null, the element part only deletes/upserts
--     those doc ids; the course part always runs whole.
--   * Upserts skip unchanged rows (`where … is distinct from …`), so a refresh
--     rewrites only the rows whose projected values changed.
--   * Fingerprints are md5 over a ROW value (NULL and '' stay distinct, unlike
--     concat_ws), so a fingerprint plus the columns it does not cover is a
--     complete change test.
--   * Recency is derived from the base tables only (P5.A.1.i):
--       element updated_at = the file's last content change
--         (content_changed_at, else registered_at). Element recency is the
--         FILE's last content change: a package rename or a description/tag
--         edit no longer bumps it (they still re-project the row).
--       course updated_at = greatest(listing consent registered_at,
--         packages.listing_changed_at, the latest content_changed_at of the
--         course's public, non-private/current files — tombstoned included, so
--         deleting a file never moves recency backwards).
--     p_content_changed is therefore unused; it stays for callers.
-- The 2-argument versions are dropped (a new signature would be an overload).
-- The trigger functions call these by name, so they keep resolving.
-- ---------------------------------------------------------------------------

drop function if exists public.discovery_refresh_safe(text, boolean);
drop function if exists public.discovery_refresh_package(text, boolean);

create function public.discovery_refresh_package(
  p_package_id text,
  p_content_changed boolean default false,
  p_doc_ids text[] default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pkg public.packages%rowtype;
  v_reg public.portal_registrations%rowtype;
  v_m jsonb;
  v_live boolean;
  v_course_listed boolean;
  v_title text;
  v_description text;
  v_keywords text[];
  v_chapters text[];
  v_topics text[];
  v_discipline text;
  v_level text;
  v_context jsonb;
  v_license text;
  v_a11y text;
  v_chapter_count integer;
  v_element_count integer;
  v_concepts text;
  v_completeness real;
  v_fingerprint text;
  v_owner text;
  v_repo text;
  v_identity text;
  v_content_at timestamptz;
  v_updated_at timestamptz;
begin
  if p_package_id is null then
    return;
  end if;

  select * into v_pkg from public.packages where id = p_package_id;
  if not found then
    delete from public.discovery_courses where package_id = p_package_id;
    delete from public.discovery_elements where package_id = p_package_id;
    return;
  end if;
  v_m := coalesce(v_pkg.manifest, '{}'::jsonb);
  v_live := v_pkg.storage = 'github' and v_pkg.archived_at is null;
  v_course_listed := public.discovery_course_listable(p_package_id);

  v_title := coalesce(nullif(btrim(v_m ->> 'title'), ''), v_pkg.title);
  v_license := coalesce(v_m ->> 'license', '');
  v_discipline := public.discovery_facet_value(v_m ->> 'discipline');
  v_level := public.discovery_facet_value(v_m -> 'courseContext' ->> 'level');

  -- ---- elements -----------------------------------------------------------
  delete from public.discovery_elements e
  where e.package_id = p_package_id
    and (p_doc_ids is null or e.doc_id = any (p_doc_ids))
    and not exists (
      select 1 from public.documents d
      where d.doc_id = e.doc_id
        and v_live
        and d.package_id = p_package_id
        and d.discoverable
        and not d.tombstoned
        and d.repo = 'public'
        and d.space not in ('private', 'current')
    );

  if v_live then
    insert into public.discovery_elements as de (
      doc_id, package_id, repo, space, kind, permalink_class, path, title,
      description, alt_text, tags, license, package_title, discipline, level,
      course_listed, adapted_from_doc_id, adaptation_count, described,
      listed_at, updated_at, completeness, fingerprint, search_text,
      search_vector
    )
    select
      x.doc_id, x.package_id, x.repo, x.space, x.kind, x.permalink_class,
      x.path, x.title, x.description, x.alt_text, x.tags, x.license, v_title,
      v_discipline, v_level, v_course_listed, x.adapted_from, x.adaptations,
      x.described, x.registered_at,
      coalesce(x.content_changed_at, x.registered_at),
      x.completeness, x.fingerprint,
      left(concat_ws(' ', x.title, array_to_string(x.tags, ' '), x.file_name), 2000),
      setweight(to_tsvector('english', x.title), 'A')
        || setweight(to_tsvector('english', array_to_string(x.tags, ' ')), 'B')
        || setweight(to_tsvector('english', concat_ws(' ',
             x.description, x.alt_text, x.file_name, v_title, v_discipline, x.kind)), 'C')
    from (
      select
        d.doc_id, d.package_id, d.repo, d.space, d.kind, d.permalink_class,
        d.path, d.registered_at, d.content_changed_at, d.adapted_from,
        nullif(btrim(d.description), '') as description,
        nullif(btrim(d.alt_text), '') as alt_text,
        coalesce(d.tags, '{}') as tags,
        regexp_replace(d.path, '^.*/', '') as file_name,
        left(coalesce(nullif(btrim(d.description), ''), nullif(btrim(d.alt_text), ''),
                      regexp_replace(d.path, '^.*/', '')), 200) as title,
        coalesce(nullif(btrim(d.license), ''), v_license) as license,
        (nullif(btrim(d.description), '') is not null
          or nullif(btrim(d.alt_text), '') is not null) as described,
        (select count(*)::integer from public.documents a
          where a.adapted_from = d.doc_id and a.package_id <> d.package_id
            and not a.tombstoned) as adaptations,
        ((case when coalesce(array_length(regexp_split_to_array(btrim(coalesce(d.description, '')), '\s+'), 1), 0) >= 3
               and btrim(coalesce(d.description, '')) <> '' then 1 else 0 end)
          + (case when coalesce(cardinality(d.tags), 0) >= 1 then 1 else 0 end)
          + (case when nullif(btrim(d.license), '') is not null
                    or public.discovery_open_license(v_license) then 1 else 0 end)
        )::real / 3 as completeness,
        -- Covers every input of title, description, alt_text, tags, license,
        -- described, completeness, package_title, discipline, level,
        -- search_text and search_vector (plus the content hash).
        md5(row(d.path, d.space, d.kind, d.permalink_class, d.description,
          d.alt_text, coalesce(d.tags, '{}'), coalesce(nullif(btrim(d.license), ''), v_license),
          d.source_hash, v_title, v_discipline, v_level)::text) as fingerprint
      from public.documents d
      where d.package_id = p_package_id
        and (p_doc_ids is null or d.doc_id = any (p_doc_ids))
        and d.discoverable
        and not d.tombstoned
        and d.repo = 'public'
        and d.space not in ('private', 'current')
    ) x
    on conflict (doc_id) do update set
      package_id = excluded.package_id,
      repo = excluded.repo,
      space = excluded.space,
      kind = excluded.kind,
      permalink_class = excluded.permalink_class,
      path = excluded.path,
      title = excluded.title,
      description = excluded.description,
      alt_text = excluded.alt_text,
      tags = excluded.tags,
      license = excluded.license,
      package_title = excluded.package_title,
      discipline = excluded.discipline,
      level = excluded.level,
      course_listed = excluded.course_listed,
      adapted_from_doc_id = excluded.adapted_from_doc_id,
      adaptation_count = excluded.adaptation_count,
      described = excluded.described,
      listed_at = excluded.listed_at,
      updated_at = excluded.updated_at,
      completeness = excluded.completeness,
      fingerprint = excluded.fingerprint,
      search_text = excluded.search_text,
      search_vector = excluded.search_vector,
      projected_at = now()
    -- Skip unchanged rows: the fingerprint plus every projected column it does
    -- not cover.
    where (de.fingerprint, de.package_id, de.repo, de.course_listed,
           de.adapted_from_doc_id, de.adaptation_count, de.described,
           de.completeness, de.listed_at, de.updated_at)
      is distinct from
          (excluded.fingerprint, excluded.package_id, excluded.repo, excluded.course_listed,
           excluded.adapted_from_doc_id, excluded.adaptation_count, excluded.described,
           excluded.completeness, excluded.listed_at, excluded.updated_at);
  end if;

  -- ---- course -------------------------------------------------------------
  if not v_course_listed then
    delete from public.discovery_courses where package_id = p_package_id;
    return;
  end if;

  select * into v_reg from public.portal_registrations where package_id = p_package_id;

  v_description := btrim(coalesce(v_m ->> 'description', ''));
  select coalesce(array_agg(k order by n), '{}') into v_keywords
  from (
    select left(btrim(k), 80) as k, n
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_m -> 'keywords') = 'array' then v_m -> 'keywords' else '[]'::jsonb end
    ) with ordinality as t(k, n)
  ) s
  where k <> '' and n <= 50;

  select coalesce(array_agg(left(btrim(c ->> 'title'), 200) order by n), '{}') into v_chapters
  from jsonb_array_elements(
    case when jsonb_typeof(v_m -> 'chapters') = 'array' then v_m -> 'chapters' else '[]'::jsonb end
  ) with ordinality as t(c, n)
  where btrim(coalesce(c ->> 'title', '')) <> '';
  -- A package without `chapters` is one implicit chapter (manifest.ts).
  v_chapter_count := greatest(coalesce(
    case when jsonb_typeof(v_m -> 'chapters') = 'array'
         then jsonb_array_length(v_m -> 'chapters') end, 0), 1);

  -- The course concept map (public repo; current path, then the legacy one).
  select f.content into v_concepts
  from public.sandbox_files f
  where f.package_id = p_package_id
    and f.repo = 'public'
    and f.path in ('concepts/course.md', 'metadata/course.md')
  order by (f.path = 'concepts/course.md') desc
  limit 1;
  v_topics := public.discovery_headings(v_concepts);

  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_context
  from jsonb_each_text(
    case when jsonb_typeof(v_m -> 'courseContext') = 'object' then v_m -> 'courseContext' else '{}'::jsonb end
  ) as t(k, v)
  where k in ('courseName', 'level', 'institutionType', 'instructor', 'courseNumber', 'department')
    and btrim(v) <> '';

  v_a11y := coalesce(v_m -> 'accessibility' ->> 'status', 'unknown');
  if v_a11y not in ('pass', 'warn', 'fail', 'unknown') then
    v_a11y := 'unknown';
  end if;

  select count(*)::integer into v_element_count
  from public.discovery_elements where package_id = p_package_id;

  v_completeness := (
      (case when coalesce(array_length(regexp_split_to_array(v_description, '\s+'), 1), 0) >= 15
             and v_description <> '' then 1 else 0 end)
    + (case when cardinality(v_keywords) >= 3 then 1 else 0 end)
    + (case when v_level is not null then 1 else 0 end)
    + (case when v_discipline is not null then 1 else 0 end)
    + (case when cardinality(v_topics) > 0 or v_chapter_count >= 2 then 1 else 0 end)
  )::real / 5;

  v_identity := concat_ws(' ', v_context ->> 'courseName', v_context ->> 'courseNumber',
    v_context ->> 'department', v_context ->> 'institutionType', v_context ->> 'instructor');

  v_owner := v_m -> 'publicRepo' ->> 'owner';
  v_repo := v_m -> 'publicRepo' ->> 'name';

  -- Covers every listing column except element_count, adaptation_count,
  -- completeness and the timestamps (those are in the upsert guard).
  v_fingerprint := md5(row(v_title, v_description, v_keywords, v_chapters, v_topics,
    v_discipline, v_level, v_context, v_license, v_a11y, v_chapter_count,
    nullif(btrim(v_m -> 'adaptedFrom' ->> 'packageId'), ''),
    nullif(btrim(v_m -> 'adaptedFrom' ->> 'title'), ''),
    nullif(btrim(v_m -> 'adaptedFrom' ->> 'url'), ''),
    nullif(btrim(v_m -> 'adaptedFrom' ->> 'attribution'), ''),
    v_owner, v_repo)::text);

  select max(d.content_changed_at) into v_content_at
  from public.documents d
  where d.package_id = p_package_id
    and d.repo = 'public'
    and d.space not in ('private', 'current');
  -- greatest() ignores nulls.
  v_updated_at := greatest(v_reg.registered_at, v_pkg.listing_changed_at, v_content_at);

  insert into public.discovery_courses as dc (
    package_id, title, description, keywords, chapter_titles, topics,
    discipline, level, course_context, license, accessibility_status,
    chapter_count, element_count, adapted_from_package_id, adapted_from_title,
    adapted_from_url, adapted_from_attribution, adaptation_count,
    public_repo_url, site_url, listed_at, updated_at, completeness,
    fingerprint, search_text, search_vector
  ) values (
    p_package_id, v_title, v_description, v_keywords, v_chapters, v_topics,
    v_discipline, v_level, v_context, v_license, v_a11y,
    v_chapter_count, v_element_count,
    nullif(btrim(v_m -> 'adaptedFrom' ->> 'packageId'), ''),
    nullif(btrim(v_m -> 'adaptedFrom' ->> 'title'), ''),
    nullif(btrim(v_m -> 'adaptedFrom' ->> 'url'), ''),
    nullif(btrim(v_m -> 'adaptedFrom' ->> 'attribution'), ''),
    public.discovery_course_adaptations(p_package_id),
    'https://github.com/' || v_owner || '/' || v_repo,
    'https://' || v_owner || '.github.io/' || v_repo || '/',
    v_reg.registered_at,
    v_updated_at,
    v_completeness, v_fingerprint,
    left(concat_ws(' ', v_title, array_to_string(v_keywords, ' '),
      array_to_string(v_chapters, ' '), array_to_string(v_topics, ' ')), 4000),
    setweight(to_tsvector('english', v_title), 'A')
      || setweight(to_tsvector('english', concat_ws(' ', array_to_string(v_keywords, ' '),
           array_to_string(v_chapters, ' '), array_to_string(v_topics, ' '))), 'B')
      || setweight(to_tsvector('english', concat_ws(' ', v_description, v_discipline,
           v_level, v_identity)), 'C')
  )
  on conflict (package_id) do update set
    title = excluded.title,
    description = excluded.description,
    keywords = excluded.keywords,
    chapter_titles = excluded.chapter_titles,
    topics = excluded.topics,
    discipline = excluded.discipline,
    level = excluded.level,
    course_context = excluded.course_context,
    license = excluded.license,
    accessibility_status = excluded.accessibility_status,
    chapter_count = excluded.chapter_count,
    element_count = excluded.element_count,
    adapted_from_package_id = excluded.adapted_from_package_id,
    adapted_from_title = excluded.adapted_from_title,
    adapted_from_url = excluded.adapted_from_url,
    adapted_from_attribution = excluded.adapted_from_attribution,
    adaptation_count = excluded.adaptation_count,
    public_repo_url = excluded.public_repo_url,
    site_url = excluded.site_url,
    listed_at = excluded.listed_at,
    updated_at = excluded.updated_at,
    completeness = excluded.completeness,
    fingerprint = excluded.fingerprint,
    search_text = excluded.search_text,
    search_vector = excluded.search_vector,
    projected_at = now()
  where (dc.fingerprint, dc.element_count, dc.adaptation_count, dc.completeness,
         dc.listed_at, dc.updated_at)
    is distinct from
        (excluded.fingerprint, excluded.element_count, excluded.adaptation_count,
         excluded.completeness, excluded.listed_at, excluded.updated_at);
end;
$$;

-- Run the queued refreshes of THIS transaction, each package once, in package
-- order. Best-effort like discovery_refresh_safe. Returns the number run.
create or replace function public.discovery_drain_queue()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_n integer := 0;
begin
  if txid_current_if_assigned() is null then
    return 0; -- nothing written, so nothing queued
  end if;
  for r in
    with q as (
      delete from public.discovery_refresh_queue
      where txid = txid_current()
      returning package_id, content, doc_ids
    )
    select * from q order by package_id
  loop
    begin
      perform public.discovery_refresh_package(r.package_id, r.content, r.doc_ids);
    exception when others then
      raise warning 'discovery: refresh of % failed: %', r.package_id, sqlerrm;
    end;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Best-effort wrapper used by every trigger: a projector failure becomes a
-- WARNING (the projection catches up on the next change or a rebuild); it
-- never fails the educator's write. While deferral is on, the refresh is
-- queued (content flag OR-merged; doc ids merged, null = whole package and
-- absorbs any list).
create function public.discovery_refresh_safe(
  p_package_id text,
  p_content_changed boolean default false,
  p_doc_ids text[] default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_package_id is null then
    return;
  end if;
  if coalesce(current_setting('alembic.discovery_defer', true), '') = 'on' then
    begin
      insert into public.discovery_refresh_queue as q (txid, package_id, content, doc_ids)
      values (txid_current(), p_package_id, coalesce(p_content_changed, false), p_doc_ids)
      on conflict (txid, package_id) do update set
        content = q.content or excluded.content,
        doc_ids = case
          when q.doc_ids is null or excluded.doc_ids is null then null
          else array(select distinct u from unnest(q.doc_ids || excluded.doc_ids) as u order by u)
        end;
      return;
    exception when others then
      raise warning 'discovery: could not defer the refresh of %: %', p_package_id, sqlerrm;
      -- fall through: refresh now
    end;
  end if;
  begin
    perform public.discovery_refresh_package(p_package_id, p_content_changed, p_doc_ids);
  exception when others then
    raise warning 'discovery: refresh of % failed: %', p_package_id, sqlerrm;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Deferral (P5.A.1.m): one registry flush = one refresh per package.
--
--   perform public.discovery_defer_begin();
--   update public.documents … (tombstones);
--   insert into public.documents … on conflict (doc_id) do update …;
--   perform public.discovery_defer_end();   -- each touched package once
--
-- Security. begin only sets a transaction-local flag; end only runs the
-- refreshes that THIS transaction's own triggers queued (the queue table is
-- written solely by discovery_refresh_safe, which clients cannot call). A
-- client that sets the flag itself (set_config('alembic.discovery_defer',
-- 'on', true)) can only postpone its own transaction's refreshes to COMMIT,
-- where the deferred constraint trigger below runs them anyway. Neither
-- function reads or returns any row, and a refresh only re-derives the public
-- projection from the base tables.
-- ---------------------------------------------------------------------------

create or replace function public.discovery_defer_begin()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('alembic.discovery_defer', 'on', true);
end;
$$;

create or replace function public.discovery_defer_end()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('alembic.discovery_defer', 'off', true);
  return public.discovery_drain_queue();
end;
$$;

-- Safety net: a deferral left open is drained at COMMIT (after end, the queue
-- is empty and this is a no-op).
create or replace function public.discovery_on_refresh_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('alembic.discovery_defer', 'off', true);
  perform public.discovery_drain_queue();
  return null;
end;
$$;

create constraint trigger discovery_refresh_queue_drain
  after insert on public.discovery_refresh_queue
  deferrable initially deferred
  for each row execute function public.discovery_on_refresh_queue();

-- ---------------------------------------------------------------------------
-- 5. documents triggers, redefined: pass the touched doc ids (P5.A.1.m).
-- Packages / registrations / concept-map triggers (0022) are unchanged: they
-- call discovery_refresh_safe(id) by name, which is a whole-package refresh.
-- ---------------------------------------------------------------------------

create or replace function public.discovery_on_documents_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.discovery_refresh_safe(x.package_id, x.content, x.doc_ids)
  from (
    select n.package_id,
           bool_or(n.repo = 'public' and n.space not in ('private', 'current')) as content,
           array_agg(n.doc_id) as doc_ids
    from new_rows n
    group by n.package_id
  ) x;
  -- Copies of another package's file: the source gains an adaptation.
  perform public.discovery_refresh_safe(s.package_id, false, s.doc_ids)
  from (
    select src.package_id, array_agg(distinct src.doc_id) as doc_ids
    from new_rows n
    join public.documents src on src.doc_id = n.adapted_from
    where n.adapted_from is not null and src.package_id <> n.package_id
    group by src.package_id
  ) s;
  return null;
end;
$$;

create or replace function public.discovery_on_documents_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.discovery_refresh_safe(x.package_id, x.content, x.doc_ids)
  from (
    select t.package_id, bool_or(t.content) as content, array_agg(distinct t.doc_id) as doc_ids
    from (
      select n.package_id, n.doc_id,
             (n.source_hash is distinct from o.source_hash
              and n.repo = 'public' and n.space not in ('private', 'current')
              and not n.tombstoned) as content
      from new_rows n
      join old_rows o on o.doc_id = n.doc_id
      where n.discoverable is distinct from o.discoverable
         or n.tombstoned is distinct from o.tombstoned
         or n.repo is distinct from o.repo
         or n.space is distinct from o.space
         or n.path is distinct from o.path
         or n.kind is distinct from o.kind
         or n.permalink_class is distinct from o.permalink_class
         or n.description is distinct from o.description
         or n.alt_text is distinct from o.alt_text
         or n.tags is distinct from o.tags
         or n.license is distinct from o.license
         or n.adapted_from is distinct from o.adapted_from
         or n.source_hash is distinct from o.source_hash
         or n.package_id is distinct from o.package_id
      union all
      -- A file moved to another package: its old course loses it.
      select o.package_id, o.doc_id, false
      from new_rows n
      join old_rows o on o.doc_id = n.doc_id
      where n.package_id is distinct from o.package_id
    ) t
    group by t.package_id
  ) x;
  -- A copy tombstoned / re-pointed: its source's adaptation count changes.
  perform public.discovery_refresh_safe(s.package_id, false, s.doc_ids)
  from (
    select src.package_id, array_agg(distinct src.doc_id) as doc_ids
    from new_rows n
    join old_rows o on o.doc_id = n.doc_id
    join public.documents src on src.doc_id in (n.adapted_from, o.adapted_from)
    where (n.adapted_from is not null or o.adapted_from is not null)
      and (n.tombstoned is distinct from o.tombstoned
           or n.adapted_from is distinct from o.adapted_from)
      and src.package_id <> n.package_id
    group by src.package_id
  ) s;
  return null;
end;
$$;

create or replace function public.discovery_on_documents_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.discovery_refresh_safe(x.package_id, false, x.doc_ids)
  from (
    select o.package_id, array_agg(o.doc_id) as doc_ids
    from old_rows o
    group by o.package_id
  ) x;
  perform public.discovery_refresh_safe(s.package_id, false, s.doc_ids)
  from (
    select src.package_id, array_agg(distinct src.doc_id) as doc_ids
    from old_rows o
    join public.documents src on src.doc_id = o.adapted_from
    where o.adapted_from is not null and src.package_id <> o.package_id
    group by src.package_id
  ) s;
  return null;
end;
$$;

-- discovery_rebuild() (0022) is unchanged: it calls
-- discovery_refresh_package(id, false), now the 3-argument version with
-- p_doc_ids = null (whole package).

-- ---------------------------------------------------------------------------
-- 6. Function privileges (0022 §5 pattern). Supabase grants EXECUTE on new
-- public functions to anon/authenticated by default; these are internal,
-- except begin/end, which the registry flush RPC (signed-in educators and
-- the worker) calls.
-- ---------------------------------------------------------------------------

revoke all on function public.documents_content_changed_at() from public, anon, authenticated;
revoke all on function public.packages_listing_changed_at() from public, anon, authenticated;
revoke all on function public.discovery_listing_key(text, jsonb) from public, anon, authenticated;
revoke all on function public.discovery_refresh_package(text, boolean, text[]) from public, anon, authenticated;
revoke all on function public.discovery_refresh_safe(text, boolean, text[]) from public, anon, authenticated;
revoke all on function public.discovery_drain_queue() from public, anon, authenticated;
revoke all on function public.discovery_on_refresh_queue() from public, anon, authenticated;
revoke all on function public.discovery_on_documents_insert() from public, anon, authenticated;
revoke all on function public.discovery_on_documents_update() from public, anon, authenticated;
revoke all on function public.discovery_on_documents_delete() from public, anon, authenticated;
revoke all on function public.discovery_defer_begin() from public, anon;
revoke all on function public.discovery_defer_end() from public, anon;
grant execute on function public.discovery_defer_begin() to authenticated, service_role;
grant execute on function public.discovery_defer_end() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Re-project once with the new fingerprints and derived recency.
-- ---------------------------------------------------------------------------
select public.discovery_rebuild();
