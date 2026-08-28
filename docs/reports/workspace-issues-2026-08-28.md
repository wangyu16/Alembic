# Workspace issues report — chapters, uploads, placeholders

**Date:** 2026-08-28. **Scope:** the four issues reported from test use —
disappearing chapters, opaque zip-upload failures, replace-upload failures,
and placeholder design problems. Each finding lists evidence, mechanism,
a reproduction sequence, and confidence. Design proposals follow.

---

## F1 — Disappearing chapters: two manifest copies, split writers

**Severity: critical · Confidence: high (mechanism fully traced in code).**

The package manifest exists in **two writable copies** with different owners:

- the **file copy** — `alembic.json` row in `sandbox_files`;
- the **DB column** — `packages.manifest`.

Chapter operations (`createChapter`, `renameChapter`, `reorderChapters`,
`deleteChapter` — `packages/package-ops/src/chapters.ts`) read and write **only
the file copy**. They never update the column (sole exception:
`setUnitTermAction`, `chapter-actions.ts:213-222`, which copies file→column
with a comment apologizing for the asymmetry).

Meanwhile these actions build a manifest **from the stale DB column**
(`record.manifest` via `store.getPackage`) and then overwrite **both** copies
*and* commit `alembic.json` to GitHub:

- `setThemeAction` — `metadata-actions.ts:48-59`
- `setCourseInfoAction` — `metadata-actions.ts:121-144`
- accessibility recheck — `a11y-actions.ts:61`
- term actions — `term-actions.ts:64, 201`

**Reproduction:** add a chapter (file copy gains it; column doesn't) → later
edit the course description, change the theme, run the a11y recheck, or edit
term links → the stale column manifest (without the new chapter) is written
over the file copy and committed to GitHub → the chapter vanishes from
`listChapters` everywhere. Its seed file `study-guide/<slug>.md` remains,
orphaned and invisible.

The codebase itself documents this exact bug class for a different field:
`mirrorManifestToSandbox` (`lib/github.ts:185`) — *"this is exactly how a
published package's `manifest.publicRepo` disappears after an unrelated
edit."* The fix applied there (mirror column→file) is one-directional and is
precisely what clobbers `chapters` going the other way.

**Secondary contributors:**

- **Lost-update races.** Every manifest writer is read-modify-write on
  `alembic.json` with no concurrency control (`putFiles` is a blind upsert).
  Rapid add-add-add in the Manage dialog can drop a chapter.
- **Best-effort GitHub mirror.** `createChapterAction`'s `syncToGitHub`
  silently skips when no GitHub client (`if (!gh) return;`) and, when the
  commit throws, the action reports failure although the DB write stuck —
  either way DB and repo diverge; a later reconcile that absorbs an
  externally-changed `alembic.json` can then revert the DB manifest too.

## F2 — Zip upload fails with no usable reason

**Severity: high · Confidence: high for the size ceiling; medium-high for the
timeout path.**

- **Platform body-size ceiling.** `/api/populate-package` accepts up to 50 MB
  (`route.ts`), but **Vercel Functions reject request bodies over ~4.5 MB at
  the platform edge (HTTP 413)** before the route runs. The client
  (`populate-package.tsx:46-59`) does `res.json().catch(() => null)` → null →
  generic *"That package couldn't be uploaded."* Any zip with images fails
  this way; small text-only zips pass. This matches "sometimes fails, no
  reason."
- **60-second budget.** The route performs sequentially: DB puts → public
  commit → private commit → registry sync → permalink-rewrite pass → up to two
  more commits → registry sync again. With many files + GitHub latency this
  can exceed `maxDuration = 60` → function killed mid-flight.
- **Failure poisons retry.** The DB projection is written *before* the GitHub
  commits, with no rollback. After any mid-flight failure the package has
  content → `isPristinePackage` fails → every retry is refused with *"This
  course already has content"* — a dead end with no recovery UI.
- **Brittle pristine gate.** Touching anything first (creating a chapter,
  opening a doc so it seeds, saving the concept map) also makes the package
  non-pristine → upload refused, and the message doesn't say which files
  block it. Combined with the publish-first guard, the set of states where
  upload works is narrow, and the educator can't see the boundary.
- **Silent 1000-row truncation.** `SupabaseSandboxStore.listFiles` has no
  range/pagination; PostgREST caps result sets (default 1000 rows). A large
  package silently truncates the file list, corrupting `isPristinePackage`,
  populate planning, and any whole-package operation.

## F3 — Replace / upload-into-a-document failures

**Severity: medium-high · Confidence: high.**

- **Replace-not-create meets lazy seeding.** The five per-chapter documents
  are created *on first open* (slides: `hosted-actions.ts:154-165`; practice
  and others similarly) — but `replaceCollectionFileAction`
  (`collection-actions.ts:408-414`) requires the file to already exist:
  *"There's no document at that location to replace."* Replacing a document
  the educator never opened fails — the reported "sometimes doesn't work."
- **Name-blind canonical paths, name-driven doors.** A chapter document's
  path is fixed (`slides/<slug>.md`, `study-guide/<slug>.md`). Uploading "the
  actual file" under a different name through any other door doesn't reach
  that path: the Assets door files it under `assets/…`; `importFileAction`
  block-reconciles it **into the currently active chapter** (appending
  another chapter's sections into the wrong chapter if the active one
  differs). The placeholder stays; the upload "fails" from the educator's
  view.
- **Replace stores carriers raw (corruption bug).** The replace door never
  extracts an embedded source: picking a downloaded `.md.html` to replace a
  `.md` document stores the **entire HTML file as the markdown source**
  (`collection-actions.ts:428-434` — `blockIdIssue` extracts the island for
  *validation* only, then the raw input is persisted). Validation passes,
  the write succeeds, and the document/published page is corrupted. This is
  the sharp edge of DecisionLog deferred #2 (download gives `.md`, the
  editor surface shows `.md.html`).

