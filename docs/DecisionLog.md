# Decision Log

Dated record of concrete decisions — what was chosen, what is permanent by
design, and what is deferred to the future. Complements [Status.md](Status.md)
("what is done") with the "why" and the forward plan. Newest entry first.

---

## 2026-10-26 — Blind-critique round (public surfaces): fixes and the choices behind them

Branch `blindcritique/r2-fixes`. The round's verifiers and free-roam critic drove the deployed site signed out
(acceptance spec Block P). Choices that are not obvious from the code:

- **Return address after sign-in (P6).** Validated twice: on the sign-in page (before it goes into the GitHub
  round trip) and authoritatively in `/auth/callback`. Rule: a same-site path or nothing (`/workspace`) — no
  "allow-list of pages", because every same-site path is safe to land on and the list would rot. "@" is refused
  even inside a path (no Alembic page needs it in `next`), so the old `${origin}${next}` concatenation can never
  become `https://alembic…@evil.example`.
- **Report without JavaScript (P11).** A plain POST to a route handler that calls the same server action, rather
  than hiding the control when scripts are off: reporting is a safety affordance and should not need scripts.
  The route refuses a cross-site Origin itself (server actions get that check from Next). The wording of "what
  happens" is the governance spec's truth, nothing more: operators read reports, may take the course off
  Discover; no reply is promised.
- **Past-the-end harvest pages are 404 (P10).** PostgREST answers a range past the rows with 416 (PGRST103); that
  is now an empty page, so the routes say "not found". Page 1 of an empty index stays a valid empty feed.

---

## 2026-10-24 — Closed loop r5 (final): bases from real existence, guarded rebuilds, a held failure falls through; the loop closes

Round 5 was the owner's narrow last round: one auditor on round 4's changes, plus the decisions-diff audit. Branch
`phase5/loop-r5` on `phase5/decisions`. Every finding: claim + probe that fails before + fix of the class.

- **An editor's base is the file's real existence (P5.B.3.p).** The class was "the client infers whether a file
  exists from what it shows". Fixed at the source: the server says (`OpenedFile`: `exists = raw !== null`, the
  SHA-256 of the stored text), and no editor in the shell hashes its own text any more. The empty state is still
  shown for a whitespace-only document — a UI choice, independent of the base. The course concept map editor had no
  base at all and now has one.
- **A 422 rebuild is guarded by blob ids, in every repository (P5.B.3.q).** The synced-point comparison only exists
  for the public repository. Comparing the plan's blob ids between the first attempt's tree and the new head is the
  same question for both and costs two tree listings, only on a 422. A refused private save is never retried by the
  committer (it has nothing to reconcile).
- **A held failure falls through (P5.A.1.w).** A failure in one part of a drain must not stop the other parts. The
  held retry records its failure and the drain continues; at the end what is owed becomes a scoped entry. One
  attempt and one back-off per drain, however many steps fail. Not changed: held ids are still retried at each
  slice (they could wait for the end of the pass) — kept to preserve the r4b rule; a possible later refinement.
- **A fail sticks until re-checked (P5.R.5.h, refines owner decision 2).** "Neutral" is for "no current check yet",
  not "failed, then changed". Smallest mechanism: the expiry trigger expires only pass/warn — no new column. Rejected:
  a separate last-completed-result column used for ranking only (the listing row and badge would say "not checked"
  while ranking said fail). The fail is shown everywhere: it describes earlier bytes, but it can only understate a
  course, and the automatic re-check after each save replaces it.
