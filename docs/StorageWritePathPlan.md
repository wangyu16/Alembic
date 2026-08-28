# Storage & Write-Path Implementation Plan

**Date:** 2026-08-28. Executes
[specs/storage-and-write-paths.md](specs/storage-and-write-paths.md) and the
fixes from
[reports/workspace-issues-2026-08-28.md](reports/workspace-issues-2026-08-28.md)
(F1–F4 / D1–D4). Discipline per CLAUDE.md: durable logic first, thin client
last; tests beside source; adversarial tests on anything touching the
public/private boundary; Status.md updated in the same commit as each phase.
**Acceptance:** the whole effort is verified by a blind-critique run against
[blind-critique/acceptance-spec.md](blind-critique/acceptance-spec.md)
(frozen today, before implementation — see
[blind-critique/README.md](blind-critique/README.md)). Plan items cite the
acceptance items they must make true.

> **Execution decomposition:** the phases below are decomposed into
> file-disjoint, independently verifiable subtasks (waves, concurrent
> subagents, integrator gates) in
> [StorageWritePathTasks.md](StorageWritePathTasks.md) — including the
> pre-execution conflict review. Execute from THAT document.

> ## ✅ EXECUTED 2026-08-28 — historical plan
>
> **Phases H, W, S and P all shipped the same day** (Waves H→3; see
> [Status.md](Status.md) for what each delivered). Phase V is the only one
> outstanding: T41 adversarial sweep ⬜ and T43 blind-critique round ⬜ (T42 doc
> coherence ✅). **The phase bodies below are the plan as written before
> execution** — where a phase says "becomes" or "will", that change has since
> landed; where the shipped result differs from the plan, the difference is
> recorded in Status.md and [DecisionLog.md](DecisionLog.md) (2026-08-28
> "Storage & write-path implementation"). The most consequential divergence:
> **S4/P2's pristine gate was not rewritten but replaced** — `isPristinePackage`
> survives only as a plain predicate for legacy packages, and the upload gate is
> now a plan-diff confirmation (`diffPopulatePlan`).

## Phase H — Hotfixes (stop live data loss; ship first, small and surgical)

- **H1. Manifest clobber stop** *(F1 → acceptance B7)*. Every action that
  writes the `packages.manifest` column reads its base manifest from the
  FILE copy (`readManifest`), never `record.manifest`
  (`metadata-actions.ts` theme + course-info, `a11y-actions.ts`,
  `term-actions.ts` ×2); chapter/unit ops refresh the column after file
  writes (generalize the `setUnitTermAction` pattern to
  create/rename/reorder/delete/page-name). Regression test: create chapter →
  set course description → `listChapters` still lists it (memory-store +
  a Supabase-shaped fake).
- **H2. Replace-door carrier extraction** *(F3 corruption → C6)*. In
  `replaceCollectionFileAction` (and any other text write door), when the
  target is `.md`/plain and the picked content `hasCarrier`, extract the
  embedded source and store THAT; refuse with plain language if extraction
  fails. Test: replace a `.md` doc with its `.md.html` download →
  stored content is the markdown source, byte-identical round-trip.
- **H3. `listFiles` pagination** *(F2 tail)*. `.range()` loop until
  exhausted in `SupabaseSandboxStore.listFiles`; test with a >1000-row fake.
