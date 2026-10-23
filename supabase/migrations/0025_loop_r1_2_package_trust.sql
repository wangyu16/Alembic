-- Security loop r1 (2026-10-23), finding M2: what discovery may trust about a
-- package. NOT APPLIED anywhere yet. Requires 0022 and 0025_loop_r1_1.
--
-- THE HOLE. The packages policy "owner full access" (0001, 0018) lets an owner
-- write every column through the public API, and discovery and /d trust them:
-- a trial package could publish itself (storage = 'github', so its shared files
-- became public), un-archive itself, point manifest.publicRepo at someone
-- else's repository (adaptFromPortalAction then copied content from THAT repo
-- under this course's licence — licence laundering), claim an accessibility
-- "pass", and inflate a course's adaptation count with throw-away trial
-- packages. Repro: /tmp/alembic-audit/flip.mts.
--
-- THE FIX.
--   1. Column privileges (RLS restricts rows, not columns — the 0016 pattern):
--      anon/authenticated may INSERT only id, owner_id, title, manifest,
--      review_all (so a new row is always a trial: storage defaults to
--      'sandbox', archived_at to null) and UPDATE only title, manifest,
--      review_all, last_synced_sha, updated_at. storage, archived_at,
--      public_repo, private_repo, default_branch and the new a11y columns are
--      written by the service role only: the publish action (after the GitHub
--      App created the repos under the educator's own installation), archive /
--      restore, and the accessibility check
--      (apps/web/src/lib/package-trust-writes.ts).
--   2. Discovery uses the publish-recorded repository (packages.public_repo)
--      for listability and the listing's repo/site URLs — never
--      manifest.publicRepo. adaptFromPortalAction reads the repository from
--      the listing (discovery_courses.public_repo_url), so it follows.
--   3. Accessibility: a server record (packages.a11y_status, a11y_checked_at)
--      written by the accessibility-check action; discovery shows, filters and
--      ranks on it. The manifest field stays (the course's own record in
--      alembic.json) but is no longer trusted.
--   4. adaptation_count counts DISTINCT OTHER educators whose adapting package
--      (fork or element copy) is published and not archived.
--
-- Manifest fields discovery still reads (owner-asserted by design — they are
-- the course's own description): title, description, keywords, discipline,
-- level, the courseContext identity fields, chapters, licence (the owner's own
-- grant) and adaptedFrom (lineage DISPLAY only; it moves a source's count only
-- when the adapter is a published course of a different educator).
--
-- OPERATOR PRE-CHECKS (run first):
--   -- Published packages with no recorded repo (they stop being listed):
--   select id, manifest -> 'publicRepo' as manifest_repo from public.packages
--   where storage = 'github'
--     and (coalesce(public_repo ->> 'owner', '') = '' or coalesce(public_repo ->> 'name', '') = '');
--   -- Recorded repo differs from the manifest's (suspicious, or a renamed repo):
--   select id, public_repo, manifest -> 'publicRepo' from public.packages
--   where storage = 'github' and public_repo is distinct from (manifest -> 'publicRepo');
--   -- Listed courses whose badge returns to "not checked" until the owner
--   -- re-runs the accessibility check (deliberately no back-fill from the
--   -- owner-writable manifest):
--   select p.id, p.manifest -> 'accessibility' ->> 'status' from public.packages p
--   join public.portal_registrations r on r.package_id = p.id
--   where p.manifest -> 'accessibility' ->> 'status' in ('pass', 'warn', 'fail');
--
-- DEPLOY ORDER: deploy the loop-r1 web code FIRST, with SUPABASE_SECRET_KEY
-- set — publishing, archiving and restoring now REQUIRE the service client (it
-- writes storage / archived_at / repos / a11y; the new code also stops sending
-- `storage` on insert). Then apply this file. The old code's insert sends
-- `storage` and its publish/archive/restore write those columns with the
-- session client: all refused once this file is applied.

-- ---------------------------------------------------------------------------
-- 1. The server-recorded accessibility result, and column privileges.
-- ---------------------------------------------------------------------------
-- Load pg_trgm in this session first: on Supabase a non-superuser may not
-- SET pg_trgm.word_similarity_threshold on a function while the extension's
-- library is not loaded yet (the parameter is still an unknown placeholder:
-- ERROR 42501 permission denied to set parameter). Calling one of its
-- functions loads it. (0022 did not need this: it created the extension in
-- the same session.)
select extensions.similarity('a', 'a');

alter table public.packages
  add column if not exists a11y_status text not null default 'unknown'
    check (a11y_status in ('pass', 'warn', 'fail', 'unknown')),
  add column if not exists a11y_checked_at timestamptz;

comment on column public.packages.a11y_status is
  'Accessibility result recorded by the server-side check (service role only, 0025). Discovery trusts this, not manifest.accessibility.';

revoke insert, update on public.packages from anon, authenticated;
grant insert (id, owner_id, title, manifest, review_all) on public.packages to authenticated;
grant update (title, manifest, review_all, last_synced_sha, updated_at) on public.packages to authenticated;

comment on table public.packages is
  'Platform record per package. authenticated may INSERT id/owner_id/title/manifest/review_all and UPDATE title/manifest/review_all/last_synced_sha/updated_at (column grants, 0025); storage, archived_at, public_repo, private_repo, default_branch and a11y_* are service-role only.';

-- ---------------------------------------------------------------------------
-- 2. Listability: the publish-recorded repo (plus 0025_1's owner consent).
-- ---------------------------------------------------------------------------
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
    join public.portal_registrations r on r.package_id = p.id and r.owner_id = p.owner_id
    where p.id = p_package_id
      and p.storage = 'github'
      and p.archived_at is null
      and public.discovery_open_license(p.manifest ->> 'license')
      and coalesce(p.public_repo ->> 'owner', '') <> ''
      and coalesce(p.public_repo ->> 'name', '') <> ''
  )
$$;

create or replace function public.discovery_course_matches(p_q text)
returns table (package_id text, relevance double precision)
language sql
stable
security definer
set search_path = ''
set pg_trgm.word_similarity_threshold = 0.45
as $$
  with q as (
    select v.q, v.q <> '' as has_q,
           case when v.q <> '' then websearch_to_tsquery('english', v.q) end as web,
           public.discovery_prefix_query(v.q) as prefix
    from (select left(btrim(coalesce(p_q, '')), 200) as q) v
  )
  select c.package_id,
         case when q.has_q
              then public.discovery_relevance(c.search_vector, c.search_text, q.web, q.prefix, q.q)
              else 1.0 end
  from public.discovery_courses c
  cross join q
  join public.packages p on p.id = c.package_id
  where p.storage = 'github'
    and p.archived_at is null
    and public.discovery_open_license(p.manifest ->> 'license')
    and coalesce(p.public_repo ->> 'owner', '') <> ''
    and coalesce(p.public_repo ->> 'name', '') <> ''
    and exists (select 1 from public.portal_registrations r
                where r.package_id = c.package_id and r.owner_id = p.owner_id)
    and (not q.has_q
         or c.search_vector @@ q.web
         or c.search_vector @@ q.prefix
         or q.q operator(extensions.<%) c.search_text)
$$;
revoke all on function public.discovery_course_matches(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Adaptations: distinct other educators, published adapters only.
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
$$;
revoke all on function public.discovery_course_adaptations(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The projector: 0022's, with three changes marked "security loop r1 (M2)".
-- ---------------------------------------------------------------------------
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
        -- security loop r1 (M2): distinct OTHER educators whose copy lives
        -- in a published, non-archived package.
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

  -- security loop r1 (M2): the server-recorded check (packages.a11y_status,
  -- service role only), never the owner-writable manifest field.
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

  v_fingerprint := md5(concat_ws(chr(31), v_title, v_description,
    array_to_string(v_keywords, chr(30)), array_to_string(v_chapters, chr(30)),
    array_to_string(v_topics, chr(30)), v_discipline, v_level, v_context::text,
    v_license, v_a11y, v_m -> 'adaptedFrom' ->> 'packageId'));

  -- security loop r1 (M2): the repository the publish path recorded
  -- (packages.public_repo, service role only), never manifest.publicRepo.
  v_owner := v_pkg.public_repo ->> 'owner';
  v_repo := v_pkg.public_repo ->> 'name';

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
revoke all on function public.discovery_refresh_package(text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Refresh triggers: a package's publish/archive state now moves its
--    sources' adaptation counts; the recorded repo and a11y move its listing.
-- ---------------------------------------------------------------------------
create or replace function public.discovery_on_packages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- A fork: its source's count may change.
    perform public.discovery_refresh_safe(new.manifest -> 'adaptedFrom' ->> 'packageId');
  elsif tg_op = 'DELETE' then
    perform public.discovery_refresh_safe(old.manifest -> 'adaptedFrom' ->> 'packageId');
  elsif new.manifest is distinct from old.manifest
     or new.title is distinct from old.title
     or new.storage is distinct from old.storage
     or new.archived_at is distinct from old.archived_at
     or new.public_repo is distinct from old.public_repo
     or new.a11y_status is distinct from old.a11y_status
     or new.owner_id is distinct from old.owner_id then
    perform public.discovery_refresh_safe(new.id);
    if (new.manifest -> 'adaptedFrom' ->> 'packageId')
       is distinct from (old.manifest -> 'adaptedFrom' ->> 'packageId') then
      perform public.discovery_refresh_safe(new.manifest -> 'adaptedFrom' ->> 'packageId');
      perform public.discovery_refresh_safe(old.manifest -> 'adaptedFrom' ->> 'packageId');
    end if;
    -- An adapter published, archived, restored or re-owned: its sources'
    -- counts change (fork lineage and element copies).
    if new.storage is distinct from old.storage
       or new.archived_at is distinct from old.archived_at
       or new.owner_id is distinct from old.owner_id then
      perform public.discovery_refresh_safe(new.manifest -> 'adaptedFrom' ->> 'packageId');
      perform public.discovery_refresh_safe(s.package_id)
      from (
        select distinct src.package_id
        from public.documents d
        join public.documents src on src.doc_id = d.adapted_from
        where d.package_id = new.id
          and d.adapted_from is not null
          and src.package_id <> new.id
      ) s;
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.discovery_on_packages() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Re-project everything under the new rules.
-- ---------------------------------------------------------------------------
select public.discovery_rebuild();