- **Non-UTF-8 text stays held back (P5.B.3.r).** Asked: store it as base64 if simple and consistent. It is not
  consistent: the store has no encoding flag and every reader (editors, publish, the reconcile comparison, the
  committer's encoding) decides binary vs text by the file's name (`isBinaryPath`), so a base64 `.csv` would be shown
  and re-committed as base64 text. The hold-back stays; the control now says why ("not saved as UTF-8 — save it as
  UTF-8 where it was changed, or keep Alembic's version") and that keeping removes a file Alembic has no copy of.
- **The 10 s acknowledgement wait is the family protocol's (P5.B.3.w).** `orz-host-save@1` fixes it (orz-markdown
  `spec/host-protocols.md` §3); a lower layer is not changed for one host. Alembic serializes its host saves instead,
  so the re-save after a timeout carries the new base.
- **Linear scans instead of ambiguous regexes (P5.B.1.ad).** Where a regex had adjacent or nested quantifiers over
  the same characters (`[ \t]` runs, optional quote markers), or rescanned `[^x]*` from every candidate start, it is
  replaced by a deterministic scan or a regex whose quantifiers are separated by disjoint classes (`\s+(\S.*)?`). Line
  length is not capped: behaviour must stay identical, and a cap would change what counts as code. Each replacement is
  pinned by a differential test against the old regex on bounded random input (the old patterns' `\r` quirk kept).
- **Published accessibility follows the server's record only (P5.R.5.i).** The owner-written manifest field stays a
  trial-course preview; not checked means say nothing, never a default.
- **"Check now" gets its own per-user bucket (P5.R.5.j).** The protected cost is the educator's installation quota,
  which is per account, not per course; and a manual check should not use up the automatic check after a save.
- **The loop closes.** Rounds 1–5 are summarized in Status.md; what stays open is recorded there for Track C. No
  further review round: the next check is the blind-critique round on the deployed site.

## 2026-10-24 — Owner decision 2: the accessibility badge follows an automatic check; no check is neutral

The owner ruled that the badge must not depend on an educator remembering to re-run a check that every save expires
(0030), and that a course without a current check must not be ranked as failing. Branch `phase5/decisions`; migration
`0032_decisions_1_a11y_neutral` (NOT applied). Expiry semantics are KEPT (any move of the recorded head resets the
status) — the re-check now follows automatically.

- **(a) When it runs.** After every Alembic commit to a published course's public repository (the committer's new
  `onPublicCommit` hook in `committerFor` — so every save path, one seam), after publishing, and after "Check for
  outside changes" absorbs a change. It runs in `after()` — after the response — so it never delays or fails a save or
  publish; a failure is logged and records nothing.
- **Whose GitHub access.** The educator's GitHub App installation token, minted server-side from the App key
  (`clientForUser`) — the same credential the save used, not a browser session — so it works after the response.
  Reads use the service client (cookies may be unreadable by then); the runner refuses a course whose owner is not the
  requesting user and the record filters on owner. No worker path was needed; a worker would need the same App key.
  Without `SUPABASE_SECRET_KEY` nothing can be recorded, so nothing runs (no badge — neutral).
- **What it audits and records.** Unchanged sources (P5.S.3.g): `a11yAuditSource` → the recorded public repository at
  its branch head → `auditPackageA11y`; a trial course is never recorded. NEW: the record is accepted only while the
  audited head is still the recorded head (`recordA11yCheck` adds `last_synced_sha = checkedSha` to the same UPDATE).
  Without it, a check of head c1 finishing after a save moved the head to c2 (and expired the status) would write
  "pass" for c2's bytes, which nobody checked. A superseded check records nothing; c2's own check follows. Accepted:
  while an outside commit waits for reconcile (the published head ≠ the recorded head) no check is recorded.
- **Debounce and bounds.** Per instance: one run per course at a time; saves during a run coalesce into ONE follow-up
  run (reading the newest head); 1.5 s settle so a burst shares a run; ≤ 4 courses at once; ≤ 3 runs per scheduled
  task. Across instances: a per-COURSE bucket `a11yAuto` (30/hour, 200/day, Postgres-counted). Past a bound the
  course shows no badge until a later save is checked — neutral, not a penalty. Chosen over a queue table + cron (a
  new writer and schedule for a best-effort signal).
- **"Check now" no longer commits.** The manual action used to write the result into `alembic.json` through
  `updateManifest` — a commit, which moved the head and so expired the very check it recorded (and would now trigger
  another automatic check). For a published course it now runs the same runner and records only the server result;
  a trial course keeps the old behaviour (its stored copy, the trial store, no commit). Residual: the published
  site's schema.org `accessibility` still reads `manifest.accessibility`, which is no longer refreshed for published
  courses — OPEN: point the site metadata at the server record.
- **(b) Neutral, defined.** For a course with no current check the accessibility term (0.30) is left out and the
  other four weights are re-scaled to sum to 1 (`discovery_course_quality` = `discovery_quality('unknown', …) / 0.70`,
  mirrored by `courseQualityScore`). So an unchecked course ranks strictly between an otherwise equal `fail` and
  `pass`; before, it ranked with `fail`. Chosen over "unknown = warn (0.5)" (that asserts minor issues) and over
  dropping the signal for everyone. Elements are unchanged (their signal — a description — is always known).
  Discover shows no badge (already so) and no "Not checked" facet value; the app drops `a11y=unknown` and filters the
  value in the UI too, so code and migration deploy in either order.
- **Composition.** `discovery_search_courses` and `discovery_course_facets` are redefined from 0022 (their latest
  definitions) with one change each; `decisions-a11y.sql.test.ts` asserts every 0022 rule is still there (P5.A.1.r)
  and the helper is closed to the API roles. Rule 8 (no automation past publish/registration) is not touched: the
  check publishes nothing and lists nothing — it records a server signal about what is already published.
- **The educator sees it.** A status line in the publish header (published courses): the latest result and when it
  ran, or "not checked for your latest version yet — it is checked automatically after you save", with "Check now".
- **Discover's cache.** A recorded result calls `discoveryChanged()`; inside `after()` that may be a no-op (outside a
  Server Action), in which case the 120 s revalidate window bounds the staleness.

---

## 2026-10-24 — Owner decision 1: version pins are SHA-256 (closes P5.S.L2 / round-4 security MEDIUM-2)

The owner ruled that a version pin must be a cryptographic hash. Branch `phase5/decisions` (on `main` 4f56f65; not
merged). **Code only — no migration**: `documents.content_sha256` (SHA-256 of the stored content string's UTF-8, 64
hex) has been written by every registration since `0027`.

