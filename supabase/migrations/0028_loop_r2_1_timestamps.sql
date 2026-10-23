-- Security loop r2 (round-2 audit, 2026-10-23), findings NEW-2 and LOW-4:
-- recency and adaptation signals the owner cannot forge. NOT APPLIED anywhere
-- yet. Requires 0026 (the projector it redefines) and 0027.
--
-- THE HOLES.
--   NEW-2 (P5.A.1.n). portal_registrations.registered_at and
--     documents.registered_at were client-writable (the owner's insert/update
--     policies, documents_apply's `coalesce(x.registered_at, now())` and its
--     upsert's `registered_at = excluded.registered_at`). The projector reads
--     them as listed_at / updated_at, so a course or file could be listed as
--     registered in 2099 and stay "newest" forever (repro: /tmp/alembic-r2/
--     probe1.mts, probe2.mts — discovery_search_courses(p_as_of => +1 year)).
--   LOW-4 (P5.S.3.f). A course's adaptation_count counted any published
--     package of another educator whose (owner-written) manifest names it in
--     adaptedFrom, even one that holds no content at all.
--
-- THE FIX.
--   1. Existing future values are clamped to now() (with the owning triggers
--      off, so the clamp is not undone; content_changed_at and
--      listing_changed_at are trigger-owned since 0026 but clamped too).
--   2. BEFORE triggers make both registered_at columns server-owned: now() on
--      insert, the old value on update — for every role, so not even a
--      service-role write can forge recency.
--   3. The projector (0026's, otherwise unchanged) projects
--      least(…, now()) for every listed_at / updated_at — a belt to the
--      triggers' braces for any row written before them.
--   4. discovery_course_adaptations counts an adapting package only if it
--      holds at least one live (not tombstoned) public file, besides the 0025
--      rules (published, not archived, a different educator).
--   5. Re-project once.
--
-- READ-ONLY PRE-CHECK (run first; how many rows the clamp will touch):
--   select (select count(*) from public.portal_registrations where registered_at > now()) as registrations,
--          (select count(*) from public.documents where registered_at > now()) as documents,
--          (select count(*) from public.documents where content_changed_at > now()) as content_changed,
--          (select count(*) from public.packages where listing_changed_at > now()) as listing_changed;
--
-- DEPLOY ORDER: either order with the r2 code (no code depends on it; the
-- code may keep sending registered_at — it is ignored). Apply after 0027 and
-- before 0028_loop_r2_2. Cost: one discovery_rebuild() (as 0026 did).

-- ---------------------------------------------------------------------------
-- 1. Clamp what is already stored.
-- ---------------------------------------------------------------------------
update public.portal_registrations set registered_at = now() where registered_at > now();
update public.documents set registered_at = now() where registered_at > now();

alter table public.documents disable trigger documents_content_changed_at;
update public.documents set content_changed_at = now() where content_changed_at > now();
alter table public.documents enable trigger documents_content_changed_at;

alter table public.packages disable trigger packages_listing_changed_at;
update public.packages set listing_changed_at = now() where listing_changed_at > now();
alter table public.packages enable trigger packages_listing_changed_at;

-- ---------------------------------------------------------------------------
-- 2. registered_at is server-owned.
-- ---------------------------------------------------------------------------
create or replace function public.server_owned_registered_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.registered_at := now();
  else
    new.registered_at := old.registered_at;
  end if;
  return new;
end;
$$;

drop trigger if exists documents_registered_at on public.documents;
create trigger documents_registered_at
  before insert or update on public.documents
  for each row execute function public.server_owned_registered_at();

drop trigger if exists portal_registrations_registered_at on public.portal_registrations;
create trigger portal_registrations_registered_at
  before insert or update on public.portal_registrations
  for each row execute function public.server_owned_registered_at();

comment on column public.documents.registered_at is
  'When the file was first registered. Server-owned (trigger documents_registered_at, 0028_loop_r2_1): a client value is ignored.';
comment on column public.portal_registrations.registered_at is
  'When the course was listed. Server-owned (trigger portal_registrations_registered_at, 0028_loop_r2_1): a client value is ignored.';

-- ---------------------------------------------------------------------------
-- 3. Adaptations need adapted content (LOW-4).
-- ---------------------------------------------------------------------------
create or replace function public.discovery_course_adaptations(p_package_id text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(distinct a.owner_id)::integer
  from (
    select c.id
    from public.packages c
    where c.manifest ? 'adaptedFrom'
      and c.manifest -> 'adaptedFrom' ->> 'packageId' = p_package_id
    union
    select d.package_id
    from public.documents s
    join public.documents d on d.adapted_from = s.doc_id
    where s.package_id = p_package_id
      and not d.tombstoned
  ) t
  join public.packages a on a.id = t.id
  join public.packages src on src.id = p_package_id
  where a.id <> p_package_id
    and a.storage = 'github'
    and a.archived_at is null
    and a.owner_id <> src.owner_id
    -- loop r2 (LOW-4): the adapter holds adapted content — at least one live
    -- public file (an empty course naming a source in its manifest adds nothing).
    and exists (
      select 1 from public.documents ad
      where ad.package_id = a.id and ad.repo = 'public' and not ad.tombstoned
    )
$$;

-- ---------------------------------------------------------------------------
-- 4. The projector (0026 §3), with the three least(…, now()) clamps marked
--    "loop r2 (NEW-2)". Same signature: the triggers keep resolving it.
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
      x.described,
      -- loop r2 (NEW-2): never a future timestamp, whatever a base row holds.
      least(x.registered_at, now()),
      least(coalesce(x.content_changed_at, x.registered_at), now()),
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
        -- security loop r1 (M2, 0025_2): distinct OTHER educators whose copy
        -- lives in a published, non-archived package.
        (select count(distinct ap.owner_id)::integer
           from public.documents a
           join public.packages ap on ap.id = a.package_id
          where a.adapted_from = d.doc_id and a.package_id <> d.package_id
            and not a.tombstoned
            and ap.storage = 'github' and ap.archived_at is null
            and ap.owner_id <> v_pkg.owner_id) as adaptations,
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
    nullif(btrim(v_m -> 'adaptedFrom' ->> 'packageId'), ''),
    nullif(btrim(v_m -> 'adaptedFrom' ->> 'title'), ''),
    nullif(btrim(v_m -> 'adaptedFrom' ->> 'url'), ''),
    nullif(btrim(v_m -> 'adaptedFrom' ->> 'attribution'), ''),
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
-- 5. Privileges (0022 §5 pattern) and one re-projection.
-- ---------------------------------------------------------------------------
revoke all on function public.server_owned_registered_at() from public, anon, authenticated;
revoke all on function public.discovery_course_adaptations(text) from public, anon, authenticated;
revoke all on function public.discovery_refresh_package(text, boolean, text[]) from public, anon, authenticated;

select public.discovery_rebuild();
