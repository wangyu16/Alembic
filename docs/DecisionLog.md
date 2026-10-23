# Decision Log

Dated record of concrete decisions — what was chosen, what is permanent by
design, and what is deferred to the future. Complements [Status.md](Status.md)
("what is done") with the "why" and the forward plan. Newest entry first.

---

## 2026-10-23 — Security loop r1: `/d` takedown bound and view de-duplication (M3, L4b)

| # | Decision | Why |
|---|---|---|
| 1 | **No shared cache keeps any `/d` answer longer than 300 s** (`TAKEDOWN_BOUND_SECONDS`, stale windows included). Pinned `@{hash}` answers: `private, max-age=31536000, immutable` for the browser, `CDN-Cache-Control` / `Vercel-CDN-Cache-Control: public, max-age=300` for the CDN. Live answers: `s-maxage=240, stale-while-revalidate=60` (was 300 + one day). Tombstones: `s-maxage=300` (browser keeps an hour). Supersedes the "pinned immutable" and "one-day stale-while-revalidate" parts of the Track A.6 entry below. | The audit (M3) showed a pinned answer of a file later removed, made private or taken back to trial would keep being served by the CDN for a year. The browser's own copy is acceptable (the reader already saw that version); a shared copy is not. CDN headers make the CDN lifetime explicit; a cache that ignores them sees `private` and keeps nothing, so the failure mode is "not cached", never "cached too long". The cost is more origin revalidations, which the ETag/304 path and the bytes cache keep cheap. |
| 2 | **`element.viewed` is written at most once per (doc, client address, clock hour)**, counted with `rate_limit_hit` (0023) under the key `view:` + HMAC(doc, address), with the bounded in-process counter as fallback; any other counter failure records nothing. The `/d` answer ignores the query string; busted URLs (`?x=n`) are not redirected. | The audit (L4b) showed `?x=n` makes every request an origin answer and so a research event. A view per hour per address is what research needs; counters are pruned after two days, events are kept. Losing a view event is acceptable, unbounded writes are not. HMAC over the doc and the address together keeps both out of the counter table and unlinkable across docs. A redirect to the bare URL would also protect the CDN but changes the answer for links that already carry a query; the origin path for a busted URL is cheap (rate limited, bytes from the cache, no event). |

---

## 2026-10-23 — Security loop r1: the 32-bit pin hash is accepted until R3 (not fixed now)

**Decision.** The audit showed a second preimage for the 32-bit FNV-1a source
hash that `/d/{doc}@{hash}` pins on is cheap to compute
(`/tmp/alembic-audit/fnv.mts`: different bytes, same pin). It is **not changed
in this round**: changing the hash changes every pin already cited, and the
move to a cryptographic hash is planned with R3. Until then a pin proves
"the bytes the server holds now hash to this", not "these are the cited bytes".
Recorded as claim P5.S.L2, deliberately red. **Owner decision pending.**

---

## 2026-10-23 — Security loop r1: consent and trust columns belong to the owner and the server (H1, M2)

| # | Decision | Why |
|---|---|---|
| 1 | A `portal_registrations` row counts as the "List publicly" consent only when its `owner_id` is the package owner; the API roles can write one only for a package they own, and cannot read `owner_id` at all (column grants; it defaults to `auth.uid()`). The same rule — a row that names a package needs its owner — now covers suggestions (sender owns `from_package_id`; the inbox follows the package owner), `package_changes` and `ai_invocations`. | Any signed-in user could list someone else's course under their own snapshot, keep it listed against the owner's will, and read the owner's suggestion inbox. |
| 2 | `storage`, `archived_at`, `public_repo`, `private_repo`, `default_branch` and the accessibility record are **service-role-only columns**, written through one module (`lib/package-trust-writes.ts`) that always filters on the signed-in owner. Publishing, archiving and restoring therefore require `SUPABASE_SECRET_KEY`. | Column privileges are what Postgres has for "this row is yours but this column is not" (the 0016 pattern); a server-gated RPC callable by the owner would have been the same hole. |
| 3 | Discovery and Adapt use the **publish-recorded repository**, never `manifest.publicRepo`. | The manifest is the owner's text (it can also arrive by a direct GitHub commit); the repo the GitHub App created under the educator's installation is a fact. |
| 4 | The accessibility status Discover shows and ranks is the **server's record of its own check run**, with **no back-fill** from manifests: listed courses read "not checked" until the owner re-runs the check. | A back-fill would carry any forged "pass" forward. Residual: the check reads the course's `sandbox_files` mirror, which the owner can still write; the record proves the server ran the check on what it held then. |
| 5 | Adaptations count **distinct other educators whose adapting course is published and not archived**. | Trial "sock" packages cost nothing; a published course needs a GitHub account and the publish path. |

---

## 2026-10-23 — Security loop r1 M1: research events are allow-listed per type and written by the server only

**Decision.** `research_events.detail` is no longer free-form. A per-event-type
allowlist (`packages/research-events/src/allowlist.ts`, a `Record` over the
event enum so a new type cannot be forgotten) names every key a caller may
log and the shape its value must have: a count, a boolean, a closed
vocabulary, a short lower-case token (kinds, modes, surfaces, licences), or a
package/doc id. Anything else — an unknown type, an unknown key, a value of
the wrong shape — is dropped (fail closed). It runs twice: at **export**
(`deidentifyEvents`; kept ids are pseudonymised with the same salted function
as the package column, so a `sourcePackageId` joins to `package`), which also
cleans rows stored before the allowlist; and at **write** time, so the store
never holds identifying text (ids stay raw there, like the `package_id`
column). Dropped on purpose: `siteUrl` (carries the GitHub login),
`publicRepo`/`privateRepo`, `publish.failed`/`agent.run.failed` raw error text,
file `path`s, import `filename`, snapshot `tag` (from an educator-typed name),
`fromCommit`, `sourceHash`, `chapter` slug, `changeId`, `targetBlockId`,
`attestedAt`. A future key must be added to the allowlist or it is silently
not recorded — the safe default.

