-- Correctness loop r2 (round-2 audit, 2026-10-23), the discovery projector:
-- findings H-D1, M-D1, L-D1, L-D2 (and M-D3, proven moot by a test).
-- NOT APPLIED anywhere yet. Requires 0028_loop_r2_1 (the projector it
-- redefines) and 0028_loop_r2_2. Apply after 0028_loop_r2_5.
--
-- COMPOSITION. Every function redefined here starts from its LATEST
-- definition and keeps every earlier rule:
--   discovery_refresh_package  ← 0028_loop_r2_1 (r1 trust rules of 0025_2:
--       server a11y_status, recorded public_repo, distinct published
--       other-educator adaptations; r1b guards, doc scope and base-table
--       recency of 0026; r2's least(…, now()) clamps). Changes marked "r2c".
--   discovery_refresh_safe / discovery_drain_queue ← 0026.
--   discovery_on_packages ← 0025_loop_r1_2 (adapter publish/archive/re-own
--       refreshes its sources).
--   discovery_on_concept_map + its triggers ← 0022.
--   discovery_rebuild ← 0022.
-- loop-r2-cor.sql.test.ts ("composition") asserts the live definitions still
-- carry every earlier rule.
--
-- THE HOLES.
--   H-D1 (P5.A.1.o). The projector fed unbounded owner text (a file's
--     description / alt text / tags, the course title, description, chapter
--     titles, course context) into to_tsvector; past 1 MB of lexemes it raises
--     "string is too long for tsvector". The educator's own write survived
--     (best-effort wrapper) but discovery_rebuild() aborted on the first such
--     package, so ONE careless or hostile course blocked every rebuild.
--   M-D1 (P5.A.1.h). The best-effort wrapper catches `others`, which does not
--     include query_canceled: a projector that ran past the statement timeout
--     failed the educator's write. And a package-level change (rename, licence,
--     listing) re-projected every element inside the write: 3,000 elements
--     took ~3.4 s in PGlite, mostly a planner choice (a nested-loop anti-join
--     over unanalysed rows, 4.5 M comparisons — quadratic in the package).
--   L-D1 (P5.A.1.p). Renaming the concept map away from concepts/course.md by
--     UPDATE did not re-project (the trigger looked only at the new path), and
--     a concept-map save re-projected every element although only the course
--     row reads it.
--   L-D2 (P5.A.1.q). Two transactions refreshing one package concurrently could
--     interleave; nothing serialised them.
--
-- THE FIX.
--   1. Caps before to_tsvector (and on every projected text): element
--      description ≤ 4,000 chars, alt text ≤ 2,000, ≤ 64 tags of ≤ 100, file
--      name ≤ 300, facets / licence ≤ 200, course title ≤ 300, course
--      description ≤ 8,000, ≤ 200 chapter titles, course-context values ≤ 200,
--      lineage text ≤ 500, concept map read ≤ 500,000 chars. 0029_loop_r2c_3
--      bounds the registry columns at the source.
--   2. Plan-proof, cheaper projector: the stale-row delete probes the
--      documents primary key per row (a scalar subquery the planner cannot
--      turn into a nested-loop anti-join); unchanged element rows are skipped
--      BEFORE their tsvectors are computed.
--   3. Bounded write path: a package-level change that does not touch an
--      element input (description, keywords, chapters, a11y, …) refreshes the
--      course row only; a whole-package refresh of a live package with more
--      than 1,000 candidate elements refreshes the course row now and queues
--      the elements in public.discovery_pending, drained in ≤ 1,000-element
--      chunks by discovery_flush_package (the owner, after the write, in its
--      OWN statement) or discovery_flush_pending (service role).
--   4. A projector cancelled by the statement timeout (query_canceled) no
--      longer fails the write: the wrapper catches it, queues the refresh, and
--      queues every later refresh of the same transaction instead of running
--      it (no work runs after a cancel without a timeout).
--   5. One refresh per package at a time: pg_try_advisory_xact_lock on the
--      package; a refresh that cannot take it queues itself (never waits, so
--      never deadlocks).
--   6. discovery_rebuild() isolates each package (a failure is a WARNING and a
--      row of discovery_rebuild_report(); the rest still rebuild).
--   7. Concept map: the UPDATE trigger fires when the OLD or the NEW path is
--      the concept map, and refreshes the course row only.
--   8. Fingerprints carry a version salt, so the closing rebuild rewrites
--      every projection row once under the caps.
--
-- READ-ONLY PRE-CHECKS (run first):
--   -- how many element rows the caps will shorten:
--   select count(*) filter (where char_length(description) > 4000) as long_descriptions,
--          count(*) filter (where char_length(alt_text) > 2000) as long_alt_texts,
--          count(*) filter (where cardinality(tags) > 64) as many_tags
--   from public.documents;
--   -- the largest packages (whole refreshes above 1,000 elements are queued):
--   select package_id, count(*) from public.documents
--   where discoverable and not tombstoned group by 1 order by 2 desc limit 10;
--
-- DEPLOY ORDER: after 0028_loop_r2_1…_5, before or with the r2c code. Old code
-- keeps working (nothing it calls changes signature). The r2c code calls
-- discovery_flush_package after manifest / listing writes and on the edit
-- page; until it is deployed, a big package's queued element refresh waits
-- for the next rebuild or an operator's discovery_flush_pending().
-- Cost: one discovery_rebuild() at the end (every row rewritten once).

