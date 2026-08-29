# Storage & Write Paths — the three-store contract

**Status:** adopted (owner decision, 2026-08-28) and **fully implemented the
same day** (Waves H→3; [../StorageWritePathTasks.md](../StorageWritePathTasks.md),
[../Status.md](../Status.md)). Everything in §§1–4 and §7 is shipped behavior,
not a target — `writeThrough()`/`updateManifest()` (`packages/package-ops`) are
the seam, `committerFor` (`apps/web/src/lib/committer.ts`) is the one place the
trial / published / unreachable branch is decided, and migration
`0020_staging_bucket.sql` creates the bucket (**operator action** — see
[../Deployment.md](../Deployment.md) §1). §6's R2 verdict remains a decision,
and only its three named triggers reopen it. Governs every byte the
platform stores and every write path. Companion implementation plan:
[../StorageWritePathPlan.md](../StorageWritePathPlan.md).
**Related:** [educator-version-contract.md](educator-version-contract.md)
(Save's promise), [worker-tier.md](worker-tier.md),
[../reports/workspace-issues-2026-08-28.md](../reports/workspace-issues-2026-08-28.md)
(the findings this model answers), CLAUDE.md rules 1, 3, 4, 5.

## 1. Principle

Alembic deliberately has **no platform-owned permanent storage**: all users'
files live in their own GitHub repositories (the no-lock-in promise). The
platform's other stores exist only to serve the trial phase and to cache.
The weakness found in test use was never a missing storage tier — it was one
store (Postgres) playing three roles with unwritten contracts. This spec
names the roles and fixes the ordering.

## 2. The three stores — one role each

| Store | Role | Truth status | Lifecycle |
|---|---|---|---|
| **GitHub repos** (paired public/private, educator-owned) | the ONLY permanent store | **source of truth** for every published package (rule 4) | forever; survives Alembic |
| **Postgres — trial store** (`sandbox_files` rows of trial packages) | entire storage for trial packages; **text-only** (permanent policy) | canonical *for trials only* | ends at publish (graduation) |
| **Postgres — projection** (file cache + registry rows of published packages) | derived cache of repo content | **never authoritative; rebuildable** via reconcile | refreshed, droppable |
| **Ephemeral surfaces** (generated carriers, per-tab HTML memo, job sandboxes, staging bucket) | regenerable working state | disposable by definition | TTL / per-job / per-tab |

New (and only) object-storage use: a **Supabase Storage staging bucket**
(TTL-cleaned) for zip/raw-material intake — already in the stack, previously
unused. It is staging, never a home: nothing durable lives there.

## 3. The write-ordering rule (repo-first write-through)

For a **published** package, every write — editor save, upload, replace,
chapter/manifest op, populate — goes through one shared path:

> validate (contract, two-repo, block anchors) → build `CommitPlan` →
> **commit to GitHub** → update the projection *from the commit result* →
> `recordSyncedSha`.

- If the commit fails, **nothing changed anywhere**; the educator sees a
  retryable, plain-language failure. A save that didn't reach permanence
  didn't happen — this is the version contract's "Save records a permanent
  version" made literal. **No silent local-only writes, no silent skips**
  (the `if (!gh) return` pattern is abolished).
- For a **trial** package the trial store *is* the truth: write DB only.
  One branch, decided in one place.
- Cost accepted: Save on a published package carries the latency of a
  GitHub commit (~1–2 s) behind a visible saving state. A pending-outbox
  ("1 change not yet saved") is a possible future refinement — fail-loudly
  ships first because it never lies.

**Behavior change this rule causes (intended, user-visible).** A *published*
package whose GitHub connection is missing or broken now **refuses** writes
with an educator-facing reason, where it previously wrote to the projection
and silently skipped the commit. That is the point — a save that cannot reach
permanence is not a save — but it means a disconnected educator is blocked
rather than accumulating invisible local-only work. Reconnecting restores
writing; nothing is lost, because nothing was accepted. (A pending-outbox
would soften this and is the recorded future refinement.) Trial packages are
unaffected. Side effect: trial writes are now contract-path-validated too,
which they were not before.

**Known boundary — cross-repo change sets.** A single change set touching
BOTH repos cannot be atomic: they are two independent Git repositories, so
no distributed transaction exists. `writeThrough` commits public first, then
private; if the private commit fails, the public commit has landed while the
projection is untouched. That state is **recoverable, not corrupt** — repos
are the truth, and reconcile absorbs the committed-but-unprojected change on
the next check. Writers should therefore prefer single-repo change sets;
populate (which legitimately spans both) owns its own resume logic.

Corollaries:

- **One manifest owner.** The manifest is written only through
  `updateManifest()` inside the same write-through; the file copy is
  authoritative, the `packages.manifest` column is a derived read cache no
  writer may use as input. Optimistic concurrency (content-hash/version
  conditional write + retry) kills lost updates.
- **Reconcile keeps its direction** (repo → projection); with every commit
  recording its SHA, foreign-commit detection is exact.
- **Populate is retry-safe** (shipped): repos-first means a half-failed
  populate left real commits; a retry replans against repo head + registry and
  writes only the remainder. The pristine gate is **gone** — the door is now a
  **plan-diff confirmation** (`diffPopulatePlan`: adds / overwrites / unchanged
  / cleared) plus an explicit "empty this course and upload" path for genuine
  conflicts, so an interrupted upload never dead-ends. `isPristinePackage`
  survives only as a plain predicate for legacy packages and **must not gate an
  upload**. The zip reaches the server through the staging bucket via a signed
  URL, so the request-body ceiling is out of the path; the limit is a stated
  product one (`MAX_PACKAGE_ZIP_BYTES` = 50 MB).
- **Graduation** (trial → published) is the one legitimate bulk DB→GitHub
  write: initial commits of all trial files, then the truth flips and the
  rows become projection.

## 4. Slots, not placeholders

The per-chapter documents (concept map, study guide, slides, assessment
guide, practice) are **declared slots** rendered from the manifest — no
seeded placeholder files, no first-open lazy scaffolds, no welcome prose in
committed files (empty-state guidance lives in the UI). A file exists iff
real content exists. Consequences: Replace is an **upsert into the slot**
(any picked filename normalizes to the slot's canonical path, and carriers
are source-extracted at the door); empty slots never publish; "pristine" =
no content files — no magic filenames.

**Validation consequence (2026-08-28).** `validateProject` previously
**errored** when a declared chapter had no `study-guide/<slug>.md`. Under the
slot model that rule made empty chapters impossible — and chapters are now
created without a file — so it is a **warning**: the project still validates
(`ok: true`), and the absence is reported as "has no study-guide content
yet". `ValidationIssue` gained an optional `severity: "error" | "warning"`
(absent = error, for backward compatibility) so importers and UIs can tell a
blocker from an advisory. Imports of packages with not-yet-written chapters
now succeed — which is what an author assembling a course incrementally
(including coursewerk) actually produces.

## 4a. Published sites carry their own assets (2026-08-28)

Two reference forms, because two different consumers need different things:

- **Inside the published site → RELATIVE paths.** The assets a site references
  are published beside it on `gh-pages`, and its permalinks are rewritten to
  relative paths at build time. The site is then self-sufficient: GitHub's CDN
  serves it, it survives the platform disappearing, and **no student request
  reaches the platform to read a chapter**.
- **In downloads and shared elements → PERMALINKS.** A file that travels needs
  a location-independent reference: a downloaded document, or an element
  embedded in another educator's course, resolves anywhere and can be
  corrected at the source.

**Why this changed.** The save path's U3 rewrite (relative → permalink) is
correct for travelling files, and the published site simply inherited it — so
every figure on every published course was served from `alembic.orz.how`.
Two independent blind acceptance agents found this on the same day, and one
noted that `/guide/publish` promises the opposite ("If Alembic disappeared
tomorrow, your published course would keep working"). It also meant the
operator served all image bandwidth, and saw student traffic, for every
published course — a governance question for a research platform, not just a
cost one.

**Fail-closed rule:** a permalink that resolves into the **private** repo is
never published beside the site. The bytes stay unpublished, the link is left
as a permalink (so it asks for sign-in rather than silently 404ing), and the
educator is told. The two-repo invariant outranks a working image.

**Not adopted:** a 302 from `/d/{id}` to GitHub Pages/jsDelivr. It would fix
bandwidth but not *contact* — students would still hit the platform once per
figure before being redirected. It remains the right mechanism for permalinks
that must resolve from elsewhere, and is recorded as future work.

## 5. Raw materials & job artifacts (agent lane)

Uploaded raw sources (Word/PDF/PPT) are **job-scoped**: staged in the
bucket, consumed in the job sandbox, **bytes discarded after the run**
(the educator keeps their originals); what persists in the package is
provenance *records*, and generated artifacts only after review. Job state
lives on the job's own sandbox disk. Nothing here needs a platform store.

## 6. Object storage (R2-class): skipped — with revisit triggers

Evaluated 2026-08-28 across the full scenario inventory
(reports/workspace-issues-2026-08-28.md + §5 above): no current scenario
needs it, and a platform byte-store for published content would work
*against* the educator-owned-repos promise. Recorded triggers that reopen
the question — and only these:

1. **Hosted large media** becomes a product requirement (beyond the
   50–100 MB GitHub range; today's policy: link out). Design if triggered:
   a per-file large-media store referenced by permalink and registered in
   the registry — an extension, not a rework.
2. **GitHub API rate limits demonstrably bite** on private/trial serving
   (mitigate with Cloudflare response caching first).
3. **The worker lane needs a cross-job artifact store.**

## 7. Known-truncation fix

`listFiles` must paginate (PostgREST caps result sets); any whole-package
operation over a silently truncated file list is invalid. ✅ Shipped 2026-08-28
(Wave H / TH3): `SupabaseSandboxStore.listFiles` pages with `.range()` until a
short page. Anything added later that reads a whole package must go through it.