**Server-only writes.** Any signed-in user could insert arbitrary events for
themselves ("insert own events", audit L4c). All inserts now go through one
server-side writer (`apps/web/src/lib/events.ts`) using the service client;
`supabaseEventLogger(session)` keeps its call-site signature but ignores the
session, trusting the `userId` the server action took from `auth.getUser()`.
Every failure (no service key, refused insert, throw) is swallowed — logging
never breaks a workflow. Migration 0025 drops the policy and revokes insert
from `anon`/`authenticated`. **Deploy the code first, then 0025**: before the
migration, client inserts keep working; applied first, it would silently drop
signed-in users' events until the code shipped. Trade-off: the service role
bypasses 0018's `is_active_user()` backstop on this table; acceptable because
a banned user has no session and middleware refuses their `/workspace/*`
server actions (user-governance.md §2.1), so no event is produced.

---

## 2026-10-23 — Owner rulings on Phase 5 open items

| # | Decision | Why |
|---|---|---|
| 1 | **CLAUDE.md corrected**: Studio is removed (2026-07-04, replaced by `/guide`); the one validated write path is `writeThrough` (files) and `updateManifest` (the manifest). | The file described a seam with no callers and a removal that already happened. |
| 2 | **"Share this" is not offered in a trial course** (it returns once the course is published). | A trial course's shared file is owner-only until publishing (Track 0.2), so the button promised what it could not do. |
| 3 | **A course repo's first reconcile records the current state as its baseline and absorbs no earlier commits** (kept; documented). | Commits before Alembic first saw the repo were made before it managed the course; absorbing them blindly could pull unreviewed content. A full absorb stays possible through re-import. |
| 4 | **Discover searches on Search/Enter, not instantly as you type.** | Server search is what lets results scale and work without JavaScript; instant filtering only worked because every listing was loaded into the browser. |

---

## 2026-10-23 — Discover pages: one cached anonymous read, URL state, adapt with the source preselected (Phase 5 Track A.4)

| # | Decision | Why |
|---|---|---|
| 1 | Every Discover read (search, facets, course and element pages) goes through the **cookie-less anonymous client** and is cached in Next's data cache under one tag, `discovery`, for ≤ 120 s; educator actions that change a listing call `updateTag("discovery")`. The visitor's session is read only for the adapt pickers. | Answers are identical for everyone, so they can be shared; the anonymous client also proves that nothing on these pages needs more than the public read policy. Tag invalidation gives the educator read-your-own-writes; the short window bounds everything else (operator takedowns, reconciled edits) — and stale *unlisted* content is still never served, because the search re-checks listability live. |
| 2 | **All portal state in the URL**, plain GET form and links; keyset cursor (opaque, validated, ignored if tampered). No client-side filtering. | Works without JavaScript, is linkable and shareable, and scales: the old page loaded every listing into the browser. |
| 3 | Course **Adapt** on `/p/{packageId}`: the course is the preselected source; the educator picks one of its chapters and one of their own chapters; the existing `adaptFromPortalAction` copies the sections (now also checking the source is listed *now* and the target chapter is theirs). | It was a link to `/workspace` that preselected nothing. Chapter-to-chapter is what the block-level adaptation primitive does today; a cross-owner whole-course fork is a separate feature (open item). |
| 4 | Element detail at **`/portal/element/{docId}`**, not a new top-level form. | `/d/{docId}` is the file itself and must stay the permalink (permalinks §2); the detail page is a Discover page about it. |
| 5 | **Subject and Level** become editable in Course details (free text + suggestions). | The discipline facet otherwise shows the manifest default for everyone and the level facet is empty; free text keeps old manifests valid (no schema change), and facets compare lower-cased. |
| 6 | `lib/shared-elements.ts` (Track 0.3) and the client `PortalBrowser` are **removed**, not kept beside the index. | Two ways to list elements would be a second index (Roadmap rule 3). Track 0's leak cases live on as SQL tests against the index and the search. |

---

## 2026-10-23 — Discover ranking: relevance × bounded quality; keyset pages pinned to an hour (Phase 5 Track A.2–A.3)

**Decision.** `score = relevance × (0.75 + 0.5 × quality)`, rounded to 6
decimals, ties broken by id; quality = accessibility 0.30 + open licence 0.15
+ completeness 0.20 + recency 0.20 + adaptations 0.15. Paging is keyset on
`(score, id)`; recency is computed against the hour of the first page, which
the cursor carries. Typo tolerance uses pg_trgm word similarity ≥ 0.45.

