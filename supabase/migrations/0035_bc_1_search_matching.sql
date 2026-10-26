-- Blind critique r2 (2026-10-26), finding P1 "Search" (signed-out Discover):
-- a transposed-letter typo finds nothing, and a two-word query lets in a
-- course that matches only one of the words. NOT APPLIED anywhere yet.
-- Requires 0022_trackA_discovery (discovery_element_matches, discovery_prefix_query,
-- discovery_relevance — latest definitions) and 0025_loop_r1_2_package_trust
-- (discovery_course_matches — latest definition). Apply after 0034.
--
-- WHY.
--   (a) "entorpy" did not find "Information Entropy". A transposition breaks
--       three of a 7-letter word's 8 trigrams: word_similarity('entorpy',
--       'Information Entropy') = 0.375, under the 0.45 threshold. Lowering the
--       threshold is NOT the fix: at 0.35 'stats' would sit at 0.33 against
--       "General Chemistry … acids bases Titration" and 'titartion' at 0.30
--       against "Information Entropy" — one more notch and short words match
--       everything. The threshold stays 0.45. Instead a LAST-RESORT tier: when
--       nothing else matched, each query word of 4–30 letters is tried with
--       every pair of adjacent letters swapped (Damerau distance 1,
--       transposition only), as stemmed full words against the weighted
--       tsvector. "entorpy" → "entropy" matches; a junk word ("xyzzyq") has no
--       real-word neighbour and still finds nothing. It never adds to a
--       non-empty result, so it cannot make a working query noisier.
--   (b) "organic chemistry" returned General Chemistry. The full-word and the
--       prefix queries were already AND (websearch_to_tsquery and
--       discovery_prefix_query join the words with &), but the trigram path
--       compared the WHOLE phrase with the row's text:
--       word_similarity('organic chemistry', 'General Chemistry …') = 0.56 ≥
--       0.45, so one shared word was enough. Matching is now TIERED:
--         tier 1 (all words): the websearch query matches (its own semantics:
--           phrases, OR, -exclusions), or EVERY meaningful word of the query
--           (non-stop-word, first 8 tokens, the prefix query's tokenisation)
--           matches the row on its own — full word, prefix, or per-word
--           trigram ≥ 0.45 (so "organic chemstry" still finds Organic
--           Chemistry). With only stop words, the old phrase test.
--         tier 2 (any word): the old predicate (full / prefix / whole-phrase
--           trigram) or ANY one word matches.
--         tier 3 (transposition, (a)).
--       Only the best non-empty tier is returned. So a query whose words all
--       occur somewhere returns only the all-word rows; a query that no row
--       satisfies in full still returns the any-word rows (the fallback);
--       the typo tier only when both are empty. Within a tier, relevance is
--       unchanged (discovery_relevance, mirrored nowhere else); the tier-3
--       rows rank with the transposed query in place of the websearch query.
--       Note: tiers are chosen BEFORE the facet filters (the signatures are
--       unchanged), so "organic chemistry" filtered to physics shows no
--       results rather than physics courses matching one word — consistent
--       with the facet counts, which use the same match set.
--   Cost: every live row is tested (a lateral count over ≤ 8 words), like the
--   browse path already does; the scale note of discovery-index.md §2 holds.
--
-- COMPOSITION (DecisionLog 2026-10-23, "Composition rule"). Each function
-- redefined here starts from its latest definition and keeps every rule:
--   discovery_course_matches (0025_loop_r1_2): same signature and columns,
--     security definer, search_path '', word_similarity_threshold 0.45, the
--     same live listability (published, not archived, open licence, recorded
--     public repo owner+name, a registration by the package's own owner),
--     empty query = every listed course at relevance 1; ONLY the text test
--     becomes tiered.
--   discovery_element_matches (0022): same signature and columns, security
--     definer, search_path '', threshold 0.45, the same live listability
--     (discoverable, not tombstoned, public repo, not private/current space,
--     published, not archived), empty query = every listed element; ONLY the
--     text test becomes tiered.
-- discovery_prefix_query / discovery_relevance / discovery_search_* /
-- *_facets are unchanged (the RPCs call the matches functions by name).
-- loop-r2-cor.sql.test.ts asserts the composition (P5.A.1.r).
--
-- GRANTS. CREATE OR REPLACE keeps the existing grants: both matches functions
-- stay closed to the API roles (0022/0025 revokes; only the definer RPCs call
-- them). The two new helpers are closed to the API roles like
-- discovery_prefix_query (the rpc-limits inventory of anon-callable
-- discovery_* functions does not change).
--
-- READ-ONLY PRE-CHECKS (none required; to see the effect before/after):
--   select package_id from public.discovery_course_matches('organic chemistry');
--   select package_id from public.discovery_course_matches('entorpy');
--
-- DEPLOY ORDER: independent of the app code (no signature or column changes);
-- apply after 0034 in any deploy. Rollback: re-run discovery_course_matches
-- from 0025_loop_r1_2 and discovery_element_matches from 0022, then
-- drop function public.discovery_transposed_query(text),
--               public.discovery_query_words(text).

-- Load pg_trgm in this session first (see 0025_loop_r1_2: a non-superuser may
-- not SET pg_trgm.word_similarity_threshold on a function before the
-- extension's library is loaded in the session).
select extensions.similarity('a', 'a');

-- ---------------------------------------------------------------------------
-- 1. Helpers: the query's meaningful words, and their transpositions.
-- ---------------------------------------------------------------------------

-- The query's words as the prefix query sees them (alphanumeric tokens only,
-- so user input is never parsed as tsquery syntax; the first 8), minus stop
-- words, each with its stemmed full-word and prefix tsquery.
create or replace function public.discovery_query_words(p_q text)
returns table (tok text, web tsquery, prefix tsquery)
language sql
immutable
set search_path = ''
as $$
  select s.tok, to_tsquery('english', s.tok), to_tsquery('english', s.tok || ':*')
  from (
    select distinct f.tok
    from (
      select tok
      from regexp_split_to_table(lower(left(coalesce(p_q, ''), 200)), '[^[:alnum:]]+')
           with ordinality as t(tok, n)
      where tok <> ''
      order by n
      limit 8
    ) f
  ) s
  where numnode(to_tsquery('english', s.tok)) > 0
$$;

-- Every adjacent-letter swap of every query word of 4–30 letters, OR-ed as
-- stemmed full words ("entorpy" → … | entropy | …). Null when there is none.
create or replace function public.discovery_transposed_query(p_q text)
returns tsquery
language sql
immutable
set search_path = ''
as $$
  select case when count(*) = 0 then null
              else to_tsquery('english', string_agg(distinct x.v, ' | ')) end
  from (
    select substr(w.tok, 1, i - 1) || substr(w.tok, i + 1, 1) || substr(w.tok, i, 1)
           || substr(w.tok, i + 2) as v
    from public.discovery_query_words(p_q) w
    cross join lateral generate_series(1, length(w.tok) - 1) as i
    where w.tok ~ '^[[:alpha:]]{4,30}$'
      and substr(w.tok, i, 1) <> substr(w.tok, i + 1, 1)
  ) x
$$;

revoke all on function public.discovery_query_words(text) from public, anon, authenticated;
revoke all on function public.discovery_transposed_query(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Courses (0025_loop_r1_2 definition; the text test becomes tiered).
-- ---------------------------------------------------------------------------
create or replace function public.discovery_course_matches(p_q text)
returns table (package_id text, relevance double precision)
language sql
stable
security definer
set search_path = ''
set pg_trgm.word_similarity_threshold = 0.45
as $$
  with q as materialized (
    select v.q, v.q <> '' as has_q,
           case when v.q <> '' then websearch_to_tsquery('english', v.q) end as web,
           public.discovery_prefix_query(v.q) as prefix,
           (select count(*) from public.discovery_query_words(v.q))::integer as n_words,
           case when v.q <> '' then public.discovery_transposed_query(v.q) end as transposed
    from (select left(btrim(coalesce(p_q, '')), 200) as q) v
  ),
  words as materialized (
    select w.tok, w.web, w.prefix from q cross join public.discovery_query_words(q.q) w
  ),
  live as not materialized (
    select c.package_id, c.search_vector, c.search_text
    from public.discovery_courses c
    join public.packages p on p.id = c.package_id
    where p.storage = 'github'
      and p.archived_at is null
      and public.discovery_open_license(p.manifest ->> 'license')
      and coalesce(p.public_repo ->> 'owner', '') <> ''
      and coalesce(p.public_repo ->> 'name', '') <> ''
      and exists (select 1 from public.portal_registrations r
                  where r.package_id = c.package_id and r.owner_id = p.owner_id)
  ),
  tiered as (
    select m.package_id, m.search_vector, m.search_text,
           case when coalesce(m.search_vector @@ q.web, false)
                  or (q.n_words > 0 and m.n_hit = q.n_words)
                  or (q.n_words = 0 and m.phrase_hit) then 1
                when m.phrase_hit or m.n_hit > 0 then 2 end as tier
    from (
      select l.package_id, l.search_vector, l.search_text,
             coalesce(l.search_vector @@ q.web
                      or l.search_vector @@ q.prefix
                      or q.q operator(extensions.<%) l.search_text, false) as phrase_hit,
             h.n_hit
      from live l
      cross join q
      cross join lateral (
        select count(*)::integer as n_hit
        from words t
        where l.search_vector @@ t.web
           or l.search_vector @@ t.prefix
           or t.tok operator(extensions.<%) l.search_text
      ) h
      where q.has_q
    ) m
    cross join q
  ),
  hits as (select * from tiered where tier is not null)
  -- no query: every listed course
  select l.package_id, 1.0::double precision
  from live l cross join q
  where not q.has_q
  union all
  -- the best non-empty tier: all words, else any word
  select h.package_id,
         public.discovery_relevance(h.search_vector, h.search_text, q.web, q.prefix, q.q)
  from hits h cross join q
  where h.tier = (select min(tier) from hits)
  union all
  -- nothing matched: one adjacent-letter transposition per word
  select l.package_id,
         public.discovery_relevance(l.search_vector, l.search_text, q.transposed, q.prefix, q.q)
  from live l cross join q
  where q.has_q
    and q.transposed is not null
    and not exists (select 1 from hits)
    and l.search_vector @@ q.transposed
$$;
revoke all on function public.discovery_course_matches(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Elements (0022 definition; the text test becomes tiered).
-- ---------------------------------------------------------------------------
create or replace function public.discovery_element_matches(p_q text)
returns table (doc_id text, path text, relevance double precision)
language sql
stable
security definer
set search_path = ''
set pg_trgm.word_similarity_threshold = 0.45
as $$
  with q as materialized (
    select v.q, v.q <> '' as has_q,
           case when v.q <> '' then websearch_to_tsquery('english', v.q) end as web,
           public.discovery_prefix_query(v.q) as prefix,
           (select count(*) from public.discovery_query_words(v.q))::integer as n_words,
           case when v.q <> '' then public.discovery_transposed_query(v.q) end as transposed
    from (select left(btrim(coalesce(p_q, '')), 200) as q) v
  ),
  words as materialized (
    select w.tok, w.web, w.prefix from q cross join public.discovery_query_words(q.q) w
  ),
  live as not materialized (
    select e.doc_id, d.path, e.search_vector, e.search_text
    from public.discovery_elements e
    join public.documents d on d.doc_id = e.doc_id
    join public.packages p on p.id = d.package_id
    where d.discoverable
      and not d.tombstoned
      and d.repo = 'public'
      and d.space not in ('private', 'current')
      and p.storage = 'github'
      and p.archived_at is null
  ),
  tiered as (
    select m.doc_id, m.path, m.search_vector, m.search_text,
           case when coalesce(m.search_vector @@ q.web, false)
                  or (q.n_words > 0 and m.n_hit = q.n_words)
                  or (q.n_words = 0 and m.phrase_hit) then 1
                when m.phrase_hit or m.n_hit > 0 then 2 end as tier
    from (
      select l.doc_id, l.path, l.search_vector, l.search_text,
             coalesce(l.search_vector @@ q.web
                      or l.search_vector @@ q.prefix
                      or q.q operator(extensions.<%) l.search_text, false) as phrase_hit,
             h.n_hit
      from live l
      cross join q
      cross join lateral (
        select count(*)::integer as n_hit
        from words t
        where l.search_vector @@ t.web
           or l.search_vector @@ t.prefix
           or t.tok operator(extensions.<%) l.search_text
      ) h
      where q.has_q
    ) m
    cross join q
  ),
  hits as (select * from tiered where tier is not null)
  -- no query: every listed element
  select l.doc_id, l.path, 1.0::double precision
  from live l cross join q
  where not q.has_q
  union all
  -- the best non-empty tier: all words, else any word
  select h.doc_id, h.path,
         public.discovery_relevance(h.search_vector, h.search_text, q.web, q.prefix, q.q)
  from hits h cross join q
  where h.tier = (select min(tier) from hits)
  union all
  -- nothing matched: one adjacent-letter transposition per word
  select l.doc_id, l.path,
         public.discovery_relevance(l.search_vector, l.search_text, q.transposed, q.prefix, q.q)
  from live l cross join q
  where q.has_q
    and q.transposed is not null
    and not exists (select 1 from hits)
    and l.search_vector @@ q.transposed
$$;
revoke all on function public.discovery_element_matches(text) from public, anon, authenticated;