-- ---------------------------------------------------------------------------
-- 1. The pending queue (persistent; survives the transaction that queued it).
-- ---------------------------------------------------------------------------
create table if not exists public.discovery_pending (
  package_id text primary key,
  content boolean not null default false,
  -- null = the whole package; otherwise only these elements (+ the course row)
  doc_ids text[],
  -- whole-package drains resume after this doc id
  cursor_doc_id text,
  queued_at timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text
);

alter table public.discovery_pending enable row level security;
revoke all on public.discovery_pending from public, anon, authenticated, service_role;

comment on table public.discovery_pending is
  'Discovery refreshes deferred out of a write (0029_loop_r2c_1): large whole-package refreshes, refreshes that lost the per-package lock, and refreshes after a cancelled projector. Drained by discovery_flush_package / discovery_flush_pending / discovery_rebuild.';

-- Queue (or merge into) a pending refresh. null doc ids = the whole package
-- and absorb any list; a whole-package entry restarts its drain.
create or replace function public.discovery_pend(
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
  insert into public.discovery_pending as q (package_id, content, doc_ids)
  values (p_package_id, coalesce(p_content_changed, false), p_doc_ids)
  on conflict (package_id) do update set
    content = q.content or excluded.content,
    doc_ids = case
      when q.doc_ids is null or excluded.doc_ids is null then null
      else array(select distinct u from unnest(q.doc_ids || excluded.doc_ids) as u order by u)
    end,
    cursor_doc_id = case when excluded.doc_ids is null then null else q.cursor_doc_id end,
    queued_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The projector (0028_loop_r2_1 §4) with the r2c changes marked.
-- ---------------------------------------------------------------------------
create or replace function public.discovery_refresh_package(
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

  -- r2c (L-D2): one refresh of a package at a time. Never wait (no deadlock,
  -- no write stalled behind a projector): a refresh that cannot take the lock
  -- is queued and drained later. Re-entrant within one transaction. A rebuild
  -- (one transaction over every package) skips it: transaction-level locks
  -- are held to the end, and thousands would exhaust the shared lock table.
  if coalesce(current_setting('alembic.discovery_nolock', true), '') <> 'on'
     and not pg_catalog.pg_try_advisory_xact_lock(
       pg_catalog.hashtextextended('alembic.discovery:' || p_package_id, 0)) then
    perform public.discovery_pend(p_package_id, p_content_changed, p_doc_ids);
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

  -- r2c (H-D1): every projected text is bounded.
  v_title := left(coalesce(nullif(btrim(v_m ->> 'title'), ''), v_pkg.title), 300);
  v_license := left(coalesce(v_m ->> 'license', ''), 200);
  v_discipline := left(public.discovery_facet_value(v_m ->> 'discipline'), 200);
  v_level := left(public.discovery_facet_value(v_m -> 'courseContext' ->> 'level'), 200);

  -- ---- elements -----------------------------------------------------------
  -- r2c (M-D1): probe the documents primary key per projection row (a scalar
  -- subquery stays a per-row index probe; the NOT EXISTS form was planned as
  -- a nested-loop anti-join over unanalysed rows — quadratic).
  delete from public.discovery_elements e
  where e.package_id = p_package_id
    -- r2c (M-D1): a hashed set, not a linear `= any (array)` per row.
    and (p_doc_ids is null or e.doc_id in (select unnest(p_doc_ids)))
    and not coalesce((
      select v_live
        and d.package_id = p_package_id
        and d.discoverable
        and not d.tombstoned
        and d.repo = 'public'
        and d.space not in ('private', 'current')
      from public.documents d
      where d.doc_id = e.doc_id
    ), false);

  if v_live then
    insert into public.discovery_elements as de (
      doc_id, package_id, repo, space, kind, permalink_class, path, title,
      description, alt_text, tags, license, package_title, discipline, level,
      course_listed, adapted_from_doc_id, adaptation_count, described,
      listed_at, updated_at, completeness, fingerprint, search_text,
      search_vector
    )
    select
      y.doc_id, y.package_id, y.repo, y.space, y.kind, y.permalink_class,
      y.path, y.title, y.description, y.alt_text, y.tags, y.license, v_title,
      v_discipline, v_level, v_course_listed, y.adapted_from, y.adaptations,
      y.described, y.listed_at, y.updated_at, y.completeness, y.fingerprint,
      left(concat_ws(' ', y.title, array_to_string(y.tags, ' '), y.file_name), 2000),
      setweight(to_tsvector('english', y.title), 'A')
        || setweight(to_tsvector('english', array_to_string(y.tags, ' ')), 'B')
        || setweight(to_tsvector('english', concat_ws(' ',
             y.description, y.alt_text, y.file_name, v_title, v_discipline, y.kind)), 'C')
    from (
      select x.*,
        -- loop r2 (NEW-2): never a future timestamp, whatever a base row holds.
        least(x.registered_at, now()) as listed_at,
        least(coalesce(x.content_changed_at, x.registered_at), now()) as updated_at
      from (
        select
          d.doc_id, d.package_id, d.repo, d.space, d.kind, d.permalink_class,
          d.path, d.registered_at, d.content_changed_at, d.adapted_from,
          c.description, c.alt_text, c.tags, c.file_name,
          left(coalesce(c.description, c.alt_text, c.file_name), 200) as title,
          coalesce(left(nullif(btrim(d.license), ''), 200), v_license) as license,
          (c.description is not null or c.alt_text is not null) as described,
          -- security loop r1 (M2, 0025_2): distinct OTHER educators whose copy
          -- lives in a published, non-archived package.
          (select count(distinct ap.owner_id)::integer
             from public.documents a
             join public.packages ap on ap.id = a.package_id
            where a.adapted_from = d.doc_id and a.package_id <> d.package_id
              and not a.tombstoned
              and ap.storage = 'github' and ap.archived_at is null
              and ap.owner_id <> v_pkg.owner_id) as adaptations,
          ((case when coalesce(array_length(regexp_split_to_array(coalesce(c.description, ''), '\s+'), 1), 0) >= 3
                 and c.description is not null then 1 else 0 end)
            + (case when coalesce(cardinality(d.tags), 0) >= 1 then 1 else 0 end)
            + (case when nullif(btrim(d.license), '') is not null
                      or public.discovery_open_license(v_license) then 1 else 0 end)
          )::real / 3 as completeness,
          -- Covers every input of title, description, alt_text, tags, license,
          -- described, completeness, package_title, discipline, level,
          -- search_text and search_vector (plus the content hash). r2c: the
          -- 'r2c' salt makes the closing rebuild rewrite every row under the caps.
          md5(row('r2c', d.path, d.space, d.kind, d.permalink_class, d.description,
            d.alt_text, coalesce(d.tags, '{}'), coalesce(nullif(btrim(d.license), ''), v_license),
            d.source_hash, v_title, v_discipline, v_level)::text) as fingerprint
        from public.documents d
        -- r2c (H-D1): the bounded texts, computed once per row.
        cross join lateral (
          select
            left(nullif(btrim(d.description), ''), 4000) as description,
            left(nullif(btrim(d.alt_text), ''), 2000) as alt_text,
            (select coalesce(array_agg(left(t, 100) order by n), '{}')
               from unnest(coalesce(d.tags, '{}')) with ordinality as u(t, n)
              where n <= 64) as tags,
            left(regexp_replace(d.path, '^.*/', ''), 300) as file_name
        ) c
        where d.package_id = p_package_id
          and (p_doc_ids is null or d.doc_id in (select unnest(p_doc_ids)))
          and d.discoverable
          and not d.tombstoned
          and d.repo = 'public'
          and d.space not in ('private', 'current')
      ) x
    ) y
    -- r2c (M-D1): an unchanged row is skipped BEFORE its tsvectors are built
    -- (the conflict guard below stays as the belt).
    where not coalesce((
      select (de2.fingerprint, de2.package_id, de2.repo, de2.course_listed,
              de2.adapted_from_doc_id, de2.adaptation_count, de2.described,
              de2.completeness, de2.listed_at, de2.updated_at)
        is not distinct from
             (y.fingerprint, y.package_id, y.repo, v_course_listed,
              y.adapted_from, y.adaptations, y.described,
              y.completeness, y.listed_at, y.updated_at)
      from public.discovery_elements de2
      where de2.doc_id = y.doc_id
    ), false)
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

  -- r2c (H-D1): bounded.
  v_description := left(btrim(coalesce(v_m ->> 'description', '')), 8000);
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
  where btrim(coalesce(c ->> 'title', '')) <> ''
    and n <= 200; -- r2c (H-D1)
  -- A package without `chapters` is one implicit chapter (manifest.ts).
  v_chapter_count := greatest(coalesce(
    case when jsonb_typeof(v_m -> 'chapters') = 'array'
         then jsonb_array_length(v_m -> 'chapters') end, 0), 1);

  -- The course concept map (public repo; current path, then the legacy one).
  -- r2c (H-D1): only the head of the file can hold the ≤ 40 headings read.
  select left(f.content, 500000) into v_concepts
  from public.sandbox_files f
  where f.package_id = p_package_id
    and f.repo = 'public'
    and f.path in ('concepts/course.md', 'metadata/course.md')
  order by (f.path = 'concepts/course.md') desc
  limit 1;
  v_topics := public.discovery_headings(v_concepts);

  select coalesce(jsonb_object_agg(k, left(btrim(v), 200)), '{}'::jsonb) into v_context
  from jsonb_each_text(
    case when jsonb_typeof(v_m -> 'courseContext') = 'object' then v_m -> 'courseContext' else '{}'::jsonb end
  ) as t(k, v)
  where k in ('courseName', 'level', 'institutionType', 'instructor', 'courseNumber', 'department')
    and btrim(v) <> '';

  -- security loop r1 (M2, 0025_2): the server-recorded check
  -- (packages.a11y_status, service role only), never the manifest field.
  v_a11y := coalesce(v_pkg.a11y_status, 'unknown');
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

  -- security loop r1 (M2, 0025_2): the repository the publish path recorded
  -- (packages.public_repo, service role only), never manifest.publicRepo.
  v_owner := v_pkg.public_repo ->> 'owner';
  v_repo := v_pkg.public_repo ->> 'name';

  -- Covers every listing column except element_count, adaptation_count,
  -- completeness and the timestamps (those are in the upsert guard).
  v_fingerprint := md5(row('r2c', v_title, v_description, v_keywords, v_chapters, v_topics,
    v_discipline, v_level, v_context, v_license, v_a11y, v_chapter_count,
    left(nullif(btrim(v_m -> 'adaptedFrom' ->> 'packageId'), ''), 200),
    left(nullif(btrim(v_m -> 'adaptedFrom' ->> 'title'), ''), 500),
    left(nullif(btrim(v_m -> 'adaptedFrom' ->> 'url'), ''), 500),
    left(nullif(btrim(v_m -> 'adaptedFrom' ->> 'attribution'), ''), 500),
    v_owner, v_repo)::text);

  select max(d.content_changed_at) into v_content_at
  from public.documents d
  where d.package_id = p_package_id
    and d.repo = 'public'
    and d.space not in ('private', 'current');
  -- greatest() ignores nulls.
  -- loop r2 (NEW-2): never a future timestamp, whatever a base row holds.
  v_updated_at := least(greatest(v_reg.registered_at, v_pkg.listing_changed_at, v_content_at), now());

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
    left(nullif(btrim(v_m -> 'adaptedFrom' ->> 'packageId'), ''), 200),
    left(nullif(btrim(v_m -> 'adaptedFrom' ->> 'title'), ''), 500),
    left(nullif(btrim(v_m -> 'adaptedFrom' ->> 'url'), ''), 500),
    left(nullif(btrim(v_m -> 'adaptedFrom' ->> 'attribution'), ''), 500),
    public.discovery_course_adaptations(p_package_id),
    'https://github.com/' || v_owner || '/' || v_repo,
    'https://' || v_owner || '.github.io/' || v_repo || '/',
    least(v_reg.registered_at, now()),
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

-- ---------------------------------------------------------------------------
-- 3. The bounded write-path refresh (r2c, M-D1).
--
-- A whole-package refresh (p_doc_ids null) of a LIVE package with more than
-- 1,000 candidate elements refreshes the course row now ('{}' = no elements)
-- and queues the elements. Scoped refreshes are bounded by their callers (the
-- registry writes ≤ 500 rows per documents_apply). A non-live package's whole
-- refresh is only deletions and runs now. After a cancelled projector in this
-- transaction, everything is queued.
-- ---------------------------------------------------------------------------
create or replace function public.discovery_refresh_bounded(
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
  v_candidates integer;
begin
  if p_package_id is null then
    return;
  end if;
  if coalesce(current_setting('alembic.discovery_cancelled', true), '') = 'on' then
    perform public.discovery_pend(p_package_id, p_content_changed, p_doc_ids);
    return;
  end if;
  if p_doc_ids is null and exists (
    select 1 from public.packages p
    where p.id = p_package_id and p.storage = 'github' and p.archived_at is null
  ) then
    select count(*) into v_candidates
    from (
      select 1 from public.documents d
      where d.package_id = p_package_id and d.discoverable and not d.tombstoned
      limit 1001
    ) s;
    if v_candidates > 1000 then
      perform public.discovery_refresh_package(p_package_id, p_content_changed, '{}');
      perform public.discovery_pend(p_package_id, p_content_changed, null);
      return;
    end if;
  end if;
  perform public.discovery_refresh_package(p_package_id, p_content_changed, p_doc_ids);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The best-effort wrapper (0026) and the deferral drain (0026), now through
--    the bounded refresh, and catching query_canceled (r2c, M-D1).
--
-- query_canceled is caught BY NAME (`others` excludes it): the projector's
-- sub-transaction rolls back, the refresh is queued, and the transaction-local
-- flag alembic.discovery_cancelled makes every later refresh of this
-- transaction queue instead of run — so nothing runs on after the timeout
-- fired, and the educator's write (already done: these are AFTER triggers)
-- commits. A client cancel of such a statement likewise lets the write
-- through; it cannot leave a half-projected package (sub-transaction).
-- ---------------------------------------------------------------------------
create or replace function public.discovery_refresh_safe(
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
    perform public.discovery_refresh_bounded(p_package_id, p_content_changed, p_doc_ids);
  exception
    when query_canceled then
      perform set_config('alembic.discovery_cancelled', 'on', true);
      perform public.discovery_pend(p_package_id, p_content_changed, p_doc_ids);
      raise warning 'discovery: refresh of % cancelled; queued', p_package_id;
    when others then
      raise warning 'discovery: refresh of % failed: %', p_package_id, sqlerrm;
  end;
end;
$$;

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
      perform public.discovery_refresh_bounded(r.package_id, r.content, r.doc_ids);
    exception
      when query_canceled then
        perform set_config('alembic.discovery_cancelled', 'on', true);
        perform public.discovery_pend(r.package_id, r.content, r.doc_ids);
        raise warning 'discovery: refresh of % cancelled; queued', r.package_id;
      when others then
        raise warning 'discovery: refresh of % failed: %', r.package_id, sqlerrm;
    end;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Draining the pending queue, in bounded chunks, in its OWN statement.
--
-- discovery_flush_one(p, budget): a scoped entry runs as one refresh; a
-- whole-package entry runs as the course row plus ≤ 1,000-element chunks in
-- doc-id order (every doc id the package has in documents OR in the
-- projection, so stale rows are removed too), resuming after cursor_doc_id,
-- until done or the time budget is spent. Returns true when the entry is
-- gone. A failure records attempts / last_error and keeps the entry.
-- ---------------------------------------------------------------------------
create or replace function public.discovery_flush_one(
  p_package_id text,
  p_budget interval default interval '2 seconds'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q public.discovery_pending%rowtype;
  v_start timestamptz := clock_timestamp();
  v_chunk text[];
  v_last text;
begin
  select * into v_q from public.discovery_pending
  where package_id = p_package_id
  for update skip locked;
  if not found then
    return not exists (select 1 from public.discovery_pending where package_id = p_package_id);
  end if;

  begin
    if v_q.doc_ids is not null then
      delete from public.discovery_pending where package_id = p_package_id;
      perform public.discovery_refresh_package(p_package_id, v_q.content, v_q.doc_ids);
      return not exists (select 1 from public.discovery_pending where package_id = p_package_id);
    end if;

    v_last := v_q.cursor_doc_id;
    loop
      select array_agg(i order by i) into v_chunk
      from (
        select i from (
          select d.doc_id as i from public.documents d where d.package_id = p_package_id
          union
          select e.doc_id from public.discovery_elements e where e.package_id = p_package_id
        ) u
        where v_last is null or i > v_last
        order by i
        limit 1000
      ) s;
      exit when v_chunk is null;
      perform public.discovery_refresh_package(p_package_id, v_q.content, v_chunk);
      v_last := v_chunk[cardinality(v_chunk)];
      if clock_timestamp() - v_start >= p_budget then
        update public.discovery_pending set cursor_doc_id = v_last where package_id = p_package_id;
        return false;
      end if;
    end loop;
    -- every element done: the course row (element_count) last
    delete from public.discovery_pending where package_id = p_package_id;
    perform public.discovery_refresh_package(p_package_id, v_q.content, '{}');
    return not exists (select 1 from public.discovery_pending where package_id = p_package_id);
  exception when others then
    update public.discovery_pending
    set attempts = attempts + 1, last_error = left(sqlerrm, 500)
    where package_id = p_package_id;
    raise warning 'discovery: pending refresh of % failed: %', p_package_id, sqlerrm;
    return false;
  end;
end;
$$;

-- The owner, after a write (its own statement: a timeout here cannot touch
-- the write, which already committed). Returns true when nothing is pending.
-- Anyone else's package: a no-op answering true (no oracle).
create or replace function public.discovery_flush_package(p_package_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.caller_owns_package(p_package_id) then
    return true;
  end if;
  return public.discovery_flush_one(p_package_id, interval '2 seconds');
end;
$$;

-- Service role / operator: drain up to p_max packages, oldest first.
create or replace function public.discovery_flush_pending(
  p_max integer default 10,
  p_budget interval default interval '20 seconds'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
  v_done integer := 0;
  v_start timestamptz := clock_timestamp();
begin
  for v_id in
    select package_id from public.discovery_pending
    order by queued_at
    limit greatest(coalesce(p_max, 10), 0)
  loop
    exit when clock_timestamp() - v_start >= p_budget;
    if public.discovery_flush_one(v_id, p_budget - (clock_timestamp() - v_start)) then
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Rebuild: one package's failure never aborts the rest (r2c, H-D1).
-- ---------------------------------------------------------------------------
create or replace function public.discovery_rebuild_report()
returns table (package_id text, ok boolean, error text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text;
begin
  perform set_config('alembic.discovery_nolock', 'on', true);
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
    begin
      perform public.discovery_refresh_package(v_id, false);
      delete from public.discovery_pending q where q.package_id = v_id;
      package_id := v_id; ok := true; error := null;
    exception when others then
      raise warning 'discovery: rebuild of % failed: %', v_id, sqlerrm;
      package_id := v_id; ok := false; error := left(sqlerrm, 500);
    end;
    return next;
  end loop;
  -- what is left pending belongs to packages that are no longer candidates
  delete from public.discovery_pending q
  where not exists (select 1 from public.packages p where p.id = q.package_id);
  perform set_config('alembic.discovery_nolock', 'off', true);
end;
$$;

create or replace function public.discovery_rebuild()
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer from public.discovery_rebuild_report() r where r.ok
$$;

-- ---------------------------------------------------------------------------
-- 7. Package trigger (0025_loop_r1_2 §5): course-only when no element input
--    changed (r2c, M-D1); a source's adaptation counts are scoped refreshes.
-- ---------------------------------------------------------------------------

-- Everything of a packages row that an ELEMENT row of it is derived from:
-- package_title, discipline, level, the default licence, liveness, the owner
-- (adaptation counts) and listability (course_listed). Other changes —
-- description, keywords, chapters, course context, a11y, … — are course-only.
create or replace function public.discovery_element_key(
  p_title text,
  p_manifest jsonb,
  p_storage text,
  p_archived_at timestamptz,
  p_owner_id uuid,
  p_public_repo jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_array(
    coalesce(nullif(btrim(p_manifest ->> 'title'), ''), p_title),
    p_manifest -> 'license',
    p_manifest -> 'discipline',
    p_manifest -> 'courseContext' -> 'level',
    p_storage,
    p_archived_at,
    p_owner_id,
    p_public_repo -> 'owner',
    p_public_repo -> 'name'
  )
$$;

create or replace function public.discovery_on_packages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- A fork: its source's course count may change (course row only).
    perform public.discovery_refresh_safe(new.manifest -> 'adaptedFrom' ->> 'packageId', false, '{}');
  elsif tg_op = 'DELETE' then
    perform public.discovery_refresh_safe(old.manifest -> 'adaptedFrom' ->> 'packageId', false, '{}');
  elsif new.manifest is distinct from old.manifest
     or new.title is distinct from old.title
     or new.storage is distinct from old.storage
     or new.archived_at is distinct from old.archived_at
     or new.public_repo is distinct from old.public_repo
     or new.a11y_status is distinct from old.a11y_status
     or new.owner_id is distinct from old.owner_id then
    if public.discovery_element_key(new.title, new.manifest, new.storage, new.archived_at,
                                    new.owner_id, new.public_repo)
       is distinct from
       public.discovery_element_key(old.title, old.manifest, old.storage, old.archived_at,
                                    old.owner_id, old.public_repo) then
      perform public.discovery_refresh_safe(new.id);
    else
      perform public.discovery_refresh_safe(new.id, false, '{}');
    end if;
    if (new.manifest -> 'adaptedFrom' ->> 'packageId')
       is distinct from (old.manifest -> 'adaptedFrom' ->> 'packageId') then
      perform public.discovery_refresh_safe(new.manifest -> 'adaptedFrom' ->> 'packageId', false, '{}');
      perform public.discovery_refresh_safe(old.manifest -> 'adaptedFrom' ->> 'packageId', false, '{}');
    end if;
    -- An adapter published, archived, restored or re-owned: its sources'
    -- counts change (fork lineage: course row; element copies: those rows).
    if new.storage is distinct from old.storage
       or new.archived_at is distinct from old.archived_at
       or new.owner_id is distinct from old.owner_id then
      perform public.discovery_refresh_safe(new.manifest -> 'adaptedFrom' ->> 'packageId', false, '{}');
      perform public.discovery_refresh_safe(s.package_id, false, s.doc_ids)
      from (
        select src.package_id, array_agg(distinct src.doc_id) as doc_ids
        from public.documents d
        join public.documents src on src.doc_id = d.adapted_from
        where d.package_id = new.id
          and d.adapted_from is not null
          and src.package_id <> new.id
        group by src.package_id
      ) s;
    end if;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Concept map (0022): the course row only, and a rename away counts
--    (r2c, L-D1).
-- ---------------------------------------------------------------------------
create or replace function public.discovery_on_concept_map()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.discovery_refresh_safe(old.package_id, false, '{}');
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.package_id is distinct from old.package_id) then
    perform public.discovery_refresh_safe(new.package_id, false, '{}');
  end if;
  return null;
end;
$$;

drop trigger if exists discovery_concept_map_write on public.sandbox_files;
create trigger discovery_concept_map_write
  after insert on public.sandbox_files
  for each row
  when (new.repo = 'public' and new.path in ('concepts/course.md', 'metadata/course.md'))
  execute function public.discovery_on_concept_map();
drop trigger if exists discovery_concept_map_update on public.sandbox_files;
create trigger discovery_concept_map_update
  after update on public.sandbox_files
  for each row
  when ((new.repo = 'public' and new.path in ('concepts/course.md', 'metadata/course.md'))
     or (old.repo = 'public' and old.path in ('concepts/course.md', 'metadata/course.md')))
  execute function public.discovery_on_concept_map();
-- (discovery_concept_map_delete, 0022, is unchanged: it already reads old.)

-- ---------------------------------------------------------------------------
-- 9. Privileges (0022 §5 pattern). Internal, except the owner's flush.
-- ---------------------------------------------------------------------------
revoke all on function public.discovery_pend(text, boolean, text[]) from public, anon, authenticated;
revoke all on function public.discovery_refresh_package(text, boolean, text[]) from public, anon, authenticated;
revoke all on function public.discovery_refresh_bounded(text, boolean, text[]) from public, anon, authenticated;
revoke all on function public.discovery_refresh_safe(text, boolean, text[]) from public, anon, authenticated;
revoke all on function public.discovery_drain_queue() from public, anon, authenticated;
revoke all on function public.discovery_flush_one(text, interval) from public, anon, authenticated;
revoke all on function public.discovery_flush_package(text) from public, anon;
grant execute on function public.discovery_flush_package(text) to authenticated, service_role;
revoke all on function public.discovery_flush_pending(integer, interval) from public, anon, authenticated;
grant execute on function public.discovery_flush_pending(integer, interval) to service_role;
revoke all on function public.discovery_rebuild_report() from public, anon, authenticated;
grant execute on function public.discovery_rebuild_report() to service_role;
revoke all on function public.discovery_rebuild() from public, anon, authenticated;
grant execute on function public.discovery_rebuild() to service_role;
revoke all on function public.discovery_element_key(text, jsonb, text, timestamptz, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.discovery_on_packages() from public, anon, authenticated;
revoke all on function public.discovery_on_concept_map() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Re-project once under the caps (the salted fingerprints rewrite every row).
-- ---------------------------------------------------------------------------
select public.discovery_rebuild();