**Why.** "Quality gates prominence, not censorship" (goal.md §6) rules out
filtering on quality and argues against letting it override relevance; a
bounded factor lets it decide only between comparable matches. Keyset paging
needs a stable sort key: a recency term computed against the clock would
shift scores between page requests (duplicates or gaps at page edges), so
the time base is fixed per browsing session instead. Rounding makes the score
an exact URL value. 0.45 (below pg_trgm's 0.6 default) is where one-letter
slips in course words ("chemstry", 0.58) still match.

---

## 2026-10-23 — Discovery index: derived in the database, kept fresh by triggers (Phase 5 Track A.1)

**Decision.** The discovery index (`discovery_courses`, `discovery_elements`)
is derived **in SQL** by `discovery_refresh_package`, called from triggers on
the tables it reads (`portal_registrations`, `packages`, `documents`, the
concept-map rows of `sandbox_files`), each wrapped so an error is only a
warning. The app writes nothing to it. The listing consent stays in
`portal_registrations` (its snapshot columns are no longer read for
discovery; they are kept, additive-only). Spec:
[discovery-index.md](specs/discovery-index.md).

**Why.** Refresh points in app code would have to be added at every place
that writes a manifest, the registry or a listing — about fifteen today,
plus operator takedowns in the dashboard, which no app hook sees; one missed
call site is a stale or leaking listing. Triggers see every write path,
present and future. Deriving in SQL also lets the migration back-fill the
index and lets an operator rebuild it with one statement, with no service
key in the loop. The cost — the SQL reads manifest fields the contract owns —
is held by `DISCOVERY_MANIFEST_FIELDS` and agreement tests that fail if the
two drift.

**Also decided.** Elements are listed on per-file consent alone (no course
listing needed, document-model.md §4); a listed element of an unlisted
course simply has no course page. Adaptation counts include trial and
private adaptations (only the number is shown). `updated_at` survives
re-projection but not a rebuild of an emptied table (it then restarts at the
listing time) — acceptable for a ranking signal. Tests run against PGlite (a
new web devDependency) because no local Supabase/Postgres exists on the
build machines; it proves behaviour, not production performance.

---

## 2026-10-23 — Hardening: paged research export; reports only through a capped database function (Phase 5)

| # | Decision | Why |
|---|---|---|
| 1 | **`/admin/export` walks `research_events` by keyset `(occurred_at, id)` in batches of 1000 and streams the de-identified output**, byte-identical to the former one-shot CSV/JSON. Only an empty page ends the walk; a non-advancing page is refused; the first page is read before the response is built, and a later failure errors the stream. | One query held the whole store in memory, and PostgREST's `max-rows` (1000 on Supabase) silently truncated the file. A short page cannot end the walk because the server's row cap may be below the batch size. A failed download is visible; a truncated one is not. Keeping the bytes identical keeps the evaluators' tooling unchanged. |
| 2 | **Reports are filed only through `file_portal_report()` (security definer, service role only); the direct anon/authenticated insert is revoked** (migration 0024). Not an insert trigger. | The anon key is public, so any cap a browser can reach must sit in the database; but a per-address limit cannot be applied there (Postgres does not see the client address reliably). Routing every insert through the server keeps the per-address limit binding and lets the database add the caps it can apply. A trigger would keep the direct path open and would have to guess the caller. Anonymous reporting (governance) is unchanged: the server files it. |
| 3 | **Caps: per package 10 / hour and 30 / day; overall 60 / hour and 300 / day**, counted with `rate_limit_hit` (0023); global first, so fresh made-up package ids cannot dodge it. | Reports are rare and human; these numbers are far above real use but bound the table against a client rotating addresses. The price is that a flood can pause reporting until the window rolls over — preferred to unbounded growth of an operator-reviewed queue. |
| 4 | **The app falls back to the old session insert only when the function is missing** (`PGRST202`/`42883`). Deploy order: code, then 0024. | The code works against a database with or without 0024, and no other error can route around the caps. Older code against 0024 cannot file reports, hence the order. |
| 5 | **No "is the package listed" check in the function** (deferred). | The listing source is moving to the discovery projection (Track A core, parallel); the global cap already bounds reports against made-up ids. Revisit when the projection lands. |

---

## 2026-10-23 — `/d` caching by source hash; pins stay on the 32-bit hash for now; rate limits; discovery events (Phase 5 Track A.6–A.7)

| # | Decision | Why |
|---|---|---|
| 1 | **Public `/d` answers are keyed by the registry's `source_hash`:** weak ETag, 304 on `If-None-Match` without reading GitHub, pinned `@{hash}` immutable, live answers CDN-cached 5 min with a one-day stale-while-revalidate. Bytes are cached per `(docId, hash)` in process and in Next's data cache (≤ 1 MB). | Owner Q4: keep serving from Alembic with a strong cache. A new version is a new key, so nothing needs purging; the CDN absorbs repeat views and the origin answers revalidations from the registry alone. Next's data cache is part of the hosting plan — no new service. |
| 2 | **Only bytes that hash to the registry's hash are cached or labelled** (recomputed with `computeSourceHash`; for binaries both registration forms, UTF-8 and base64, are accepted). Otherwise the old behaviour: served, `max-age=60`, no ETag. | The bytes come from the repo head, the hash from the registry; after a direct GitHub commit and before reconcile they disagree. Without the check, `@{old-hash}` could be cached `immutable` with the new bytes. Degrading (rather than refusing) keeps upload-rewritten pinned figure links working. |
| 3 | **Owner-only answers bypass all of it** (`private, no-store`, no ETag, no 304, no CORS, no server cache), and the access check runs before any validator is compared. | A 304 or an ETag for a file the visitor cannot read would confirm that it exists. Pinned by `permalink-response.adversarial.test.ts`. |
| 4 | **Pins stay on the 32-bit FNV `source_hash` for now** (Track B's open item *c*). | The hash is also the registry's identity key (uid → hash → location) and the value already written into educators' documents by the upload rewrite; changing it means re-hashing every row, keeping old pins resolvable, and touching the identity order — work that belongs with the version store (R3), which is what makes older pins servable at all. Today a pin only ever serves the CURRENT version (older pins get the interim page), the hash is compared per docId (not globally), and decision 2 stops a mismatched pin from being cached. A collision is only producible by the file's own owner. **Revisit with R3:** a 64-bit-or-stronger content hash for new pins, old 8-hex pins resolved through the version store. |
| 5 | **Rate limits:** reports 5 / 10 min and 20 / day per client address, counted in Postgres (`rate_limit_hit`, migration 0023) with an in-process fallback; `/d` 1200 / min and search 120 / min in process. Keys are an HMAC of (bucket, address); no address is stored. | Reports are rare and abusable anonymously, so they get the shared counter. `/d` is mostly answered by the CDN and is per-view hot path, so a database round trip per view is not worth it — the in-process limit only stops a scraper hammering one instance. A classroom behind one NAT stays well under 1200 / min. |
| 6 | **Discovery events** (`portal.searched`, `course.viewed`, `element.viewed`, `adaptation.started`, `element.shared/unshared`, `portal.unregistered`, `portal.reported`) are built in one place (`lib/discovery-events.ts`) and recorded after the response (`after()`). Anonymous visitors' events have **no participant** (`user_id` null) and are written by the service client; signed-in visitors' through their session. | Research needs the discovery funnel, but visitors are not consenting participants: no query text, no filter values, no docIds/paths, no IP. View events are recorded per DOCUMENT served by the origin (not per embedded figure, and not CDN hits) — they measure origin answers, not readers. `createEventLogger.log` no longer throws on an invalid event (it used to, before its try). |
| 7 | **Harvest without the portal:** `/feed/courses.jsonld` (schema.org `DataFeed` of the same LRMI `LearningResource` records the pages embed, 100 per page, HTTP `Link` paging), `/sitemap.xml` (index) and `/robots.txt`. One data function, `listListedCourses`, reads `portal_registrations` today and moves to the discovery projection with A.1. Course pages enter the sitemap only when `/p/{packageId}` exists (`COURSE_PAGES_LIVE`). | goal.md §6. A sitemap may only list URLs on its own host, so until A.4 the course records travel in the feed (pointing at each course's Pages site), not the sitemap. |

---

## 2026-10-23 — Permalink helpers emit `/d/`; upload links resolve in rounds (Phase 5 Track B.3)

**Decision.** `livePermalink`/`pinnedPermalink` take a **docId**, never a path,
and emit `/d/{docId}[@{version}]`. The whole-package upload no longer writes a
raw GitHub URL for a `../` link it could not otherwise resolve: it commits the
documents whose links resolve, registers them, and retries the rest in rounds.
Documents that link only to each other (a cycle) or to nothing that exists are
reported as broken links — the staged upload is kept, so the educator can fix
and resume.

**Why.** A raw URL is path-coupled, served `text/plain` + `nosniff`, and cannot
serve private files (permalinks §7) — and it was being committed into the
educator's own sources, where it outlives any later fix. A cycle gets reported
rather than papered over because no permalink can exist before a commit, and
committing first would mean committing a link the guard rejects.

---

## 2026-10-23 — Publish robustness: what is retried, and what is never replayed (Phase 5 Track B.2)

| # | Decision | Why |
|---|---|---|
| 1 | **Rate-limit refusals are always retried; 5xx and dropped connections only for idempotent requests** (GET, PATCH of a ref to a fixed sha, POST of blobs/trees/commits). Repo creation, ref/tag creation and Pages setup are not replayed on 5xx. | A rate-limited request was not processed; a 5xx one may have been. Replaying a content-addressed object creation is harmless (same object, or an unreferenced commit); replaying "create" is not. |
| 2 | **Honor GitHub's named wait up to 60 s; beyond that, fail at once** with educator wording ("busy right now… try again in a few minutes"). Backoff 1 s → 2 s → 4 s, three retries. | Publishing runs inside a 300 s function; waiting out an hour-long primary reset would only turn into a timeout with no message. |
| 3 | **Same tree → no commit**, for both the Pages build and ordinary saves. | The Pages branch is a single root commit per build; republishing an unchanged course used to add a commit and re-deploy Pages for nothing. Content-addressed trees make the check exact and free. |
| 4 | **Installation tokens come from a refreshing source** (mint ahead of expiry; one retry after 401). | Tokens last an hour and are minted per action today, so expiry mid-publish is unlikely — but a cached or long-lived client must never fail on it, and a 401 is a safe retry. |
| 5 | **Failure copy states that the live site is unchanged** — true because the branch moves in one ref update at the very end. | It is the question an educator asks first; raw GitHub text stays in the server log (scale audit item 9). |

**Not done here (open):** bounded parallelism of the per-chapter generation loop (scale audit queued item 2)
— the loop is unchanged; the site build moves to orz-site in B.4.

---

## 2026-10-23 — Registry: register the change set, not the package (Phase 5 Track B.1)

**Context.** The scale audit (2026-08-28, queued item 1) found every write
re-registering the whole package: a whole-content read plus two or three
round-trips per file — 668 on the 333-file course even when nothing else
changed.

| # | Decision | Why |
|---|---|---|
| 1 | **Writes register only their change set** (`registerChangedFiles`). Every write path already holds it; deletions travel as `content: null`. | The registry is a projection of what the write just did; re-deriving the other 332 files proved nothing. |
| 2 | **One identity resolver for both paths**, in memory against one read of the live rows, including the rows staged earlier in the same run. Order unchanged: embedded uid → content hash → location → new. | The audit named the ladder "highest-risk": order-sensitive and dependent on in-run staging. One resolver means incremental and rebuild cannot disagree (a test asserts they agree). |
| 3 | **Duplicate-content tiebreaker, as contract v2 §2 specified**: a cross-path hash match is a *move* only when its old location is gone and nothing is registered here; an exact location match wins over a cross-path hash match. | The spec claimed the rebuild did this; it did not, so byte-identical files stole one docId and flapped. |
| 4 | **An embedded uid displaces (tombstones) a different identity at its location.** | One location holds one live identity (the DB's partial unique index says so); before, this case hit the index and the file silently stayed unregistered. |
| 5 | **Full rebuilds stay for populate and large reconciles; their read stays full.** Only changed rows are written, in bulk; a refused bulk write falls back to per-row writes. | Hashes and uids come from bytes (audit, "confirmed correct"); the round-trips were the bug. |
| 6 | **Tombstones are not pruned; they are kept out of the hot path** (`listLiveByPackage`, served by the existing partial location index). | A pruned tombstone would turn a 410 "no longer available, with provenance" into a 404 — the permalink promise. Live-only reads cost the same whatever the churn. |
| 7 | **Indexes: add `(package_id, source_hash)` live-only (`0021`); not `adapted_from`.** | Add an index with the query that uses it; no query filters on lineage yet (Track A will). |

---

## 2026-10-23 — Renderer on orz-markdown 2.4: no server file access; themes generated, not hand-vendored

**Context.** Phase 5 Track 0.1 (STATUS D-39 in the family docs): with orz-markdown
≤ 1.6, `md.render(src)` without an env read any local file named by a
`{{md path}}` directive. Alembic renders educator content server-side.

| # | Decision | Why |
|---|---|---|
| 1 | **One render function, no file access.** Every `@alembic/renderer` render goes through `renderMarkdown` with a fresh, empty env; no file-access key (`markdownBasePath`, `readFile`, `markdownIncludeRoot`) is ever set server-side. | Educator content is untrusted input to the server. Kit 2.x already defaults to no file includes; a single choke point keeps a later caller from opting in by accident, and the adversarial test pins it. Alembic has no use for server-side file includes — cross-file reuse is by permalink (`{{md-include https://…/d/{docId}}}`), resolved by `prepareSources` with an allowlist. |
| 2 | **Theme CSS stays inlined, but is generated from the kit** (`scripts/vendor-themes.mjs` → `theme-css.ts`, checked by `theme-css.test.ts`) rather than read from `orz-markdown/themes/*.css` at runtime. | The renderer runs in Vercel serverless functions; reading package files from disk there depends on output file tracing, while a generated string has no such risk. The kit's `orz-markdown/themes` export is theme *metadata* (`THEMES`), not CSS. The drift test turns "vendored" into "the kit's own bytes". |
| 3 | **The worker's kit 1.6 gets a process-wide include guard** (`packages/generators/src/no-file-includes.ts`) instead of a version bump. | The 0.x carriers depend on kit 1.x and are only replaced by the 1.x port (Track C.1). Their build entry points render in the browser, so the guard is defence in depth; it uses the kit's own public `register` and is deleted with kit 1.x. |
| 4 | **The template repo's standalone build is committed and kept working** (kit 2.4, includes confined to the repo, `practice/` read) — not retired here. | Retiring it or replacing it with `orz-site init --github` is Track B.6 (after the release wave). Until then the docs that point at it should point at something real and safe. |

---

## 2026-08-28 — Storage & write-path implementation: four rulings made during execution

**Context.** Implementing [specs/storage-and-write-paths.md](specs/storage-and-write-paths.md)
(Waves H→3, [StorageWritePathTasks.md](StorageWritePathTasks.md)) forced four
decisions that the spec had left as direction rather than ruling. All four are
now shipped behavior, recorded here so they aren't re-litigated.

| # | Decision | Why |
|---|---|---|
| 1 | **A published package that cannot reach GitHub REFUSES the write** — with an educator-facing reason and "Nothing was changed" — instead of writing to the projection and skipping the commit. One place decides: `committerFor` resolves `trial` \| `github` \| `unavailable`, and an *unknown* package resolves `unavailable`, never `trial`. | "Save records a permanent version" is the version contract's promise; a save that didn't reach permanence didn't happen. The old `if (!gh) return;` accumulated invisible local-only work that reappeared as data loss later. Cost accepted: a disconnected educator is **blocked rather than silently diverging** — the trade is loud-and-recoverable over quiet-and-wrong. A pending-outbox would soften it and is the recorded future refinement; fail-loudly ships first because it never lies. Trial packages are unaffected. |
| 2 | **Slots, not placeholders — as shipped behavior, not a target.** A new package is **two files** (`alembic.json`, `LICENSE`) with an explicit first chapter declared in the manifest and no file; `createChapter` writes no file at all; the first-open scaffolds (slides template, practice starter, concept-map pre-fill) are gone. The former template prose became **click-to-insert** empty-state guidance in the UI. | A file must exist iff real content exists, or "does this course have content?" has no honest answer — which is what poisoned the old upload gate and put boilerplate on published sites. Two consequences accepted deliberately: the manifest must declare that first chapter explicitly (the implicit-chapter fallback would otherwise show a phantom chapter pointing at a file that does not exist — legacy packages only now), and **a freshly created package no longer passes the release gates**, which is correct under "empty slots never publish". `SEED_CONTENT_PATHS` survives as *legacy recognition* for packages created before this rule, not as a creation path. |
| 3 | **A declared chapter with no study guide is a WARNING, not an error**, and `ValidationIssue` gained an optional **`severity: "error" \| "warning"`** (absent = error, for backward compatibility) so importers and UIs can tell a blocker from an advisory. | Under decision 2 the old rule made empty chapters impossible — chapters are now *created* without a file, so the platform's own creation path would have produced packages its own validator rejected. Incremental assembly (an author, or coursewerk, building a course chapter by chapter) is a legitimate state, and an import must not refuse it. The absence is still reported, because an author who *meant* to include that content wants to know. |
| 4 | **The pristine gate is replaced by a plan-diff confirmation.** Whole-course upload no longer asks "is this package untouched?"; it plans the upload against **repo head + registry**, shows the educator what would be added, overwritten, left unchanged and cleared, and takes an explicit confirmation — with an explicit "empty this course and upload" path (Tier-3) for genuine conflicts. `isPristinePackage` remains as the plain predicate its name asks, but **must not gate an upload**. | The old gate was filename-magic over a silently truncated file list: touching *anything* first (adding a chapter, opening a document) made a package non-pristine, so every interrupted upload became a permanent dead end — "This course already has content" — with no statement of which files. Repos-first populate is idempotent and resumable, which makes replanning the natural gate: a retry replans against what is actually there and writes only the remainder. |

**Also settled in passing:** the zip bypasses the Vercel function body entirely
(signed URL → private `staging` bucket, migration `0020`), so the ~4.5 MB body
cap is out of the path and the limit is a stated **50 MB product limit**;
`mirrorManifestToSandbox` and the `syncFilesToGitHub` helpers survive only on
the deliberately exempt publish/graduation truth-flip.

**Open (not decided here).** Coursewerk's `check_oer.mjs` still **errors** where
Alembic now warns (decision 3), so the two are out of step on exactly that rule.
Defensible as-is — coursewerk is a *producer* and may hold itself to stricter
completeness than the platform accepts — but it is a product call for the owner,
not a mechanical sync, and it is a separate repository. Tracked in
[StorageWritePathTasks.md](StorageWritePathTasks.md) ("Cross-repo follow-up").

---

## 2026-08-28 — AI gateway: self-hosted LiteLLM on the owner's Oracle VPS (Portkey superseded)

**Decision.** The gateway control plane is **self-hosted LiteLLM**, deployed on the owner's Oracle Cloud
Always-Free A1 VPS first (may move to an always-on Fly machine later — a config-only `AI_GATEWAY_URL`
swap; `GatewayProvider` is OpenAI-compatible, so no code changes either way). Talking **directly to
providers** (no middleman fees); optionally OpenRouter behind it for long-tail models.

**Why.** The requirement is a *control plane*, not a marketplace: per-job **virtual keys with hard
budgets** (load-bearing under the platform-key model), per-user attribution, and full data-flow custody
(the FERPA/IRB argument that originally motivated Portkey). LiteLLM meets all of it at $0 license cost.
**Portkey (chosen 2026-06-16) is superseded:** acquired by Palo Alto Networks (2026-05) and folded into
the Prisma AIRS enterprise security platform — no longer a fit for a free, solo-operated platform.

**Operating rules (recorded in [specs/worker-tier.md](specs/worker-tier.md) §1.5):** Oracle tenancy
upgraded to PAYG (removes Always-Free idle reclamation); Cloudflare proxy/tunnel in front; LiteLLM state
in Supabase Postgres; deployment-as-code so a dead instance is a ~10-minute redeploy anywhere;
direct-provider fallback in the web app as the degraded mode; provider keys live only on the gateway
host. Capacity note: a LiteLLM proxy is I/O-bound — the A1 shape (4 OCPU/24 GB) is far beyond any
plausible load; the risks are account/instance lifecycle, hence the rules above.

---

## 2026-08-28 — Worker tier: agent lane on Fly, platform-key model, no BYO

**Decision.** Recorded in full in [specs/worker-tier.md](specs/worker-tier.md). Summary:

| # | Decision | Why |
|---|---|---|
| 1 | **Platform provides the AI key; the BYO-key promise is removed** (goal.md §11 amended; 2026-07-12 "BYO-key / sponsored / paid credits" messaging superseded to sponsored/paid credits only). | Kills key-vault UX and "subscription ≠ API key" confusion; the platform controls model choice, routing, logging, and cost attribution uniformly. Consequence accepted: metering + **hard per-run budget caps become required-before-launch** — every runaway loop is now the operator's bill. |
| 2 | **Tier split confirmed:** local single-file editing = direct LLM calls with designed system prompts (no agent SDK); package-level work = coursewerk as an agent in the worker tier. Registry gains `execution: "call" \| "agent"`. | The 90% case stays cheap and serverless; the harness is reserved for genuinely multi-file, repo-aware work (ai-architecture.md's Tier A/B, now firm). |
| 3 | **Agent lane = Fly (Sprites or Machines — spike pending) running the identical harness local coursewerk uses**; non-AI jobs stay on the existing Fly worker; queue in Postgres. | Parity (local run ≡ hosted run, one coursewerk codebase), one already-operated vendor, persistent-sleeps-idle sandboxes match coursewerk's ⏸-gated staged pipeline, compute cost is noise vs tokens. |
| 4 | **Sandbox never holds the master key:** per-job short-lived gateway virtual key with a hard budget; egress allow-listed. | Exfiltration impossible by construction; the per-run cap is enforced outside the agent. |
| 5 | **Job outputs are files/changesets, never commits** — validation (import gate, leakage, near-verbatim) → tiered review → `packageOps` → `github-bridge`. | goal.md §3 verbatim; the agent produces, the platform commits. |
| 6 | **Watch list, not churn:** Anthropic Managed Agents re-evaluated at GA or ~2 quarters. Owner posture: no switching within ~a month of adoption; the area changes fast, so no choice here is forever — switch when the benefit is significant. The harness seam keeps any switch a swap, not a rework. | Managed Agents is the only option deleting harness ops entirely (hard per-session dollar caps fit the platform-pays model) but is beta and would fork coursewerk off the local CLI harness. |

**Open (under evaluation, tracked in the spec §3):** harness selection (Claude
Code / Agent SDK vs minimal pi-class harnesses vs others), the cost-efficient
model mix (flash-class drafting + different-family mid-tier critique),
Sprites-vs-Machines spike. *(The gateway question was resolved the same day —
see the entry above.)*

**Ruled out (dated):** GitHub Actions as job runner (key exfiltration —
permanent); Cloudflare Sandbox (disk resets on sleep); Modal (premium,
GPU-oriented); E2B/Daytona/Vercel Sandbox (capable, but no advantage over the
operated Fly footprint — revisit with the market).

---

## 2026-08-28 — Educator version contract ("just enough git") adopted

**Decision.** Version control for educators is now an explicit, closed contract:
[specs/educator-version-contract.md](specs/educator-version-contract.md). Twelve
educator verbs (Save, Preview, Publish/Update page, Snapshot, History, Restore,
Pin/Cite, Share a file, Adapt, **Propose a correction**, **Update from source**,
Reconcile) with their Git translations — and a permanent exclusion list
(branch, merge, PR, commit message, rebase/rewrite, staging), each with an
educator-facing replacement.

**Key rulings (with rationale):**

| # | Ruling | Why |
|---|---|---|
| 1 | **Closed list, both directions.** Capabilities need an educator-workflow justification; exclusions are design, not deferral. | "Just enough" is only real if the boundary is written down; otherwise Git concepts leak back in one feature at a time. |
| 2 | **Two-pointer model instead of branches.** One linear history; working head (Save) + publish pointer (Publish/Update page). | The only real branch pressure is draft-vs-live during a running term; a movable publish pointer answers it completely. Terms are covered by Current-term + snapshots. |
| 3 | **No merge commits, ever.** Divergence (three doors) resolves by keep-mine / take-theirs / AI-assisted merge → one forward commit. | Merge UX is developer UX; AI-assisted merge (block anchors assisting) is the educator's merge tool. |
| 4 | **History is docId-keyed; the registry (R2) is the version index.** Git is storage; SHAs are never educator-facing. | Path-filtered history severs on rename/move. This elevates R2 from discovery plumbing to a version-control requirement. |
| 5 | **Lean `.md` committed source is permanent** — amends Roadmap R1/E3: the ".md.html as committed chapter source" target is dropped; the in-file editing UX proceeds on generated surfaces, and dual-extension uploads are absorbed by extracting embedded source. | Meaningful diffs/history and the no-lock-in legibility promise both require lean sources; committing carriers would bury content changes under framework bytes. |
| 6 | **PR → "Propose a correction"; upstream flow → "Update from source".** Suggest-back acceptance is itemized (never batched), applied as a forward commit with attribution. | These two verbs are what the vision's decentralized-improvement story (CA/NY adaptation, correction upstream, benefit to later users) actually needs; they were implicit before. |
| 7 | **History rewrite stays forbidden as an educator verb**, with one named exception: leakage remediation as an operator-run emergency procedure ([specs/leakage-remediation.md](specs/leakage-remediation.md)). | "Every change is kept" is the core promise; the exception is recorded so it can't quietly widen. |

**Verified against the vision** (the bridge: familiar verbs ↔ automated Git
operations; educator-controlled repos; decentralized improvement; share modules
as ready) — coverage table in the contract §8. Gaps the check surfaced and
fixed: Publish-as-pointer, Propose-a-correction, and Update-from-source were
missing from the earlier draft primitive list.

**Open (recorded in the contract §9):** trial→published history carry-over;
suggest-back UX lands with Module T; multi-author live collaboration out of
scope.

---

## 2026-07-12 — Licensing tiers, copyright-by-provenance, free platform / metered AI

**Decision.** License and copyright-cleanliness are **separate axes**, gated independently:
- **License** (the reuse grant): a package carries an **open license** (CC-BY/-SA/-NC/-NC-SA/CC0) *or* the
  new **`ALL-RIGHTS-RESERVED`** value (unlicensed). Open is required to **list on Discover**; ARR packages
  are created, published to their own site, and used for a class, but are **not listable**.
- **Copyright-cleanliness** (the right to distribute): required for any **public** publish (own site or
  Discover). Handled by **positive provenance** — every asset must *prove* a clean origin (self-generated or
  open-licensed with a captured source); "if you're not sure where an image came from, don't use it." The
  platform can't *detect* infringement, so it requires *proof of clean* instead. Text must be original prose
  (facts aren't copyrightable, expression is); coursewerk's near-verbatim scan flags copied passages.

**Enforcement.** `registerPackageAction` hard-requires open-license + **educator copyright attestation**
(recorded in the event log — no migration). Publish + List-publicly confirms carry an **attest + warn**
prompt; own-site publishing stays allowed (educator's responsibility, per owner). Adaptation is disallowed
for/into ARR. Verified: typecheck + 449 tests + web build.

**Why.** Coursewerk is optional/non-mandating — instructors may keep packages private (no license needed).
Making license optional (via ARR) lets private/own-class use coexist with an open, verified Discover market.

**Platform economics (owner note).** The **platform is always free and open**; the **AI assistant is the
metered part** (BYO-key / sponsored / paid credits) so the owner is never liable for thousands of users' AI
costs. Near-term: a *messaging* pass declaring this. Deferred: the actual metering machinery on the existing
entitlement seam (no billing UX yet).

## 2026-07-11 — Two-tier course model (blueprint vs. course) + coursewerk

Owner clarification of the product's mental model, refining the guide framing.

**A course has two tiers:**

1. **The blueprint (the plan / true spine).** Concept maps + assessment guides —
   plain text, concise, easy to maintain. They define *what* is taught, how
   concepts correlate, the learning objectives, and *how* each is assessed. This
   is the layer **instructors work in** ("the high ground" — planning).
2. **The course materials (public-facing, assembled products).** Study guide,
   slides, practice, quizzes, exams — rich structure, layout, visual design. They
   are **assembled from the blueprint, largely by AI agents + agent skills**,
   which handle the editing (accuracy, accessibility, copyright, structure,
   format, layout) far more reliably than hand-editing. **The study guide is the
   center of this tier** (the other public docs organize around it and stay
   traceable to it).

**Consequences / decisions:**

- The earlier "the study guide is the spine" framing was imprecise — it
  conflated the tiers. Correct framing: *instructors plan the blueprint; AI
  assembles the course around a central study guide.* The `/guide` content was
  reframed to **Blueprint → Course** (owner-chosen labels), with a new
  `BlueprintFigure` (plan → AI → course).
- **Every file has a markdown source of truth**, editable in the Alembic
  workspace **or** downloaded and edited locally — the same document either way.
- **coursewerk** is the owner's pipeline that drives an AI agent to produce a
  *complete, uploadable* course package. It is the **upstream author** of exactly
  what Alembic ingests: the [`alembic-package` skill](../.claude/skills/alembic-package/SKILL.md)
  + `importPackageFromFiles`/`/api/import-package` are its downstream landing
  contract. The guide names coursewerk explicitly (owner-approved).
- This does not contradict goal.md: Principle 2 ("study-guide centered") applies
  to the *course-materials* tier; Principle 8 ("open does not mean flat —
  concept maps, blueprints as planning layers") is the *blueprint* tier.

## 2026-07-11 — Offline authoring, document round-trip, pre-upload hardening

Context: making Alembic ready for educators to **author a whole package offline
(with AI agents) and bring it in** — as a `.zip` upload today, or pushed to
GitHub later — plus the **download → edit offline → replace** round-trip for
individual documents.

### Decisions made (with rationale)

| # | Decision | Why |
|---|---|---|
| 1 | **`repoForPath(path)` is the single source of truth for the two-repo split.** A pure, total, fail-closed, dual-mode derivation in `package-contract`. | The split was total but only ever *checked* against a declared repo, never *derived*. A single tree (zip) must be split; one shared function stops the importer and the authoring skill from drifting. |
| 2 | **`validatePackageForImport` (`package-ops`) is the one import gate.** Wraps the pure `validateProject` with the platform's carrier extensions injected. | "If it passes, Alembic ingests with zero friction." The pure validator can't import a carrier registry; one wrapper wires it so the skill and the importer share exactly one check. |
| 3 | **A valid package must contain `alembic.json` + `LICENSE`.** `validateProject` now enforces both; the importer generates a LICENSE from the manifest if absent. | The minimal package shape was implicit (procedural in `createSandboxPackage`). Now it's enforced data. |
| 4 | **Study guide is stored as plain `study-guide/<slug>.md`** — the source of record. | Resolves the `.md` vs `.md.html` ambiguity. `.md.html`-as-committed-source is the **E3 target**, not current *(dropped 2026-08-28: lean `.md` is permanent)*. The authoring skill and validator both say `.md`. |
| 5 | **Durable document identity = an embedded `uid` in the carrier's `#orz-meta` island** (`DocMeta.uid`, orz-markdown 1.6.0). The `uid` *is* the docId; `registerFile` matches it first. | The island survives in-file edits (`serializeDoc` never rewrites it), so identity travels *with the file* → permalinks survive rename/move/re-upload, and future whole-package / direct-GitHub origins inherit it with no rework. |
| 6 | **Package import creates a TRIAL package**, mints a **fresh platform `packageId`** (the author's is ignored), and registers with `origin: "uploaded"`. | The platform owns package ids (cross-user uniqueness). Import → trial → review → publish matches the existing lifecycle; publish still requires explicit approval (rule 8). |
| 7 | **Duplicate embedded `uid` across carriers is rejected on import.** | Two files claiming one identity would collapse to one docId (last-write-wins). Plausible when an agent clones a template island — caught at the door. |
| 8 | **Content-serving XSS: interim fix is a CSP `sandbox` opaque origin** on `/d/{docId}` + `/api/asset` (`allow-scripts`, no `allow-same-origin`, `nosniff`). | Self-contained docs legitimately carry scripts; sandboxing to an opaque origin lets them render but blocks access to the viewer's session. Closes the account-compromise vector without breaking the reader. |
| 9 | **U3 relative→permalink rewrite applies to plain markdown on the write path.** | Matches what "Insert" bakes in; makes cross-refs survive moves + downloads. Carrier-embedded refs are out of scope for now (need regeneration). |
| 10 | **Download in `DocumentActionsBar` gives the `.md` source**, not the dual-extension `.md.html`. | The `.md` is the source of record (matches the authoring skill). **Known inconvenience** (see Deferred #2): the downloaded `.md` isn't the directly-editable dual-extension file the in-app editor shows. |

### By-design constraints — permanent, NOT gaps

- **Trial packages are text-only.** A trial lives in Postgres; images/PDFs/media
  require a **published** (GitHub-backed) package. Import stores text now and
  **reports binaries** to add after publishing. This is the storage policy
  (`uploadVerdict` / `isBinaryPath`), confirmed permanent by the owner — do not
  "fix" it by letting a trial carry binaries.
- **Publish/registration always requires explicit educator approval** (rule 8).
  Import never auto-publishes.
- **The two-repo invariant is never bypassed.** `private/` (v2) /
  `private-instructor/` (v1) content never reaches the public repo; enforced
  fail-closed at every write, doubly so on import (derive by path, then
  `assertPathAllowedInEitherContract` before persist).

### Deferred to the future (planned, not built)

1. **Direct-to-GitHub ingest.** Author offline → push straight to GitHub → Alembic
   ingests. Needs **private-repo reconcile** (today's `reconcilePublicRepo` is
   public-only by explicit design) and **bootstrap-a-package-from-two-existing-repos**
   (reconcile currently assumes Alembic already created the package). Public-repo
   reconcile already works.
2. **Download the directly-editable dual-extension file.** `DocumentActionsBar`
   currently downloads the `.md` source; the convenient version downloads the
   generated `.md.html` / `.slides.html` (immediately editable offline, opens in
   its own in-file editor) and accepts it back on Replace — for study guides via
   the block-ID-reconcile path (`importFileAction`), for slides directly. This is
   the inconvenience flagged 2026-07-11.
3. **Full user-content isolation.** Serve all user-authored content from a
   **separate cookieless origin** (belt-and-suspenders over the CSP sandbox in
   decision #8). Infra/DNS decision for the owner.
4. **Carrier-embedded relative→permalink rewrite.** U3 covers plain markdown;
   rewriting refs *inside* a self-contained carrier needs regeneration.
5. ~~**E3 study-guide switchover** to `.md.html` as the committed source of record
   (see Roadmap R1/E3; today it's lean `.md`).~~ *Resolved, not deferred
   (2026-08-28): lean `.md` is the permanent committed source — see "Educator
   version contract" above, decision 5. The `.md.html` target is dropped.*
6. **UI polish + minor feature expansions** (general bucket — not now).

### Explicit non-goals

- **Letting an import carry binaries into a trial.** Contradicts the permanent
  text-only-trial policy above.