- **H4. Loud sync failures** *(D4 → B8)*. Replace silent `if (!gh) return;`
  in `syncToGitHub`/`syncFilesToGitHub` callers with a returned
  `synced: false` the actions surface ("Saved here, but not to GitHub —
  retry"); interim until Phase W makes it impossible.

*Definition of done:* chapters survive every other edit; replace never
stores HTML into a `.md`; the four fixes land with tests + Status entry.

## Phase W — `writeThrough()` core (the ordering rule)

- **W1. Seam** (`package-ops`): `writeThrough(store, committer, packageId,
  changes)` — validate → CommitPlan → `committer.commit()` → project →
  return SHA. `committer` is an interface the web app implements over
  `github-bridge` (bridge stays the only GitHub caller, rule 5); trial
  packages take the DB-only branch inside the same function. Failure =
  no-op everywhere, typed error.
- **W2. `updateManifest()`** — the single manifest owner: read file → apply
  patch fn → conditional write (content-hash optimistic concurrency, retry
  loop) → write column as derived cache → commit via W1. Delete
  `mirrorManifestToSandbox` and all six scattered
  `packages.update({manifest})` call sites. Adversarial test: two
  concurrent updates both land (retry), never lost.
- **W3. Migrate every writer** to W1/W2: editor saves (`saveFileAction`,
  hosted save), collection upload/replace/rename/delete/create, chapter
  ops, term/theme/course-info/a11y, import, adaptation writes. Save UI gets
  a visible saving state; failures are retryable messages, never silent
  divergence. *(→ B1–B8, C1–C8)*
- **W4. `recordSyncedSha` audit** — every commit path records it (private
  commits documented as out of reconcile scope).

*Parallelizable:* W1+W2 first (one agent), then W3 fans out by writer
family (chapters/manifest · editor saves · collections/import) — disjoint
files, verified by one integrator.

## Phase S — Slots, not placeholders

- **S1. Contract**: declared slot set per chapter (five docs) derived from
  the manifest + document model; slot-path helpers already exist
  (`chapterStudyGuidePath`, `chapterSlidesPath`, …). `slotFor(path)`
  classification in `package-contract`.
- **S2. De-seed**: `createChapter` stops seeding welcome prose (manifest
  entry only — or seeds an EMPTY file only if a hard consumer requires
  existence; target is no file); remove first-open scaffolds
  (`hosted-actions.ts` slides seed, practice/concept-map equivalents in
  `studio-shell`); remove the two package content seeds
  (`SEED_CONTENT_PATHS`); move all welcome/starter prose to UI empty
  states. Template repo + `alembic-package` skill + `check_oer.mjs` +
  upload-contract updated in the same phase (spec-sync duty).
- **S3. Upsert Replace**: replace door becomes create-or-replace for slot
  paths; any picked filename normalizes to the canonical slot path with a
  confirmation ("Saved as Chapter 3 slides"); carrier-aware via H2. *(→ C4,
  C5)*
- **S4. Publish/site**: student site renders only non-empty slots; publish
  step skips empty slots; pristine test becomes "no content files"
  (`isPristinePackage` rewritten, populate seed-deletion special-case
  removed).
- **S5. Migration**: existing packages keep their current files (a seeded
  welcome file simply IS content now); optional Tidy offer to delete
  untouched scaffold files (recognized by exact seed content hash) — never
  automatic.

## Phase P — Populate & staging (D3)

- **P1. Staging bucket**: private Supabase Storage bucket `staging/` with
  signed upload URLs + TTL cleanup; client uploads the zip there, posts the
  storage path (kills the ~4.5 MB function-body ceiling). *(→ C7)*
- **P2. Repos-first populate**: plan (against repo head + registry) →
  commit public/private → project → registry. Idempotent: re-running
  replans and completes the remainder; the pristine gate becomes a
  plan-diff preview ("this will add/replace these files") with a Tier-3
  confirm; refusals list blockers and offer "empty this course and
  upload". *(→ C8)*
- **P3. Client truth**: distinct messages for size, plan issues, partial
  completion + resume; progress states for the multi-commit run.
- **P4 (deferred, worker lane)**: move populate execution to a queue job
  when the worker lane lands — same plan/commit functions, no logic fork.

## Phase V — Verification & coherence

- **V1. Adversarial test sweep**: commit-failure atomicity (nothing
  changed), manifest concurrency, carrier-extraction, populate resume,
  slot upsert path normalization, >1000-file package.
- **V2. Doc coherence pass**: Status, DecisionLog, upload-contract,
  package-layout, workspace specs, `alembic-package` skill, coursewerk
  landing contract — all reflect slots + write-through; remove
  placeholder-era language.
- **V3. Blind-critique run** per
  [blind-critique/README.md](blind-critique/README.md): operator prepares
  the environment; verifiers get the frozen acceptance spec blocks;
  free-roam critic gets the product promise; referee → fix → fresh-agent
  re-verify → record residue. The spec was frozen BEFORE this plan's
  implementation; amendments only visible+recorded.

## Sequencing

```
H1 H2 H3 H4  →  W1 W2  →  W3 (fan-out ×3) W4  →  S1..S5  →  P1 P2 P3  →  V1 V2 V3
   (days)        (core)      (parallel)         (slots)      (populate)    (accept)
```

Gates: typecheck + full tests + web build before every push (CI mirror);
each phase = commit(s) + Status.md update; H ships alone and immediately.

## Risks & watchpoints

- **Save latency regression** (W3): explicit UX decision recorded — visible
  saving state; measure; outbox refinement only if real users hurt.
- **Slot de-seed breaking hidden consumers** (S2): grep-audit every reader
  of seeded paths (site build, populate, tidy, tests) before removal.
- **Optimistic-concurrency retry storms** (W2): cap retries, surface
  conflict as reload prompt.
- **Spec drift**: the acceptance spec outranks implementation intent; a
  finding that faults the spec amends it visibly, never quietly.
