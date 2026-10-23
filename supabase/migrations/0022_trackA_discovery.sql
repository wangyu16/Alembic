-- Phase 5 Track A (A.1–A.3): the discovery projection, search and ranking.
-- Spec: docs/specs/discovery-index.md. Additive only; nothing existing is
-- dropped or rewritten, and old packages need no change.
--
-- WHAT THIS IS. Two public-safe tables — one row per LISTED course
-- (`discovery_courses`) and one per SHARED element (`discovery_elements`) —
-- derived ONLY from the registry (`documents`), the manifest read cache
-- (`packages.manifest`), the listing consent (`portal_registrations`) and the
-- course concept map (`sandbox_files`). They are a rebuildable projection
-- (Roadmap rule 3: one metadata source): no code writes them except the
-- functions below, they hold nothing that is not derivable from those tables
-- (plus computed signals), and `discovery_rebuild()` reproduces them.
--
-- WHAT GETS IN (one predicate each, used by the projector, the search
-- functions AND the public read policy):
--   course  — a `portal_registrations` row (the Tier-3 "List publicly"
--             consent), a PUBLISHED package (`storage = 'github'`) that is
--             not archived, an open licence, and a public repo.
--   element — "share this" (`discoverable`), not tombstoned, in the PUBLIC
--             repo, outside the never-shareable spaces (`private`, `current`),
--             of a published package that is not archived. Per-file consent:
--             independent of the course listing (document-model.md §4).
-- Never: private files, `current` files, trial (unpublished) packages,
-- archived packages, unlisted courses, unshared files.
--
-- HOW IT STAYS FRESH. Triggers on the base tables call the projector for the
-- touched package — listing/unlisting (including an operator deleting the
-- registration row), every manifest write (metadata edits, rename, a11y
-- check, chapters), publishing (storage -> github), archive/restore,
-- share/unshare and asset metadata, deletes, renames, concept-map saves, and
-- adaptations (a source's adaptation count). Best-effort: a projector error is
-- downgraded to a WARNING and never fails the educator's write.
--
-- DEFENCE IN DEPTH. Even a stale row cannot leak: the search functions join
-- the live `packages`/`documents`/`portal_registrations` state, the public
-- read policy re-checks the predicate, and CHECK constraints refuse a private
-- or `current` element outright.
--
-- A.5 seam (owner decision Q1, later): an embedding column of the public
-- listing text can be added to both tables (`alter table … add column
-- embedding extensions.vector(…)`) and filled by the projector; nothing here
-- has to change shape for it.
--
-- Apply BEFORE deploying the Track A web code (the portal reads only these
-- functions). The final statement back-fills the projection.

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. The listability predicates (one definition each).
-- ---------------------------------------------------------------------------

-- The open licences (package-contract `OPEN_LICENSES`; agreement-tested).
create or replace function public.discovery_open_license(p_license text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_license, '') in
    ('CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'CC-BY-NC-SA-4.0', 'CC0-1.0')
$$;

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
    join public.portal_registrations r on r.package_id = p.id
    where p.id = p_package_id
      and p.storage = 'github'
      and p.archived_at is null
      and public.discovery_open_license(p.manifest ->> 'license')
      and coalesce(p.manifest -> 'publicRepo' ->> 'owner', '') <> ''
      and coalesce(p.manifest -> 'publicRepo' ->> 'name', '') <> ''
  )
$$;

create or replace function public.discovery_element_listable(p_doc_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.documents d
    join public.packages p on p.id = d.package_id
    where d.doc_id = p_doc_id
      and d.discoverable
      and not d.tombstoned
      and d.repo = 'public'
      and d.space not in ('private', 'current')
      and p.storage = 'github'
      and p.archived_at is null
  )
$$;

-- ---------------------------------------------------------------------------
-- 2. The projection tables.
-- ---------------------------------------------------------------------------

create table public.discovery_courses (
  package_id text primary key references public.packages (id) on delete cascade,
  title text not null,
  description text not null default '',
  keywords text[] not null default '{}',
  -- Chapter titles in course order (the outline preview on /p/{packageId}).
  chapter_titles text[] not null default '{}',
  -- Headings of the course concept map (`concepts/course.md`), capped.
  topics text[] not null default '{}',
  -- Facets: trimmed + lower-cased; null = not stated.
  discipline text,
  level text,
  -- Public course identity fields from manifest.courseContext (strings only).
  course_context jsonb not null default '{}',
  license text not null,
  accessibility_status text not null default 'unknown'
    check (accessibility_status in ('pass', 'warn', 'fail', 'unknown')),
  chapter_count integer not null default 0,
  -- Listed (shared) elements of this course.
  element_count integer not null default 0,
  -- Lineage: package-level `manifest.adaptedFrom`.
  adapted_from_package_id text,
  adapted_from_title text,
  adapted_from_url text,
  adapted_from_attribution text,
  -- Distinct packages that adapted this one (whole-course or an element).
  adaptation_count integer not null default 0,
  public_repo_url text not null,
  site_url text not null,
  -- When it was listed (the consent row).
  listed_at timestamptz not null,
  -- Last change to what the listing says or to the course's public files.
  updated_at timestamptz not null,
  -- 0..1: share of the listing fields filled in (ranking signal, spec §3).
  completeness real not null default 0,
  -- md5 over the projected listing fields; a change bumps updated_at.
  fingerprint text not null,
  -- Trigram target (title, keywords, chapter titles, topics).
  search_text text not null default '',
  -- Weighted: A title; B keywords, chapter titles, topics; C description,
  -- discipline, level, course identity.
  search_vector tsvector not null,
  projected_at timestamptz not null default now()
);

create index discovery_courses_search_idx on public.discovery_courses using gin (search_vector);
create index discovery_courses_trgm_idx
  on public.discovery_courses using gin (search_text extensions.gin_trgm_ops);
create index discovery_courses_adapted_from_idx
  on public.discovery_courses (adapted_from_package_id)
  where adapted_from_package_id is not null;

create table public.discovery_elements (
  doc_id text primary key references public.documents (doc_id) on delete cascade,
  package_id text not null references public.packages (id) on delete cascade,
  -- Fail closed at the database: a private or `current` row cannot exist here.
  repo text not null check (repo = 'public'),
  space text not null check (space not in ('private', 'current')),
  kind text not null,
  permalink_class text not null check (permalink_class in ('document', 'object')),
  path text not null,
  -- Display title: description, else alt text, else the file name.
  title text not null,
  description text,
  alt_text text,
  tags text[] not null default '{}',
  -- The file's own licence, else the package's.
  license text not null,
  package_title text not null,
  discipline text,
  level text,
  -- Its course is also listed (so the element can link to /p/{packageId}).
  course_listed boolean not null default false,
  adapted_from_doc_id text,
  adaptation_count integer not null default 0,
  -- Has a description or alt text (the element's accessibility signal).
  described boolean not null default false,
  listed_at timestamptz not null,
  updated_at timestamptz not null,
  completeness real not null default 0,
  fingerprint text not null,
  search_text text not null default '',
  search_vector tsvector not null,
  projected_at timestamptz not null default now()
);

create index discovery_elements_search_idx on public.discovery_elements using gin (search_vector);
create index discovery_elements_trgm_idx
  on public.discovery_elements using gin (search_text extensions.gin_trgm_ops);
create index discovery_elements_package_idx on public.discovery_elements (package_id);

-- Lineage counts (the first queries that filter on these; see 0021's note).
create index if not exists documents_adapted_from_idx
  on public.documents (adapted_from)
  where adapted_from is not null;
create index if not exists packages_adapted_from_idx
  on public.packages ((manifest -> 'adaptedFrom' ->> 'packageId'))
  where manifest ? 'adaptedFrom';

-- Public read of LISTED rows only; nobody but the projector writes.
alter table public.discovery_courses enable row level security;
alter table public.discovery_elements enable row level security;

create policy "public reads listed courses" on public.discovery_courses
  for select using (public.discovery_course_listable(package_id));
create policy "public reads listed elements" on public.discovery_elements
  for select using (public.discovery_element_listable(doc_id));

revoke insert, update, delete, truncate on public.discovery_courses from anon, authenticated;
revoke insert, update, delete, truncate on public.discovery_elements from anon, authenticated;
grant select on public.discovery_courses to anon, authenticated;
grant select on public.discovery_elements to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The projector.
-- ---------------------------------------------------------------------------

-- Lower-cased, trimmed facet value; null when blank.
create or replace function public.discovery_facet_value(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(btrim(coalesce(p, ''))), '')
$$;

-- Headings (#, ##, ###) of a markdown text: at most 40, each ≤ 120 chars.
create or replace function public.discovery_headings(p_markdown text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(h order by n), '{}')
  from (
    select left(btrim(regexp_replace(m[1], '[ \t]+#+[ \t]*$', '')), 120) as h,
           row_number() over () as n
    from regexp_matches(coalesce(p_markdown, ''), '^#{1,3}[ \t]+([^\n]+)$', 'gn') as m
  ) t
  where h <> '' and n <= 40
$$;

-- Distinct packages (other than itself) that adapted `p_package_id`: forks
-- (manifest.adaptedFrom) plus packages holding a copy of one of its files.
create or replace function public.discovery_course_adaptations(p_package_id text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from (
    select c.id as pkg
    from public.packages c
    where c.manifest ? 'adaptedFrom'
      and c.manifest -> 'adaptedFrom' ->> 'packageId' = p_package_id
      and c.id <> p_package_id
    union
    select d.package_id
    from public.documents s
    join public.documents d on d.adapted_from = s.doc_id
    where s.package_id = p_package_id
      and d.package_id <> p_package_id
      and not d.tombstoned
  ) t
$$;

create or replace function public.discovery_refresh_package(
  p_package_id text,
  p_content_changed boolean default false
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
      case when p_content_changed then now() else x.registered_at end,
      x.completeness, x.fingerprint,
      left(concat_ws(' ', x.title, array_to_string(x.tags, ' '), x.file_name), 2000),
      setweight(to_tsvector('english', x.title), 'A')
        || setweight(to_tsvector('english', array_to_string(x.tags, ' ')), 'B')
        || setweight(to_tsvector('english', concat_ws(' ',
             x.description, x.alt_text, x.file_name, v_title, v_discipline, x.kind)), 'C')
    from (
      select
        d.doc_id, d.package_id, d.repo, d.space, d.kind, d.permalink_class,
        d.path, d.registered_at, d.adapted_from,
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
        md5(concat_ws(chr(31), d.path, d.space, d.kind, d.permalink_class,
          d.description, d.alt_text, array_to_string(coalesce(d.tags, '{}'), chr(30)),
          coalesce(nullif(btrim(d.license), ''), v_license), d.source_hash,
          v_title, v_discipline, v_level)) as fingerprint
      from public.documents d
      where d.package_id = p_package_id
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
      updated_at = case
        when de.fingerprint is distinct from excluded.fingerprint then now()
        else de.updated_at end,
      completeness = excluded.completeness,
      fingerprint = excluded.fingerprint,
      search_text = excluded.search_text,
      search_vector = excluded.search_vector,
      projected_at = now();
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

  v_fingerprint := md5(concat_ws(chr(31), v_title, v_description,
    array_to_string(v_keywords, chr(30)), array_to_string(v_chapters, chr(30)),
    array_to_string(v_topics, chr(30)), v_discipline, v_level, v_context::text,
    v_license, v_a11y, v_m -> 'adaptedFrom' ->> 'packageId'));

  v_owner := v_m -> 'publicRepo' ->> 'owner';
  v_repo := v_m -> 'publicRepo' ->> 'name';

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
    case when p_content_changed then now() else v_reg.registered_at end,
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
    updated_at = case
      when p_content_changed or dc.fingerprint is distinct from excluded.fingerprint then now()
      else dc.updated_at end,
    completeness = excluded.completeness,
    fingerprint = excluded.fingerprint,
    search_text = excluded.search_text,
    search_vector = excluded.search_vector,
    projected_at = now();
end;
$$;

-- Best-effort wrapper used by every trigger: a projector failure becomes a
-- WARNING (the projection catches up on the next change or a rebuild); it
-- never fails the educator's write.
create or replace function public.discovery_refresh_safe(
  p_package_id text,
  p_content_changed boolean default false
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
  begin
    perform public.discovery_refresh_package(p_package_id, p_content_changed);
  exception when others then
    raise warning 'discovery: refresh of % failed: %', p_package_id, sqlerrm;
  end;
end;
$$;

-- Full rebuild: drop every row that is no longer listable, re-project every
-- candidate package. Operator / service role only. Returns the number of
-- packages projected.
create or replace function public.discovery_rebuild()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
  v_n integer := 0;
begin
  delete from public.discovery_courses c where not public.discovery_course_listable(c.package_id);
  delete from public.discovery_elements e where not public.discovery_element_listable(e.doc_id);
  for v_id in
    select p.id
    from public.packages p
    where p.storage = 'github'
      and p.archived_at is null
      and (
        exists (select 1 from public.portal_registrations r where r.package_id = p.id)
        or exists (select 1 from public.documents d where d.package_id = p.id and d.discoverable)
      )
    order by p.id
  loop
    perform public.discovery_refresh_package(v_id, false);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Triggers (refresh on every change the projection depends on).
-- ---------------------------------------------------------------------------

create or replace function public.discovery_on_packages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- A fork: its source gains an adaptation.
    perform public.discovery_refresh_safe(new.manifest -> 'adaptedFrom' ->> 'packageId');
  elsif tg_op = 'DELETE' then
    perform public.discovery_refresh_safe(old.manifest -> 'adaptedFrom' ->> 'packageId');
  elsif new.manifest is distinct from old.manifest
     or new.title is distinct from old.title
     or new.storage is distinct from old.storage
     or new.archived_at is distinct from old.archived_at then
    perform public.discovery_refresh_safe(new.id);
    if (new.manifest -> 'adaptedFrom' ->> 'packageId')
       is distinct from (old.manifest -> 'adaptedFrom' ->> 'packageId') then
      perform public.discovery_refresh_safe(new.manifest -> 'adaptedFrom' ->> 'packageId');
      perform public.discovery_refresh_safe(old.manifest -> 'adaptedFrom' ->> 'packageId');
    end if;
  end if;
  return null;
end;
$$;

create trigger discovery_packages
  after insert or update or delete on public.packages
  for each row execute function public.discovery_on_packages();

create or replace function public.discovery_on_registrations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.discovery_refresh_safe(old.package_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.package_id is distinct from old.package_id) then
    perform public.discovery_refresh_safe(new.package_id);
  end if;
  return null;
end;
$$;

create trigger discovery_registrations
  after insert or update or delete on public.portal_registrations
  for each row execute function public.discovery_on_registrations();

-- documents: statement-level, so a bulk registry write (B.1 bulk upserts, a
-- whole-package upload) re-projects each package once, not once per row.
create or replace function public.discovery_on_documents_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- New public files are new course content (recency).
  perform public.discovery_refresh_safe(x.package_id, x.content)
  from (
    select n.package_id,
           bool_or(n.repo = 'public' and n.space not in ('private', 'current')) as content
    from new_rows n
    group by n.package_id
  ) x;
  -- Copies of another package's file: the source gains an adaptation.
  perform public.discovery_refresh_safe(s.package_id)
  from (
    select distinct src.package_id
    from new_rows n
    join public.documents src on src.doc_id = n.adapted_from
    where n.adapted_from is not null and src.package_id <> n.package_id
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
  perform public.discovery_refresh_safe(x.package_id, x.content)
  from (
    select n.package_id,
           bool_or(n.source_hash is distinct from o.source_hash
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
    group by n.package_id
  ) x;
  -- A copy tombstoned / re-pointed: its source's adaptation count changes.
  perform public.discovery_refresh_safe(s.package_id)
  from (
    select distinct src.package_id
    from new_rows n
    join old_rows o on o.doc_id = n.doc_id
    join public.documents src on src.doc_id in (n.adapted_from, o.adapted_from)
    where (n.adapted_from is not null or o.adapted_from is not null)
      and (n.tombstoned is distinct from o.tombstoned
           or n.adapted_from is distinct from o.adapted_from)
      and src.package_id <> n.package_id
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
  perform public.discovery_refresh_safe(x.package_id)
  from (select distinct o.package_id from old_rows o) x;
  perform public.discovery_refresh_safe(s.package_id)
  from (
    select distinct src.package_id
    from old_rows o
    join public.documents src on src.doc_id = o.adapted_from
    where o.adapted_from is not null and src.package_id <> o.package_id
  ) s;
  return null;
end;
$$;

create trigger discovery_documents_insert
  after insert on public.documents
  referencing new table as new_rows
  for each statement execute function public.discovery_on_documents_insert();
create trigger discovery_documents_update
  after update on public.documents
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.discovery_on_documents_update();
create trigger discovery_documents_delete
  after delete on public.documents
  referencing old table as old_rows
  for each statement execute function public.discovery_on_documents_delete();

-- The course concept map (topics). Row-level, filtered by WHEN, so ordinary
-- file saves never call the projector from here.
create or replace function public.discovery_on_concept_map()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.discovery_refresh_safe(old.package_id);
  else
    perform public.discovery_refresh_safe(new.package_id);
  end if;
  return null;
end;
$$;

create trigger discovery_concept_map_write
  after insert or update on public.sandbox_files
  for each row
  when (new.repo = 'public' and new.path in ('concepts/course.md', 'metadata/course.md'))
  execute function public.discovery_on_concept_map();
create trigger discovery_concept_map_delete
  after delete on public.sandbox_files
  for each row
  when (old.repo = 'public' and old.path in ('concepts/course.md', 'metadata/course.md'))
  execute function public.discovery_on_concept_map();

-- ---------------------------------------------------------------------------
-- 5. Function privileges. Supabase grants EXECUTE on new public functions to
-- anon/authenticated by default; the projector is internal.
-- ---------------------------------------------------------------------------

revoke all on function public.discovery_open_license(text) from public, anon, authenticated;
revoke all on function public.discovery_facet_value(text) from public, anon, authenticated;
revoke all on function public.discovery_headings(text) from public, anon, authenticated;
revoke all on function public.discovery_course_adaptations(text) from public, anon, authenticated;
revoke all on function public.discovery_refresh_package(text, boolean) from public, anon, authenticated;
revoke all on function public.discovery_refresh_safe(text, boolean) from public, anon, authenticated;
revoke all on function public.discovery_rebuild() from public, anon, authenticated;
revoke all on function public.discovery_on_packages() from public, anon, authenticated;
revoke all on function public.discovery_on_registrations() from public, anon, authenticated;
revoke all on function public.discovery_on_documents_insert() from public, anon, authenticated;
revoke all on function public.discovery_on_documents_update() from public, anon, authenticated;
revoke all on function public.discovery_on_documents_delete() from public, anon, authenticated;
revoke all on function public.discovery_on_concept_map() from public, anon, authenticated;
grant execute on function public.discovery_rebuild() to service_role;

-- The read policies call these as the reader; they disclose only "is this
-- id listed", which the listing itself already says.
revoke all on function public.discovery_course_listable(text) from public;
revoke all on function public.discovery_element_listable(text) from public;
grant execute on function public.discovery_course_listable(text) to anon, authenticated, service_role;
grant execute on function public.discovery_element_listable(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Back-fill.
-- ---------------------------------------------------------------------------
select public.discovery_rebuild();
