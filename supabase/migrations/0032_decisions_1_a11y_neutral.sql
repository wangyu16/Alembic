-- Owner decision 2 of 2026-10-24 (the accessibility badge), SQL half: a
-- course with no current accessibility check is NEUTRAL in Discover — no
-- badge (the UI), no "Not checked" facet value, and the accessibility ranking
-- signal carries no weight, rather than counting as a failure. NOT APPLIED
-- anywhere yet. Requires 0022_trackA_discovery (the two functions redefined
-- here, their latest definitions) and 0025_loop_r1_2 (discovery_course_matches,
-- called unchanged). Apply after 0031_loop_r4b_3.
--
-- WHY. The check now runs automatically after every publish and every public
-- commit (app code, lib/a11y-auto.ts), and its result still expires when the
-- recorded public head moves (0030_loop_r3c_4, unchanged). So "unknown" means
-- "the check for the current version has not finished, or could not run" —
-- not "inaccessible". Ranking it like `fail` (0022: unknown → 0) punished every
-- course for the minutes between a save and its re-check.
--
-- NEUTRAL, defined. The quality score is a weighted sum whose weights sum to 1
-- (accessibility 0.30, open licence 0.15, completeness 0.20, recency 0.20,
-- adaptations 0.15). For a course without a current check the accessibility
-- term is left out and the other four are re-weighted to sum to 1
-- (quality without it ÷ 0.70): the course ranks on what is known about it.
-- So an unchecked course is never below a `fail` with the same other signals,
-- and never above a `pass`. Elements are NOT changed: their accessibility
-- signal is "has a description or alt text", which is always known.
--
-- COMPOSITION (DecisionLog 2026-10-23, "Composition rule"). Each function
-- redefined here starts from its latest definition and keeps every rule:
--   discovery_search_courses (0022): same signature and columns, same
--     filters, keyset paging, 51-row clamp, p_as_of hour rounding; ONLY the
--     quality call changes, to discovery_course_quality.
--   discovery_course_facets (0022): same signature, same per-facet "every
--     other filter" counting, 50-value cap; ONLY the a11y facet leaves out
--     'unknown' (the filter itself still accepts it — the app no longer sends it).
-- discovery_quality / discovery_score (0022) are unchanged (elements and the
-- agreement test still use them); the new function calls discovery_quality.
-- loop-r2-cor.sql.test.ts / decisions-a11y.sql.test.ts assert the composition
-- (P5.A.1.r).
--
-- GRANTS. CREATE OR REPLACE keeps the existing grants (anon, authenticated,
-- service_role execute the two RPCs; 0022). The new helper is closed to the
-- API roles like discovery_quality.
--
-- READ-ONLY PRE-CHECKS:
--   -- listed courses that rank as "unknown" today (they move up, not down):
--   select count(*) from public.discovery_courses where accessibility_status = 'unknown';
--
-- DEPLOY ORDER: either order with the decision-2 code; neither depends on the
-- other. Rollback: re-run the two function bodies from 0022.

-- ---------------------------------------------------------------------------
-- 1. Course quality: accessibility is neutral when there is no current check.
-- ---------------------------------------------------------------------------
create or replace function public.discovery_course_quality(
  p_a11y text,
  p_license text,
  p_completeness real,
  p_adaptations integer,
  p_updated_at timestamptz,
  p_as_of timestamptz
)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select case
           when p_a11y in ('pass', 'warn', 'fail')
             then public.discovery_quality(p_a11y, p_license, p_completeness, p_adaptations,
                                           p_updated_at, p_as_of)
           -- no current check: leave the accessibility term out (discovery_quality
           -- gives it 0 for 'unknown') and re-weight the rest (they sum to 0.70)
           else public.discovery_quality('unknown', p_license, p_completeness, p_adaptations,
                                         p_updated_at, p_as_of) / 0.70
         end
$$;