## F4 — Placeholder design (root design issue)

**Severity: design-level; drives F2's gate brittleness and F3's
replace-vs-create ambiguity.**

Placeholders exist at three layers with three different lifecycles:

1. **Package seeds** — two content files created with the package
   (`create.ts` `SEED_CONTENT_PATHS`), recognized later *by filename* to
   decide pristineness.
2. **Chapter seed** — `createChapter` seeds only the study-guide file with
   welcome prose.
3. **Lazy doc scaffolds** — slides/practice/concept-map seed on first open,
   so a document's existence depends on navigation history.

Consequences: pristine detection is filename-magic; replace requires
existence while existence is accidental; scaffold prose can reach the
published site; populate must special-case deleting seeds it recognizes;
"what does this chapter actually contain" has no single answer.

---

# Design proposals

## D1 — One manifest owner (fixes F1)

Make the **file copy the single writable manifest**. All writers go through
one `updateManifest(store, packageId, patch)` in `package-ops` that:
read file → apply patch → write file **and** column (the column becomes a
derived read cache, never an input) → GitHub commit → `recordSyncedSha` —
in that order, in one place. Add optimistic concurrency (content hash or
version column; conditional upsert + retry) to kill lost updates. Delete
`mirrorManifestToSandbox` and the six scattered `packages.update({manifest})`
call sites. This is architecture rule 3 applied to the manifest.

## D2 — Slots, not placeholders (fixes F3/F4)

Represent the five per-chapter documents as **declared slots** (from the
document model) rendered from the manifest — *no seeded placeholder files at
all*. A file is created only when real content arrives (first save, upload,
or populate). Then:

- Replace becomes **upsert into a slot** (create-or-replace at the canonical
  path — path validity is already guaranteed by the slot).
- Uploading a file with any name into a slot **normalizes to the canonical
  path** ("Saved as Chapter 3 slides"), name-blind by design.
- The replace/upload door becomes **carrier-aware**: `.md.html` /
  `.slides.html` are accepted and their embedded source extracted
  (`classifyImport` already does this for the import door) — closing the F3
  corruption bug and DecisionLog deferred #2 in one move.
- Empty slots never publish; the student site renders only slots with
  content.
- Pristine = "no content files exist" — trivial, no magic filenames.
- The welcome/onboarding prose moves to UI empty states, not committed files.

## D3 — Zip upload: storage-first, job-shaped, resumable (fixes F2)

- **Bypass the body limit:** client uploads the zip to Supabase Storage via a
  signed URL (no practical size ceiling), then calls the route with the
  storage path; the route streams from storage.
- **Repos-first ordering:** plan → commit to GitHub (source of truth) →
  project the DB from what was committed; on failure, the projection is
  rebuildable (rule 4) instead of half-written.
- **Resumable, not refusable:** record a populate-in-progress marker; a retry
  resumes/reconciles instead of hitting the pristine gate. Longer term this
  is exactly a worker-lane job (the Postgres queue decided today), which also
  removes the 60-second ceiling.
- **Actionable refusals:** when the gate must refuse, list the blocking files
  and offer "empty this course and upload" (Tier-3 confirm).
- **Fix `listFiles`:** paginate with `.range()` until exhausted.
- **Client:** surface HTTP status distinctly (413 → "too large to upload
  directly — over ~4.5 MB").

## D4 — Sync integrity (hardens F1/F2)

Chapter/collection mirrors to GitHub should fail loudly or queue: replace the
silent `if (!gh) return;` with a visible "not yet saved to GitHub" pending
state (banner + retry), so DB/repo divergence is always educator-visible
instead of discovered by reconcile later.

---

# Suggested fix order (quick wins first)

1. **F1 hotfix** (small, surgical): make every column-writing action read its
   base manifest from the *file* (`readManifest`) instead of `record.manifest`,
   and make chapter ops also refresh the column (as `setUnitTermAction`
   already does). Fixes disappearance without waiting for D1.
2. **F3 hotfix:** carrier-source extraction + upsert semantics on
   `replaceCollectionFileAction` for slot paths.
3. **F2 hotfix:** signed-URL upload + 413/size messaging + `listFiles`
   pagination + actionable pristine-gate message.
4. **D1** proper (single manifest writer + concurrency), then **D2** (slots)
   with the document-model/contract-v2 work it naturally belongs to, then
   **D3** job-shaping when the worker lane lands.