- **What uses the SHA-256.** The `/d/{doc}@{pin}` pin, the `/d` ETag (`W/"{sha256}"`), the server bytes-cache key
  (`{docId}@{sha256}`, in process and in Next's data cache), the mirror check for a pin during raw-CDN lag, and the
  pin check of a server-side include. `pinnedPermalink` emits only the SHA-256 form and refuses anything else (the
  upload rewrite emits live `/d/{docId}` links, unchanged).
- **Full 64 hex, not a prefix.** A 32-hex prefix would still be ample (2^64 birthday work for a random pair; a
  second preimage of a given pin 2^128), but the full digest costs only 56 more URL characters and removes the bound
  from every future argument. Lower-case only; a truncated, upper-case or over-long pin is no match.
- **Exact bytes.** `bytesMatchSha256` accepts SHA-256 of the raw bytes, or — for a binary path — of their base64 (the
  trial store's form). The old helper also accepted the FNV of a lossy UTF-8 decode, under which two binaries that
  differ only in invalid sequences hash alike; such a row (a binary registered from a lossy text read) is now served
  unlabelled and healed from the mirror (base64) rather than vouched for.
- **Legacy 8-hex pins keep resolving, but vouch for nothing.** A legacy pin matches only the row's CURRENT
  `source_hash`, and is then served through the same content-addressed path as a SHA-256 pin — keyed by the CURRENT
  SHA-256, so only bytes that hash to it are served (else 404 + heal) — and labelled as a LIVE answer (no
  `immutable`, no year-long browser copy). A row without a SHA-256 satisfies no pin of either form.
- **A row without a SHA-256** (registered before `0027` and not re-registered since) is served unlabelled
  (`private, no-store`) and healed on view; the page-load sync treats a missing digest as stale too. No back-fill
  migration: the registry has no content to hash, and copying the mirror's digest would vouch for bytes the row may
  not describe.
- **`source_hash` stays, as an internal identity key.** It is the registry's content-hash identity (first
  registration, move matching; for carriers it hashes the embedded source, so a re-render keeps the identity) and
  appears in the registry and discovery SQL of a dozen migrations. Its collision risk there is bounded: identity
  is resolved only within the owner's own package, explicit uids and move hints win over it, and nothing outside the
  owner's own registry is decided by it. Migrating it would touch every registry function for no reader-facing gain.
- **Also fixed on the way:** a pinned request with a matching `If-None-Match` whose origin bytes had moved was served
  the origin's other bytes (unlabelled) — now it falls through to the pinned path (cache, origin, mirror, else 404).

---

## 2026-10-24 — Closed loop r4, part B: a fair drain that commits per entry; signals carried whatever changed them; `/d` answers only what it can vouch for

Round-4 security and correctness findings in SQL, discovery and `/d` (repros `/tmp/alembic-r4/`, `/tmp/p5r4/sql/`),
fixed on branch `phase5/loop-r4b` (on `main` 03bcb00; not merged; migrations `0031_loop_r4b_*` not applied). Part A
(fork, reconcile, committer, editor save) is on `phase5/loop-r4a`. Decisions:

- **The drain is fair, and a failure is split, never a sink (P5.A.1.u).** Per-entry slice least(left, budget/5, 2 s)
  — 2 s is the owner's own flush, so a save of a package being drained waits at most one slice plus one chunk.
  Fairness is by `drained_at` (kept across merges and cursor restarts), not by "cursor is not null": an owner who
  restarts its own drain with every edit would otherwise stay in front. A failing chunk is set aside and the rest of
  the pass lands (then the entry is exactly the failed ids); a failing list is retried id by id within the slice.
  "New work" (ids the entry lacked, list → whole, a restarted cursor, content newly changed) clears the back-off;
  attempts are kept so the next failure still backs off longer. A whole pend into a whole entry is not new work.
- **The schedule is a procedure that commits per entry.** A function cannot commit, so the r3 job held every lock
  for the whole 25 s run. `discovery_drain` is SECURITY INVOKER with no SET clause (Postgres forbids transaction
  control otherwise) and reaches the queue only through definer functions; pg_cron runs it as the owner.
  `discovery_flush_pending` stays for an operator's one-off call. Risk accepted: a pg_cron mode that wraps commands
  in a transaction would refuse the COMMIT — the header has the check and the fallback schedule.
- **The package lock goes through `discovery_try_lock`** (same key as the projector's) so the lock's losing side is
  testable on the one-connection harness; the r3c composition assertion was updated deliberately for it.
- **The quadratic trigger join is fixed by a planner setting, not a rewrite (P5.A.1.v).** `ALTER FUNCTION
  discovery_on_documents_update() SET enable_nestloop = off` keeps the body (nothing to re-compose) and makes the
  transition-table joins hash joins; a rewrite (e.g. a scalar subquery per row) was rejected as more code for the
  same plan. The composition test fails if a later CREATE OR REPLACE drops the setting.
- **Column-list triggers are a class hazard (P5.S.17).** `AFTER UPDATE OF col` is skipped when a BEFORE trigger
  changes `col` in a statement that does not name it. The listing trigger now fires on every update and lets its
  WHEN clause (which sees the final row) decide; a catalogue test fails on any new instance.
- **`listing_history` gap documented, not back-filled from research events.** Courses unlisted before
  0030_loop_r3c_4 have no listing row to seed their first-listing time; `research_events` ('portal.registered',
  owner-attributed) could, but it is research instrumentation (data-handling-review) and a product signal derived
  from it is a secondary use — left to the owner. 0031_loop_r4b_3 repeats the listing-row back-fill idempotently.
- **A pin is a promise of exact bytes (P5.A.6.s).** When neither origin nor mirror hashes to it, `/d` answers 404
  (`no-store`) and heals the row, instead of r3's unlabelled other bytes: an unpinned link may show the newest bytes
  it can, a pinned one may not. The pin hash scheme (8 hex) is untouched — that is a separate owner decision.
- **The `/d` heal reads the mirror once and backs off on failure.** Bytes + digest from one row read, passed to the
  registration explicitly (a null there means "deleted" and would tombstone). A failed heal holds that doc for an hour
  in the same bounded gate (10,000 entries) — chosen over a separate failure map (one bound, one eviction rule).
- **LOW-5: a per-user bound now, the cheaper fallback later.** The tree fallback's cost (every stored file read
  and hashed) is fixed properly by comparing stored hashes, but that is reconcile / repo-reader code part A is
  changing this round; part B adds a per-user `reconcile` rate bucket (10 / 10 min, 60 / day, Postgres-counted)
  on the action only — the committer's reconcile after a refused save is not limited (it runs only on a refusal).

---

## 2026-10-24 — Closed loop r4 (part A): fork, reconcile, committer, editor saves

Round-4 audit findings on the TypeScript side (probes `/tmp/p5r4/commit/r4.test.ts`, `/tmp/p5r4/fork/*.mts`), fixed
on branch `phase5/loop-r4a` (on `main` 03bcb00; not merged; no migration). Part B (SQL / discovery) runs in parallel
on `phase5/loop-r4b`. Decisions:

- **A fork reads only text files, in linear time (P5.B.1.ab).** "Text" is decided by the file name (the same
  extensions the upload door treats as text, plus a few data formats); binaries are stored base64 and are copied
  untouched. Every reference pattern is anchored on a literal; a relative file link is read backward from its
  `#blk-` fragment (bounded at 2 KB) instead of being matched forward from every character.
- **Code is what the parser says it is, refined (P5.B.1.z).** The rule that matters for rule 7 is that every id
  `parseStudyGuide` counts gets re-minted — so its fence rule is reused verbatim and a line it reads as a section
  heading is never code. Beyond that, fences in lists and quotes, indented code and multi-line inline code are code
  (examples are documentation, not identities); `<code>`/`<pre>` count only as HTML elements outside the markdown
  source. Chosen over running the real orz-markdown parser in the pure fork (CLAUDE.md: one parser, in the
  renderer; package-ops stays pure).
- **The `{{nyml}}` header uid is the source of truth for orz 1.x carriers (P5.B.1.ac).** Every copy (fork, copy into
  this course) rewrites the header's `uid:` line along with the `#orz-meta` island. Consequence: the extracted
  source of such a copy differs from its source's in that one line, so its source hash differs (objects — the only
  files "copy into this course" takes — carry no such header today).
