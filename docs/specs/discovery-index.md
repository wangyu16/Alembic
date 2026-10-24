# Discovery index — projection, search, ranking (Phase 5 Track A)

Status: **A.1–A.4 built** (2026-10-23, branch `phase5/trackA-core`, migration
`0022_trackA_discovery.sql` not yet applied anywhere). Binding inputs:
[goal.md](../goal.md) §6 (portal: search facets, quality "gates prominence,
not censorship", the portal consumes the same standard metadata) and §9
(adaptation entry points); [Roadmap.md](../Roadmap.md) rule 3 (one metadata
source); [document-model.md](document-model.md) §4 (two scopes, per-file
"share this"); [permalinks-and-registration.md](permalinks-and-registration.md)
§2 and §6; [package-contract-v2.md](package-contract-v2.md) §3, §5, §8, §10;
[collections-framework.md](collections-framework.md) §4;
[portal-governance.md](portal-governance.md).

## 1. The projection (A.1)

Two tables, both a **rebuildable projection** — never a second metadata
store. No app code writes them; they are derived in the database by
`discovery_refresh_package(packageId)` from:

| Source | What it gives |
|---|---|
| `portal_registrations` | the Tier-3 **List publicly** consent (a row **written by the package's owner**: `owner_id` = `packages.owner_id`) and when it was given |
| `packages.manifest` (the manifest read cache) | title, description, keywords, discipline, `courseContext` (level and public identity fields), licence, chapters, `adaptedFrom` — exactly `DISCOVERY_MANIFEST_FIELDS` in package-contract. All owner-asserted descriptions of the course; nothing discovery uses to decide *whether* or *where* something is public comes from here |
| `packages` server columns (service role only since 0025, security loop r1 M2) | `storage`, `archived_at`, the publish-recorded repository `public_repo` (listability, repo and site URLs — never `manifest.publicRepo`), and the server's accessibility check record `a11y_status` (never `manifest.accessibility`) |
| `documents` (the registry) | shared files: kind, space, path, description, alt text, tags, per-file licence, lineage (`adapted_from`), content hash |
| `sandbox_files` (public `concepts/course.md`, legacy `metadata/course.md`) | concept-map headings → **topics** |

`discovery_courses` — one row per **listed course**: title, description,
keywords, chapter titles, topics, discipline and level (trimmed,
lower-cased; null when not stated), public course identity
(`courseName`, `level`, `institutionType`, `instructor`, `courseNumber`,
`department`), licence, accessibility status, chapter and element counts,
lineage (adapted from: package id, title, URL, attribution; adaptation
count), site and source URLs, `listed_at`, `updated_at`, completeness, and
the search columns.

`discovery_elements` — one row per **shared element**: kind, space
(artifact type), permalink class, path, display title (description, else
alt text, else file name), description, alt text, tags, licence (the file's,
else the package's), package title, discipline, level, whether its course is
also listed, lineage (adapted from doc, adaptation count), "described"
(has a description or alt text), `listed_at`, `updated_at`, completeness,
and the search columns.

### 1.1 What may be listed (one predicate each)

- **Course:** a `portal_registrations` row whose `owner_id` is the package
  owner (security loop r1, H1: the database refuses a registration for a
  package the caller does not own, and a stray row lists nothing) **and** a published package
  (`storage = 'github'`) **and** not archived **and** an open licence **and**
  a publish-recorded repository (`packages.public_repo`) (`discovery_course_listable`).
- **Element:** `discoverable` ("share this") **and** not tombstoned **and**
  `repo = 'public'` **and** space not `private`/`current` **and** a published,
  non-archived package (`discovery_element_listable`). Per-file consent: it
  does not need the course to be listed (document-model.md §4).

Never: private files, `current` files, trial (unpublished) packages,
archived packages, unlisted courses, unshared files, tombstoned files.

The same predicate is enforced four times: by the projector (rows are
deleted the moment a package stops qualifying), by the **search functions**
(which join the live `packages`/`documents`/`portal_registrations` rows, so
even a stale projection row cannot be returned), by the **public read
policy** (RLS re-checks the predicate per row), and by **CHECK
constraints** (`discovery_elements` cannot hold a `private`-repo,
`private`-space or `current`-space row). The app re-checks returned rows
once more against the contract (`parseCourseRows` / `parseElementRows`,
fail-closed).

### 1.2 Freshness

Triggers re-project the touched package on every change the projection
depends on:

| Change | Trigger |
|---|---|
| list / unlist (incl. an operator deleting the registration row — takedown) | `portal_registrations` |
| any manifest write (course details, rename, accessibility check, chapters, licence), publishing (`storage → github`), archive / restore | `packages` (row) |
| share / unshare, asset metadata, delete (tombstone), rename / move, content saves | `documents` (statement-level: a bulk registry write re-projects each package once) |
| course concept-map save | `sandbox_files`, filtered to the two concept-map paths |
| a fork (`manifest.adaptedFrom`) or an element copy (`adapted_from`) | the **source** package is re-projected (its adaptation count) |

**Best-effort:** every trigger goes through `discovery_refresh_safe`, which
turns a projector error into a `WARNING`; the educator's write always
succeeds, and the next change or a rebuild catches up.

**`updated_at`** is when the listing last changed what it says (an md5
fingerprint of the projected listing fields) or when a public file of the
course was saved (a registry content-hash change outside `private` /
`current`). A new row starts at its listing (or registration) time. This is
the one projected value that is not re-derivable: a rebuild of an emptied
table starts each row at its listing time again. Accepted — it only weakens
the recency signal (§3) until the next change.

**Rebuild:** `select public.discovery_rebuild();` (service role / SQL
editor) deletes every row that no longer qualifies and re-projects every
candidate package. The migration ends with it, so applying `0022`
back-fills the index. Tests prove a rebuild from empty reproduces every
derived column.

### 1.3 Access

- `discovery_courses`, `discovery_elements`: `select` for `anon` and
  `authenticated` through the listability policy; no insert/update/delete
  for either (revoked, and no policy).
- `documents` stays owner-only. The Elements list no longer needs the
  service role (A.4): every Discover read goes through the anonymous client.
- The projector functions are revoked from `anon`/`authenticated`
  (Supabase grants new functions to them by default); `discovery_rebuild` is
  granted to `service_role`.

### 1.4 Forward seams

- **A.5 embeddings (owner decision Q1, later):** add an embedding column of
  the public listing text to each table and fill it from the projector; the
  row identity, predicates and triggers do not change.
- **A.8 format-1 header fields** (title, `uid`, theme) join the element row
  when documents carry them (Track C).
- **Citations** as a ranking signal: no citation data exists yet; the
  ranking (§3) leaves room for it.

## 2. Search (A.2)

All in Postgres (owner decision Q2: `tsvector` + `pg_trgm`, no external
search service; revisit at ~100k elements).

**Entry points** (callable by `anon`; each returns listed rows only):

| Function | Returns |
|---|---|
| `discovery_search_courses(p_q, p_discipline, p_level, p_license, p_a11y, p_after_score, p_after_id, p_as_of, p_limit)` | one page of courses with `score` |
| `discovery_course_facets(p_q, p_discipline, p_level, p_license, p_a11y)` | `(facet, value, n)` rows: `total`, `discipline`, `level`, `license`, `a11y` |
| `discovery_search_elements(p_q, p_kind, p_type, p_license, p_discipline, p_package_id, p_after_score, p_after_id, p_as_of, p_limit)` | one page of elements with `score` (`p_type` = space, the artifact type; `p_package_id` = one course) |
| `discovery_element_facets(p_q, p_kind, p_type, p_license, p_discipline, p_package_id)` | `total`, `kind`, `type`, `license`, `discipline` |

**Direct calls** (security loop r1, L4a). The public anon key can call these
through PostgREST without going through the app, so the app's search limit
does not apply to them. What bounds such a call: its **work**, in SQL (query
text ≤ 200 characters, ≤ 8 prefix tokens, ≤ 51 rows a page, keyset paging,
≤ 50 values per facet); its **time**, the calling role's `statement_timeout`
(anon 3 s, authenticated 8 s — Supabase's defaults, pinned in migration
`0025_loop_r1_4_rpc_timeouts.sql`; a function-level `set statement_timeout`
would not bound a one-statement RPC, because Postgres arms the timeout when
the statement starts); and Supabase's platform limits (API gateway, PostgREST
max-rows, the connection pool). Call **volume** from one client is not bounded
by the database.

**Matching.** A row matches when any of these hold (each GIN-indexed):

1. the weighted `tsvector` matches `websearch_to_tsquery('english', q)` —
   stemmed full words, quoted phrases, `-exclusions`;
2. it matches the **prefix query**: every alphanumeric token of `q` as
   `token:*` (at most 8; user text is never parsed as tsquery syntax), so
   "titr" finds "Titration";
3. `q <% search_text` — pg_trgm word similarity ≥ 0.45 against the title /
   keywords / chapters / topics (courses) or title / tags / file name
   (elements), so "stoichiometery" and "chemstry" still match.

Weights: **A** title; **B** keywords, chapter titles and concept-map topics
(courses) or tags (elements); **C** description, discipline, level, course
identity (courses) or description, alt text, file name, course title,
discipline, kind (elements). An empty `q` matches every listed row.

**Facets** are counted in SQL over the same matches. Each facet is counted
with every *other* filter applied (choosing one discipline still shows the
others' counts); `total` applies all filters. At most 50 values per facet.
The accessibility facet offers only checked results (`pass`, `warn`, `fail`):
"not checked" is not a value to choose, and the app drops `a11y=unknown`
(owner decision 2, 2026-10-24; 0032). A course without a current check shows
no badge.
Filters compare normalised values (trimmed, lower-cased) except licence and
accessibility status, which are closed sets.

**Paging is keyset.** Rows are ordered by `(score desc, id desc)`; the next
page passes the last row's `(score, id)` and gets the rows strictly after
it. Scores are rounded to 6 decimals so they round-trip exactly through the
URL. Recency (§3) is computed against `p_as_of`, which the first page sets to
the current hour and the cursor carries, so a reader paging through results
sees one consistent ranking. There is no `OFFSET` anywhere, and a call
returns at most 51 rows (a page of ≤ 50 plus one to know there is more).
The web client keeps all state in the URL
(`/portal?scope=&q=&discipline=…&after=<cursor>`), so results work without
JavaScript and are linkable; a malformed or tampered cursor is ignored
(first page), never an error (`lib/discovery-search.ts`).

**Scale notes.** Matching and facet counting are index-backed, but ranking
needs every match scored, and a query-less browse matches every row: cost
grows linearly with listed rows. That is fine for thousands of courses and
tens of thousands of elements (and the discover pages are cached, A.6); at
~100k elements, precompute the time-independent part of quality into the
row and order the empty query by it.

**Live re-check.** `discovery_course_matches` / `discovery_element_matches`
join the live `packages`, `portal_registrations` and `documents` rows, so a
projection row left stale by a failed refresh is never served (tested by
changing base rows with the triggers disabled).

## 3. Ranking (A.3)

Relevance first, then quality. Quality signals **gate prominence, never
visibility** (goal.md §6): every match is returned; quality only scales its
relevance within a bounded band, so it reorders near-ties and never buries
or hides a match. One formula, in SQL (`discovery_relevance`,
`discovery_quality`, `discovery_score`) and mirrored in package-contract
(`qualityScore`, `rankScore`, `RANKING`); an agreement test compares the two
over > 1000 input combinations.

### 3.1 Relevance (0 … ~1.5)

```
fts       = max( ts_rank_cd(W, vector, websearch_query, 32),
                 0.8 × ts_rank_cd(W, vector, prefix_query, 32) )     -- 0 … 1
relevance = fts + 0.5 × word_similarity(q, search_text)              -- trigram
W         = {D 0.1, C 0.2, B 0.4, A 1.0}                             -- §2 weights
```

Normalisation 32 maps each rank into 0 … 1 (`rank / (rank + 1)`). With no
query, relevance is 1 for every row (browse = quality order).

### 3.2 Quality (0 … 1)

| Signal | Weight | Value |
|---|---|---|
| accessibility | 0.30 | course: the server-recorded audit (`packages.a11y_status`, written only by the accessibility check — automatic after every save/publish since 2026-10-24, or "Check now") `pass` 1, `warn` 0.5, `fail` 0; **no current check (`unknown`) is neutral**: the term is left out and the other four weights are scaled by 1/0.70 (`discovery_course_quality`, 0032; `courseQualityScore`) — so an unchecked course ranks below an otherwise equal passing one and above an otherwise equal failing one; element: 1 when it has a description or alt text (always known; unchanged) |
| open licence | 0.15 | 1 for an open licence (always true for listed courses; elements may carry their own) |
| completeness | 0.20 | course: share of {description ≥ 15 words, ≥ 3 keywords, level, discipline, concept-map topics or ≥ 2 chapters}; element: share of {description ≥ 3 words, ≥ 1 tag, a licence} |
| recency | 0.20 | `exp(−days since updated_at / 180)` (≈ 0.5 after four months; future dates count as now) |
| adaptations | 0.15 | `min(ln(1 + n) / ln(21), 1)` — distinct **other educators** whose adapting course (fork or element copy) is published and not archived, saturating at 20 (security loop r1 M2: trial packages and the owner's own packages never count) |

**Citations** have no data yet (no citation registry); when they do, they
join as a further signal and the weights are re-balanced to sum to 1.

### 3.3 Score

```
score = round( relevance × (0.75 + 0.5 × quality), 6 )
```

So quality moves a match by at most ×0.75 … ×1.25: a match more than 5/3 as
relevant as another always ranks above it, whatever their qualities. Ties
are broken by id (descending), which also makes keyset paging exact.
Recency is computed against the page's `as_of` hour (§2), so a reader's
pages agree with each other.

**Why multiplicative and bounded.** A lexicographic order (relevance, then
quality) would let quality matter only on exact relevance ties, which
almost never happen with continuous ranks; an additive blend would let a
high-quality course outrank a much better match. A bounded factor keeps
relevance in charge while letting quality decide between comparable
matches — "prominence, not censorship".

## 4. Pages (A.4)

| Route | What it shows |
|---|---|
| `/portal` | Discover: two scopes (courses, elements), a GET search form (text + facet selects with counts), the result count (`role="status"`), results, and keyset paging links ("Next page", "First page"). Works without JavaScript; the only client parts are the description toggle, the report control and the element adapt picker. Each course result links to its course page; "Adapt" goes to the course page's adapt section. An `ItemList` of LRMI `LearningResource` records for the page's courses, and a `rel="alternate"` link to the LRMI feed. |
| `/p/{packageId}` | A listed course: title, licence, subject, level, course identity, chapter count, accessibility, last update; description; **preview** (chapter outline, concept-map topics, keywords, up to 12 shared elements); **how to cite** (`formatCourseCitation`: author = stated instructor, else the publisher; year of the last update; the course page URL; licence); licence deed; **lineage** (adapted from — linked when that course is listed — and the listed courses adapted from it); **Adapt** with the course preselected: pick one of its chapters and one of your own chapters; the sections are copied with attribution (`adaptFromPortalAction`, which re-checks that the source is listed *now*, its licence allows it, and the target chapter is yours). JSON-LD `LearningResource` with `isBasedOn` for lineage. |
| `/portal/element/{docId}` | A shared element: kind, type, course (linked when listed), tags; **preview** (images inline from the permalink; otherwise the description); the permalink; how to cite (`formatElementCitation`); licence; lineage (adapted from, reuse count); "Use it in your course" (objects only) with the element preselected (`adaptElementAction`). |

Unlisted, private, trial and archived content is a plain 404 on every page
(the index's read policy), never "this course is private".

**Caching** (`lib/discovery-cache.ts`; the A.6 "cached discover pages"
item): every Discover read uses the cookie-less anonymous client, so results
are the same for everyone and are kept in Next's data cache under the
`discovery` tag for at most 120 s (search entries are keyed by the query and
the ranking hour). Listability is re-checked against the live tables (the
read policy) only when a read actually runs, i.e. on a cache miss; a cached
answer is served unchanged until it expires. **Staleness bound: 120 s** — a
cached answer can show content for up to 120 s after it was unlisted,
archived, unshared or taken down, unless the cache was invalidated. Owner
actions that change what Discover may show (list / unlist, archive /
restore, share / unshare and asset metadata, a shared file leaving the
registry, rename, course details, concept map, accessibility check) call
`updateTag("discovery")`, which drops every cached answer at once (claim
P5.S.8, enforced by a source scan of every listability write). Changes made
outside the app — an operator delete or takedown in the database dashboard,
a reconciled outside edit — are bounded by the 120 s window only. A search
that cannot run is not cached.

**Rate limit and events** (A.6/A.7 seams): a search (text, filters or a later
page) is limited per address (`checkRateLimit("search")`); the landing view
is not. Each results page records `portal.searched` (shape only: scope,
query length and term count, filter names, result count, page number); a
course page records `course.viewed`, and following "Adapt" from Discover
(`?adapt=1`) records `adaptation.started` with `mode: "entry"`.

**Harvest:** `listListedCourses` (feed and sitemaps) reads `discovery_courses`;
`COURSE_PAGES_LIVE` is on, so feed records carry `@id` = the course page and
`dateModified`, and the sitemaps list course pages with their last update.

**Course details** gained **Subject** and **Level** (free text with
suggestions — `DISCIPLINE_SUGGESTIONS`, `LEVEL_SUGGESTIONS`), so the
discipline and level facets are filled by the educator instead of resting on
the manifest default ("chemistry") and an empty level.