revoke all on function public.discovery_course_quality(text, text, real, integer, timestamptz, timestamptz)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. One page of courses (0022 definition; the quality call changes only).
-- ---------------------------------------------------------------------------
create or replace function public.discovery_search_courses(
  p_q text default null,
  p_discipline text default null,
  p_level text default null,
  p_license text default null,
  p_a11y text default null,
  p_after_score numeric default null,
  p_after_id text default null,
  p_as_of timestamptz default null,
  p_limit integer default 20
)
returns table (
  package_id text, title text, description text, keywords text[],
  chapter_titles text[], topics text[], discipline text, level text,
  course_context jsonb, license text, accessibility_status text,
  chapter_count integer, element_count integer,
  adapted_from_package_id text, adapted_from_title text,
  adapted_from_url text, adapted_from_attribution text, adaptation_count integer,
  public_repo_url text, site_url text, listed_at timestamptz, updated_at timestamptz,
  completeness real, score numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with scored as (
    select c.*,
           public.discovery_score(m.relevance, public.discovery_course_quality(
             c.accessibility_status, c.license, c.completeness, c.adaptation_count,
             c.updated_at, coalesce(p_as_of, date_trunc('hour', now())))) as s
    from public.discovery_course_matches(p_q) m
    join public.discovery_courses c on c.package_id = m.package_id
    where (p_discipline is null or c.discipline = public.discovery_facet_value(p_discipline))
      and (p_level is null or c.level = public.discovery_facet_value(p_level))
      and (p_license is null or c.license = p_license)
      and (p_a11y is null or c.accessibility_status = p_a11y)
  )
  select x.package_id, x.title, x.description, x.keywords, x.chapter_titles, x.topics,
         x.discipline, x.level, x.course_context, x.license, x.accessibility_status,
         x.chapter_count, x.element_count, x.adapted_from_package_id, x.adapted_from_title,
         x.adapted_from_url, x.adapted_from_attribution, x.adaptation_count,
         x.public_repo_url, x.site_url, x.listed_at, x.updated_at, x.completeness, x.s
  from scored x
  where p_after_score is null
     or (x.s, x.package_id) < (p_after_score, coalesce(p_after_id, ''))
  order by x.s desc, x.package_id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 51)
$$;

-- ---------------------------------------------------------------------------
-- 3. Facet counts (0022 definition; the a11y facet leaves out 'unknown').
-- ---------------------------------------------------------------------------
create or replace function public.discovery_course_facets(
  p_q text default null,
  p_discipline text default null,
  p_level text default null,
  p_license text default null,
  p_a11y text default null
)
returns table (facet text, value text, n bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select c.discipline, c.level, c.license, c.accessibility_status as a11y
    from public.discovery_course_matches(p_q) h
    join public.discovery_courses c on c.package_id = h.package_id
  ),
  f as (
    select m.*,
           (p_discipline is null or m.discipline = public.discovery_facet_value(p_discipline)) as ok_d,
           (p_level is null or m.level = public.discovery_facet_value(p_level)) as ok_l,
           (p_license is null or m.license = p_license) as ok_c,
           (p_a11y is null or m.a11y = p_a11y) as ok_a
    from m
  )
  (select 'total'::text, null::text, count(*) from f where ok_d and ok_l and ok_c and ok_a)
  union all
  (select 'discipline', f.discipline, count(*) from f
    where f.discipline is not null and ok_l and ok_c and ok_a
    group by f.discipline order by count(*) desc, f.discipline limit 50)
  union all
  (select 'level', f.level, count(*) from f
    where f.level is not null and ok_d and ok_c and ok_a
    group by f.level order by count(*) desc, f.level limit 50)
  union all
  (select 'license', f.license, count(*) from f
    where ok_d and ok_l and ok_a
    group by f.license order by count(*) desc, f.license limit 50)
  union all
  -- no current check is not a value to choose (owner decision 2, 2026-10-24)
  (select 'a11y', f.a11y, count(*) from f
    where f.a11y <> 'unknown' and ok_d and ok_l and ok_c
    group by f.a11y order by count(*) desc, f.a11y limit 50)
$$;