- **An editor save names its base (P5.B.3.m).** The base is the stored copy's SHA-256 (`content_sha256`), sent by
  the client and checked by `writeThrough` before any IO, then by the committer after it reads the synced pointer
  and before the post-reconcile retry. Chosen over GitHub-side blob preconditions (the bridge would need the base's
  blob id per path and every caller to carry it) — the stored copy is what the editor showed, and the committer's
  guard covers the online side. Accepted residual: a published save whose pointer read falls inside another tab's
  pointer-write → projection window (milliseconds) is not caught; without Web Crypto the client sends no base.
- **A held-back change blocks only what it involves (P5.B.3.l).** The committer retries on the head reconcile saw
  when its files are neither violation paths nor clean differences held back with them; the pointer's
  compare-and-set from the commit's parent keeps it before the held-back commit. "Keep Alembic's version" is the
  one deliberate overwrite: it commits with `overwriteSeenAt = <head shown>`, so a change made after the educator
  looked still refuses. Private-space files are never "kept" (removal + the leak runbook).
- **Reconcile reads by blob id, writes by compare-and-set (P5.B.3.k).** Binary vs text by file name (the upload
  door's `isBinaryPath`); non-UTF-8 text is held back, never stored with U+FFFD. The store's compare-and-set moved
  from content equality to the `content_sha256` generated column (no migration; content filters ride in the URL).
- **Saves during publish (P5.B.3.o)** are caught up after the course is recorded as published (store vs the publish
  commits' snapshot), commit-only through the committer, each re-checking the store; best effort.
- **The first publish commit writes `alembic.json` directly (P5.B.1.y, reworded).** It is the creation of the
  repository, made before the course is published (no committer exists yet); routing it through `updateManifest`
  would need a published course. The claim now says so, and a scan pins it to that one call.

## 2026-10-24 — Closed loop r3: identity is a whole-run matching; no lockout by our own commits; drained, aged queue; identities frozen

Round-3 correctness audit (probes `/tmp/p5r3/`, `/tmp/p5r3a/`, `/tmp/p5r3b/`) plus the round-3 security audit's
findings (`/tmp/alembic-r3/`), fixed on branch `phase5/loop-r3-cor` (on `main` edc0d06; not merged; migrations
`0030_loop_r3c_1…4` not applied). Decisions:

- **Identity is resolved for the whole run, not file by file (P5.B.1.x).** Every live uid is first matched to the
  file that carries it on; an untouched present original keeps its uid (newcomers are copies). Rows a call moves are
  parked at `'.alembic-moving/' || doc_id` inside `documents_apply` (the location index is a partial unique index and
  cannot be deferred). A move chain is never split across calls; a chain longer than 500 rows is one larger call
  (accepted: only a renumbering of > 500 carriers). Uid-less files keep location identity, as before.
- **Our own commits never lock a course (P5.B.3.g).** The pointer advances by compare-and-set from the commit's
  PARENT, so a commit on Alembic's own previous commit advances it and one on an outside commit never does. A refused
  save reconciles at once: if the overlapping files equal what Alembic already holds, the save is retried once;
  otherwise the outside version has been brought in and the educator redoes the change; a held-back (quarantined)
  change names the restored "Check for outside changes" control. Reconcile now absorbs/reports only real
  differences, and when GitHub's comparison cannot list everything (≥ 300 files, diverged/behind, failure) it
  compares blob SHA-1s of the head tree with the stored copy. Chosen over a ledger of our commits (a new table and
  writer) — the stored copy already is that ledger.
- **The discovery queue (P5.A.1.s, P5.A.1.t).** A merge behind a drain's cursor restarts it; the drain takes the
  package lock before touching its entry; failures back off (1, 2, 4 … min, ≤ 1 h) for every drain. The scheduled
  drain is **Supabase pg_cron** (every 5 min, `discovery_flush_pending(25, 25 s)`), chosen over a Vercel Cron route
  (Hobby plans run crons at most daily; a route would need `CRON_SECRET` and a service key in another place) and over
  the Fly worker (not always running). The migration schedules it only when pg_cron is enabled — an OWNER ACTION.
  Age is first-queued time (kept across merges; also the drain order, so edits cannot starve an entry), visible on
  the admin page and in `discovery_pending_overdue`. Security LOW-2 (another user briefly holding a package's lock)
  is now only a delay.
- **`/d` never registers from raw bytes (P5.A.6.p, P5.A.6.r).** raw.githubusercontent.com lags a commit by minutes;
  a stale `/d` answer now heals that one file from the trial mirror (which the write path updated after its commit),
  through a service-role registry whose foreign-id check reads `documents` and `retired_ids` directly; it writes
  nothing when the row already matches the mirror and never tombstones. A pin whose origin bytes lag is served from
  the mirror when (only when) the mirror's bytes hash to the pin. Unlabelled answers are `private, no-store`.
- **Identity columns are frozen for every role (security HIGH-1, P5.S.16).** One trigger function
  (`refuse_identity_change`) on every PK/FK identity column the API role can update; the inventory test now treats
  every such column as sensitive by default (owner/role columns and stored-file locations are listed exceptions).
- **Listing signals are the server's (security LOW-3/4/5).** The listing row's accessibility status is copied by
  the database from `packages.a11y_status`; a check records the head it audited and any later move of the recorded
  head (including a course-details save) shows "not checked" until the next check; the first listing time survives
  unlisting (`listing_history`). DOCUMENTED, not changed: the 200-pending inbox cap per course can be filled by ≥ 10
  real accounts (20 each) — Sybil needs real GitHub accounts and the owner can reject in bulk; two concurrent
  arrivals may overshoot the cap by the concurrency (no counter row is locked) — bounded, accepted.
- **Course details have one writer (P5.B.1.y).** `writeThrough` refuses an invalid, foreign or deleted
  `alembic.json`; the editor save refuses it outright; the dead `renamePackageTitle` is gone. Publishing merges only
  the repository pair into the current details and a half-finished publish completes on the next click (P5.B.3.i).
- **Fork ids are per chapter (P5.B.1.z).** Contract block ids (`{{attrs[#blk-…]}}` in study-guide/, slides/,
  practice/) are re-minted per file; references follow the copy they point into; code is never rewritten. OPEN for an
  owner ruling: `{#blk-…}` heading attributes are not contract ids and are copied unchanged.

## 2026-10-23 — Closed loop r2 (correctness): bounded projector, dormant uids, owner-set fields, outside changes

Round-2 correctness audit (probes in `/tmp/p5r2/`, `/tmp/p5r2disc/`), fixed on branch `phase5/loop-r2-cor`, built
ON TOP of `phase5/loop-r2-sec` (not merged, migrations `0029_loop_r2c_1…3` not applied). Decisions:

- **Composition rule.** Every function a 0029 migration redefines starts from its LATEST definition and keeps
  every earlier rule; `loop-r2-cor.sql.test.ts` asserts the live definitions carry them (P5.A.1.r). Round 1 lost
  0025_2's trust rules to 0026 exactly this way.
- **The write path refreshes at most what it can afford (P5.A.1.h).** Inside a write: the touched element rows,
  or the course row only when no element input changed, or — for a whole-package refresh of a live course above
  1,000 candidate elements — the course row now and the elements queued. The queue is drained by the OWNER after
  the write (`discovery_flush_package`, its own statement, ≤ 1,000-element chunks, ~2 s budget), so a timeout there
  can never undo the write. Chosen over a cron (none exists) and over draining in Discover reads (anonymous reads
  must not do write work). Residual accepted: a big course's elements show the old course title for a few seconds;
  search re-checks listability live, so nothing unlisted is ever served.
- **`query_canceled` is caught by name in the best-effort wrapper and the drain** (Postgres: "possible, but often
  unwise"). Made safe by the transaction-local flag `alembic.discovery_cancelled`: after a cancel every later
  refresh of that transaction is queued, not run, so no projector work runs on without a timeout; the write
  (AFTER triggers: already done) commits. A client's own cancel of such a statement also lets the write through —
  accepted, the alternative being a failed save.
- **Per-package advisory lock, try-only (P5.A.1.q)**: a loser queues itself rather than waiting (no stall behind a
  projector, no deadlock); the rebuild skips the lock (one transaction over thousands of packages would fill the
  shared lock table).
- **Text bounds (P5.A.1.o)**: the projector caps what it indexes (it must never fail on stored data); the registry
  columns get CHECK constraints (4,000 / 2,000 / 64 × 100), cutting the few stored values beyond them first — a
  NOT VALID constraint would make every later registration of such a row fail. The schemas in package-contract
  stay unbounded on purpose (an old record or manifest must still parse); the limits live in
  `REGISTRY_TEXT_LIMITS` and are enforced at the write gates.
- **`/d` (P5.A.6.o)**: an unpinned answer re-verifies within 60 s (cost: one origin read per document per window
  per instance — accepted for freshness); a pinned answer does not (its bytes are content-addressed). A stale row
  triggers a one-file re-registration from the bytes just read (service client, once per doc per window). Known
  interplay: for a published course with an unreconciled outside commit, `/d` registers GitHub's bytes while the
  edit page's heal registers the trial mirror's — they alternate until "Check for outside changes" runs.
- **Outside changes (P5.B.3.f)**: the save is refused only when the outside change touched a file the save writes
  (CAS by path, fail closed); other saves go through but never advance the synced pointer past the outside commit
  (it stays visible to reconcile). No persistent "needs reconcile" flag (it would need a column and a writer);
  the refusal message is the visible signal. Residual: Alembic's own commits after an outside one look outside
  too until reconcile runs.
- **A dormant uid is the last resort, not the first (P5.B.1.s).** Only one of the package's LIVE identities may
  displace; a uid with no live row (the package's own deleted document, or never registered) is adopted only where
  a fresh id would be minted. Kept: re-uploading a deleted document to a free location restores its permalink.
  Accepted: overwriting a plain file with a carrier that brings a new uid keeps the plain file's docId (the
  permalink in circulation wins over the id in the bytes).
- **The registry write keeps owner-set fields in the database, not only in the app (P5.B.1.t)**, because the race
  is between two writers; resurrection is the one case that takes the run's values (a deleted file came back).
- **Registration chunks of 500 with a binary-split fallback (P5.B.1.u).** A run larger than one chunk is no
  longer atomic as a whole — each chunk is (with the identities it displaces); a partial run is healed by the next
  page load like any failed registration.

## 2026-10-23 — Closed loop r2 (security): server-owned signals, ids never reissued, Supabase-shaped test database

Round-2 security audit (probes in `/tmp/alembic-r2/`), fixed on branch `phase5/loop-r2-sec` (not merged,
migrations `0028_loop_r2_1…5` not applied). Decisions:

- **The SQL test database is Supabase-shaped (P5.S.13).** Migrations run as a NON-superuser owner, each file in a
  fresh session, because round 1's production failure (42501 on 0025) was invisible to a superuser harness. The
  replayed data directory is cached by content hash; superuser-only settings (`track_functions`) are server
  configuration set by the harness, never by the owner.
- **Every server read of a published package's repository uses the publish-recorded repo (P5.S.3.e).**
  `manifest.publicRepo` stays the course's own record in `alembic.json`, but no server path reads it; a static
  scan pins that (five listed exceptions, none a stored manifest field).
- **The trusted accessibility result describes the published bytes (P5.S.3.g).** The check audits the recorded
  public repo at head through the educator's own GitHub connection; a trial's check is the owner's preview and is
  not recorded as the trusted result. Concept-map topics still read the mirror (listing text the owner writes
  anyway).
- **Recency columns are server-owned for every role (P5.A.1.n)**, by BEFORE triggers (not column revokes), so the
  registry's existing upserts keep working and no deploy coupling arises; the projector also clamps to now().
- **Ids are never reissued (P5.B.1.q)** — a private ledger fed by delete triggers, checked on insert. Chosen over
  forbidding package deletion: trial deletion and archived-course purge stay, the id simply stays dead. Ids
  deleted before 0028 and referenced nowhere cannot be recovered (back-fill covers lineage targets and research
  events).
- **The "taken" lookup answers only for the caller's own package (P5.B.1.r).** Residual accepted: a caller learns
  whether an id it already holds is taken (inherent in uid adoption).
- **Suggestions arrive pending, bounded and rate-limited (P5.S.1.e)**; the sending package need NOT be published
  (suggest-back comes from an adaptation, which starts as a trial).
- **Listing rows are written by the server after the gates (P5.S.1.f)** — the package-trust-writes pattern; the
  owner keeps DELETE (unlist). Deploy: code first.
- **Adaptation counts (LOW-4, P5.S.3.f): partly fixed, partly open.** A course adaptation now needs adapted
  content (≥ 1 live public file). OPEN: `documents.adapted_from` / `author` remain owner-asserted — a server-only
  lineage write needs a service-role registry path, disproportionate now; Sybil inflation needs real GitHub
  accounts; per-user quotas are not built.
- **Rate subjects:** `/api/preview` is limited per USER (60/min, shared store); every address-keyed limit counts
  an IPv6 client by its /64.

## 2026-10-23 — Loop r1 + r1b integration: 0026 inherits 0025_2's projector; one deploy window

| # | Decision | Why |
|---|---|---|
| 1 | **Edit the unapplied `0026_loop_r1b_discovery` so its projector is 0025_2's (server `a11y_status`, recorded `public_repo`, distinct published other-educator adaptations) plus r1b's guards and recency**, rather than add a later migration that re-applies r1's rules. 0026 now requires 0025_2. Listing recency (`listing_changed_at`) moves on the server a11y record, not on `manifest.accessibility`. | Both rounds rewrote the same 0022 function; in file order 0026 silently undid the M2 security fix. Neither file is applied anywhere, so fixing 0026 leaves no window in which the regression is live. |
| 2 | **One quiet window for `0025_1/_2/_5` + `0026` + `0027` and the code switch** (promote a pre-built deployment right after the migrations). | r1 needs its code before `_1/_2/_5`, r1b's code needs `0027`, and `0026` needs `0025_2` — a cycle no strict order breaks. Migrations-first costs only refused publish/archive/listing and dropped client events for the window; code-first would break every workspace page load (missing `content_sha256`). |

---

## 2026-10-23 — Security loop r1: report caps per reporting source; RPC time bound on the roles (M4, L4a)

| # | Decision | Why |
|---|---|---|
| 1 | `file_portal_report_v2` **validates before it counts**: the package must exist and be listed (a listed course, or a published course with a shared element), else `invalid` and no counter moves. The per-package cap becomes per **(package, reporting source)** — 5 / hour, 10 / day — where the source is an HMAC of the signed-in user or the address (never the address itself); the global 60 / hour, 300 / day is charged only by valid reports. The 0024 function delegates to it. | Junk ids exhausted the global cap and an infringer could pre-fill its own package's cap. A rotating client naming real listed courses can still use the global hour — the same bound as before, now paid in valid, stored reports. |
| 2 | **No foreign key** on `portal_reports.package_id`. | Reports are operator records; they must outlive a purged package row. Validation at the door gives what the FK would. |
| 3 | The discovery RPCs' time bound is the **role's** `statement_timeout` (anon 3 s, authenticated 8 s, pinned in 0025_loop_r1_4), **not** a function-level `set statement_timeout`. | Postgres arms the timeout when a statement starts, so a function's own setting does not bound the one-statement PostgREST call; PostgREST applies the role's settings per request. Per-call work is already bounded in SQL; call volume is not bounded by the database (documented in discovery-index.md). |

---

## 2026-10-23 — Security loop r1: `/d` takedown bound, view de-duplication, include budget (M3, L4b, M5)

| # | Decision | Why |
|---|---|---|
| 1 | **No shared cache keeps any `/d` answer longer than 300 s** (`TAKEDOWN_BOUND_SECONDS`, stale windows included). Pinned `@{hash}` answers: `private, max-age=31536000, immutable` for the browser, `CDN-Cache-Control` / `Vercel-CDN-Cache-Control: public, max-age=300` for the CDN. Live answers: `s-maxage=240, stale-while-revalidate=60` (was 300 + one day). Tombstones: `s-maxage=300` (browser keeps an hour). Supersedes the "pinned immutable" and "one-day stale-while-revalidate" parts of the Track A.6 entry below. | The audit (M3) showed a pinned answer of a file later removed, made private or taken back to trial would keep being served by the CDN for a year. The browser's own copy is acceptable (the reader already saw that version); a shared copy is not. CDN headers make the CDN lifetime explicit; a cache that ignores them sees `private` and keeps nothing, so the failure mode is "not cached", never "cached too long". The cost is more origin revalidations, which the ETag/304 path and the bytes cache keep cheap. |
| 2 | **`element.viewed` is written at most once per (doc, client address, clock hour)**, counted with `rate_limit_hit` (0023) under the key `view:` + HMAC(doc, address), with the bounded in-process counter as fallback; any other counter failure records nothing. The `/d` answer ignores the query string; busted URLs (`?x=n`) are not redirected. | The audit (L4b) showed `?x=n` makes every request an origin answer and so a research event. A view per hour per address is what research needs; counters are pruned after two days, events are kept. Losing a view event is acceptable, unbounded writes are not. HMAC over the doc and the address together keeps both out of the counter table and unlinkable across docs. A redirect to the bare URL would also protect the CDN but changes the answer for links that already carry a query; the origin path for a busted URL is cheap (rate limited, bytes from the cache, no event). |
| 3 | **`/api/preview` requires a signed-in session, and every `resolveWebIncludes` call is budgeted: 50 include fetches and 2 MB fetched** (`INCLUDE_LIMITS`, nested includes count; the excess stays unresolved). All entry points that reach a server-side fetcher are inventoried and must gate every exported handler on the session (`include-fetch-entry-points.test.ts`). | The audit (M5) showed one anonymous 109 KB preview body made the server issue 2000 fetches. The preview is an editing tool used only from the workspace, like `resolveIncludeAction`, which was already gated. The budget sits in the resolver rather than the route so publish and export paths get it too; a real document includes a handful of fragments. |

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

## 2026-10-23 — Closed loop r1b: registration inside the write path; one package per docId; projection cost and recency

Phase 5 correctness/scale audit, round 1 steps 4–5 (branch `phase5/loop-r1b`). Claims P5.B.1.m–p,
P5.A.1.m, P5.A.1.i (strengthened), P5.A.2.m, P5.B.2.a/h (action level), P5.B.3.e.

| # | Decision | Why |
|---|---|---|
| 1 | **Registration is part of the one write path.** `PackageStore.registry` (the production store always carries one); `writeThrough` / `updateManifest` register exactly what they wrote, best-effort; hand registration after a write is gone. | Most saves (hosted editors, edit page, change review, assets, assessments, planning, metadata, adaptation) never registered, so `source_hash`, `/d` ETags and element recency went stale. A hook in the seam cannot be forgotten by the next caller. |
| 2 | **The page-load check compares content digests, not only path sets.** `sandbox_files.content_sha256` is a generated column (SHA-256 of the stored text); each registration records the digest it saw (`documents.content_sha256`). | A content change with an unchanged path set was invisible. SHA-256 rather than the registry's FNV source hash because Postgres can compute it without shipping bytes. Cost: the same two content-free queries; one re-verify of every pre-r1b row on the first visit. |
| 3 | **Renames pass an explicit `movedFrom` hint**; `writeThrough` refuses a hint whose old path the change set does not delete. | Hash matching lost the identity when a file was edited and renamed in one write. |
| 4 | **`/d` answers 304 only if the hash was verified against the current bytes within 60 s** (per instance); otherwise one read decides, and a mismatch serves the current bytes unlabelled. | A stale registry row kept clients and the CDN on the old version indefinitely. Touches the other loop agent's `/d` area minimally (the conditional branch only; headers unchanged). |
| 5 | **A docId belongs to exactly one package.** An embedded uid is adopted only if globally unused or already this package's (one SECURITY DEFINER lookup, only when a run carries an unknown uid); fork and element adaptation re-mint the copy's uid; a database trigger refuses any change of `documents.package_id`; a registration run is one transaction (`documents_apply`, RLS as the caller). | `documents.doc_id` is the global key: a copy carrying the source's uid MOVED the row (same owner) or was refused after its tombstones had landed (other owner). The permalink spec's "same docId in another package" could never hold and is amended. |
| 6 | **One id shape** `doc-[0-9a-z]{1,64}` (`DOC_ID_PATTERN`, package-contract) for uid adoption, `/d`, the cursor, the permalink builder/classifier and import; stored rows keep a lenient read shape. | The registry adopted ids `/d` 404ed. Lenient reads keep a legacy row from making a package's registry unreadable. |
| 7 | **Listings end on the exact count or an empty page, never a short page.** | A server row cap below 1000 truncated listings, and a rebuild then tombstoned live files. |
| 8 | **Discovery: fingerprint-guarded upserts, doc-scoped refreshes, one refresh per flush (deferral queue), recency in base tables.** Element recency = the file content's last change (`documents.content_changed_at`); course recency = greatest(listing time, `packages.listing_changed_at`, latest public content change). Both columns are trigger-owned. | 333/333 element rows were rewritten per save and 3 refreshes ran per flush; a rebuild from empty lost `updated_at`. A package rename or a description edit no longer bumps element recency (deliberate). |
| 9 | **The deployed site carries no build timestamp** (`build-info.json` = generator + renderer); blob uploads are capped at 8 in flight. | The timestamp made every publish a new commit, so "unchanged" was never reported; 150 concurrent blob POSTs invite secondary rate limits. |
| 10 | **A reconcile that absorbs `alembic.json` goes through `updateManifest` (no re-commit) and refreshes `packages.manifest`**; an invalid or deleted foreign manifest quarantines the reconcile. | The projection reads the column, so licence/listing changes made on GitHub never reached Discover. |
| 11 | **Upload rounds: documented limit, not pre-minting.** Rounds = chain length, resolves O(n²), a prev/next pair never commits (reported as a broken link). | The held documents are lean `.md` sources with no identity island; pre-minting would need an identity carrier in `.md` (against the lean-source rule) or registry rows ahead of the repo (against repo-first). Needs an owner decision. |

Deploy order: migrations `0026_loop_r1b_discovery` then `0027_loop_r1b_registry`, then the code (0026 alone
is compatible with the current code; the code needs 0027). 0027 adds a stored generated column to
`sandbox_files` (one table rewrite). Production check for rows already moved across packages, and the
repair procedure: `supabase/tests/0027_detect_cross_package_docids.sql` (read-only; repair not run).

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
| 1 | Every Discover read (search, facets, course and element pages) goes through the **cookie-less anonymous client** and is cached in Next's data cache under one tag, `discovery`, for ≤ 120 s; educator actions that change a listing call `updateTag("discovery")`. The visitor's session is read only for the adapt pickers. | Answers are identical for everyone, so they can be shared; the anonymous client also proves that nothing on these pages needs more than the public read policy. Tag invalidation gives the educator read-your-own-writes; the short window bounds everything else (operator takedowns, reconciled edits). *(Corrected 2026-10-23, security loop r1, P5.S.8: this row first said stale unlisted content is never served; it can be, for up to 120 s — listability is re-checked only on a cache miss. Every owner action that changes listability now invalidates the tag, enforced by a source scan.)* |
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
