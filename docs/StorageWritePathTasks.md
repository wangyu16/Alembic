# Storage & Write-Path — modularized task plan

**Date:** 2026-08-28. Executable decomposition of
[StorageWritePathPlan.md](StorageWritePathPlan.md) into subtasks that are
**independently implementable and verifiable**, organized in **waves**:
tasks inside a wave own disjoint files and may run as concurrent subagents;
waves are sequential with an integrator gate between them. Conflict review
at the bottom — read it before executing.

## Execution protocol (applies to every wave)

- **One owner per file per wave.** A task may edit only the files it owns
  (listed per task). Barrel files (`packages/*/src/index.ts`) are NOT owned
  by tasks: each task states its needed exports in its report; the
  **integrator** adds them.
- **Interfaces freeze at Wave 0.** Later waves consume `writeThrough`,
  `updateManifest`, the `Committer` interface, CAS, and the slot API
  additively — no signature changes without stopping the run.
- **Every task ships its own tests** beside the source (vitest), red→green
  in-task. Anything touching the public/private boundary adds adversarial
  cases, not just happy-path.
- **Integrator gate per wave:** merge task outputs → resolve barrels →
  `pnpm typecheck && pnpm test && pnpm --filter @alembic/web build` → grep
  checks listed for the wave → commit + push + Status.md update (one commit
  per wave, or per task for Wave H).
- Subagent prompts carry: the task section below verbatim, the two specs
  ([storage-and-write-paths.md](specs/storage-and-write-paths.md),
  [educator-version-contract.md](specs/educator-version-contract.md)), the
  file-ownership list, and the rule "extend, never re-design; report
  needed barrel exports instead of editing barrels."
- Acceptance-spec references (A1…H5) are from
  [blind-critique/acceptance-spec.md](blind-critique/acceptance-spec.md).

---

## Wave H — hotfixes (4 tasks, concurrent; ship immediately)

### TH1 — Manifest-clobber stop
- **Owns:** `apps/web/src/app/workspace/[packageId]/metadata-actions.ts`,
  `a11y-actions.ts`, `term-actions.ts`; new
  `apps/web/src/lib/manifest-read.ts` (+ test).
- **Do:** add pure helper `manifestFromFiles(files)` (find `alembic.json`
  public row → `parseManifest`; throw if absent) in `manifest-read.ts`.
  Every manifest write in the owned actions starts from the FILE manifest
  via this helper — never `record.manifest` — then writes file + column +
  commit as today. Unit-test the helper; add a regression test in
  `packages/package-ops` (memory store): createChapter → patch manifest the
  way setCourseInfo does (file-based) → listChapters keeps the chapter.
- **Accept:** B7. **Done:** no owned action reads `record.manifest` as a
  write input (grep proves it).

### TH2 — Replace-door carrier extraction
- **Owns:** `packages/package-ops/src/incoming-text.ts` (+ test),
  `apps/web/src/app/workspace/[packageId]/collection-actions.ts`.
- **Do:** pure `normalizeIncomingText(targetPath, content)`: if target is
  plain-text/markdown and content `hasCarrier` → return extracted source;
  extraction failure → typed error (plain-language message at the action).
  Wire into `replaceCollectionFileAction` (and `saveCollectionFileAction`
  if it accepts pasted carriers). Tests: `.md.html`→`.md` replace stores
  the markdown source byte-exact; corrupt island refused; binary targets
  untouched.
- **Accept:** C3, C6.

### TH3 — listFiles pagination
- **Owns:** `apps/web/src/lib/sandbox-store.ts` (+ test file).
- **Do:** `.range()` loop (page size 1000) until short page; preserve
  ordering-insensitivity. Test with a mocked client returning 2½ pages.
- **Accept:** underpins C7 on large packages.

### TH4 — Chapter sync made loud + column refresh
- **Owns:** `apps/web/src/app/workspace/[packageId]/chapter-actions.ts`.
- **Do:** after each chapter op, refresh the `packages.manifest` column
  from the file (the `setUnitTermAction` pattern, factored local). Replace
  silent mirror-skip: when there is no GitHub client or `commitFiles`
  throws, return `{ok: true, warning: "Saved here, but not to GitHub yet —
  use Save to GitHub to catch up."}` (educator-visible), never silence.
- **Accept:** B1, B6, B8 (interim form).

**Wave-H integrator greps:** no `record.manifest` spread into a manifest
write outside lifecycle/publish; no bare `if (!gh) return;` left in owned
files.

---

## Wave 0 — contracts & seams (3 tasks, concurrent)

### T01 — write-through core (single agent; the largest task)
- **Owns (package-ops):** new `write-through.ts`, new `manifest-ops.ts`,
  `store.ts`, `memory-store.ts`; **(web)** `sandbox-store.ts` (CAS impl —
  sequential after TH3, same wave OK since Wave H already merged).
- **Do:**
  1. `PackageStore` gains `replaceFileIf(packageId, repo, path,
     expectedSha256 | null, content): Promise<"ok"|"conflict">` (null =
     create-only). Implement in memory store + Supabase store (UPDATE …
     WHERE hash matches via a stored `content_sha` column — see T02's
     migration — or compare-and-swap on content equality).
  2. `Committer` interface: `commit(plan: {repo, summary, changes}) →
     {commitSha}` + typed `CommitUnavailableError` / `CommitFailedError`.
  3. `writeThrough(store, committer|null, packageId, changes, summary)`:
     validate (two-repo + references + block anchors via existing
     validators) → published: commit FIRST, then project store from the
     committed changes, return sha for `recordSyncedSha`; trial
     (committer null): project only. Commit failure = store untouched,
     typed error out.
  4. `updateManifest(store, committer|null, packageId, patchFn)`: read
     file manifest → `patchFn` → CAS write (retry ≤3 on conflict,
     re-reading) → column update happens at the WEB layer via a returned
     `manifest` (package-ops stays IO-pure re: Supabase tables beyond the
     store interface).
- **Tests:** commit-failure atomicity; CAS conflict retry (two interleaved
  updates both land); trial branch; adversarial: private path in a public
  plan is rejected before any commit.
- **Accept:** underpins B4, B5, B8.

### T02 — DB migration + web committer
- **Owns:** new `supabase/migrations/00XX_content_sha_staging.sql`, new
  `apps/web/src/lib/committer.ts`, new `apps/web/src/lib/staging.ts`.
- **Do:** migration: `sandbox_files.content_sha` (nullable, backfilled
  lazily) if T01 needs it + `staging` storage bucket (private, RLS
  owner-only, TTL note in Deployment doc). `committer.ts`: implements
  `Committer` over `clientForUser` + `commitFiles` + `recordSyncedSha` —
  the ONLY new web→github-bridge seam (bridge stays sole GitHub caller).
  `staging.ts`: signed-URL create/read/delete helpers (used in Wave 3).
- **Watchpoint:** migration is additive-only; deploy before Wave 1 code.

### T03 — Slot contract
- **Owns (package-contract):** new `slots.ts` (+ test).
- **Do:** declared slot set per chapter {concept-map, study-guide, slides,
  assessment-guide, practice} with canonical path builders (delegating to
  existing helpers), `slotForPath(path)` classifier, `isSlotPath`. Pure;
  no behavior change anywhere yet.

**Wave-0 integrator:** barrels updated; migration applied to dev; full
gate.

---

## Wave 1 — adopt write-through (3 tasks, concurrent)

### T11 — Chapter & manifest writers
- **Owns:** `chapter-actions.ts`, `metadata-actions.ts`, `term-actions.ts`,
  `a11y-actions.ts`; `packages/package-ops/src/chapters.ts`.
- **Do:** all manifest mutations go through `updateManifest` (+ column
  refresh from its return); chapter file writes through `writeThrough`
  with the web committer; TH1/TH4 interim shims removed. Failures surface
  as retryable plain-language errors; no more best-effort mirrors.
- **Accept:** B1, B2, B6, B7, B9.

### T12 — Editor saves
- **Owns:** `edit-actions.ts`, `hosted-actions.ts` (save paths only; do
  NOT touch its scaffold seeding — Wave 2's).
- **Do:** `saveFileAction` + hosted save use `writeThrough`; responses
  distinguish saved / failed-retryable; minimal saving-state contract for
  the UI (fields, not UI work).
- **Accept:** B4, B5, E1.

### T13 — Collections & import writers
- **Owns:** `collection-actions.ts`, `import-actions.ts`.
- **Do:** upload/replace/rename/delete/create + import writes through
  `writeThrough` (binary encoding preserved); delete the per-action
  `syncFilesToGitHub` calls.
- **Accept:** C1, C3 (write side), E4 unchanged.

**Wave-1 integrator greps:** zero remaining direct `syncFilesToGitHub` /
`syncPrivateFilesToGitHub` callers outside `committer.ts`, github-actions
(publish/graduation — explicitly exempt, it IS the truth-flip), and
populate route (Wave 3 rewrites it); `mirrorManifestToSandbox` callers = 0
→ delete it (integrator edit in `github.ts`); every commit path records a
SHA (W4 audit).

---

## Wave 2 — slots, not placeholders (4 tasks, concurrent)

### T21 — De-seed package & chapter creation
- **Owns (package-ops):** `create.ts`, `chapters.ts` (seed parts),
  `tidy.ts` (optional scaffold-cleanup op).
- **Do:** `createSandboxPackage` seeds scaffold only (no welcome content
  files, no private starter note); `createChapter` writes the manifest
  entry only — no seeded study-guide file. `SEED_CONTENT_PATHS` retained
  (populate + pristine still reference it for OLD packages) but marked
  legacy. **Do NOT change `isPristinePackage`** (Wave 3 owns that gate).
  Optional tidy op: delete a file whose content hash equals a known seed
  and was never edited — offered, never automatic.
- **Accept:** B3 (no boilerplate-as-content), A3.
- **Watchpoint:** grep every consumer of seeded paths first
  (`DEFAULT_STUDY_GUIDE_PATH` readers, site build, tests) and fix
  expectations of file-existence → slot-existence.

### T22 — Upsert Replace + name normalization
- **Owns:** `collection-actions.ts` (replace/create only — T13 finished
  its write-path migration last wave), `replace-file-button.tsx`,
  `document-actions-bar.tsx`.
- **Do:** replace on a slot path becomes create-or-replace
  (`replaceFileIf` with null-or-current); uploading any filename via a
  slot's UI normalizes to the canonical slot path and says so ("Saved as
  Chapter 3 slides"). Non-slot collection files keep replace-only
  semantics.
- **Accept:** C4, C5.

### T23 — Empty states & de-scaffold the shell
- **Owns:** `studio-shell.tsx` (sole owner), `hosted-actions.ts` (scaffold
  parts), collection view components' empty states.
- **Do:** remove first-open seeding (slides template, practice scaffold,
  concept-map scaffold) — editors open on empty content with UI-level
  starter guidance (the former scaffold prose moves into the empty-state
  UI, insertable by a click, not silently written). A doc with no file =
  clearly "not started yet".
- **Accept:** B3, B4 first-edit flow.

### T24 — Publish/site skip empty slots + spec sync
- **Owns (renderer):** `course-site` types/build; **(web)**
  `site-actions.ts` inputs; **(docs/skills)** `alembic-package` SKILL,
  `upload-contract.md`, `package-layout.md`, template repo notes.
- **Do:** site build receives only slots with content; nav omits empty
  docs; update the authoring skill + contracts: per-chapter docs OPTIONAL
  (absence = not-started, never an error), no placeholder expectations.
  Coursewerk note: it already ships lean/no placeholders — confirm
  `check_oer.mjs` alignment in the doc.
- **Accept:** D3, D2.

**Wave-2 integrator:** fresh-package E2E sanity (create → add chapter →
open each doc → save one → publish flow dry-run in tests).

---

## Wave 3 — populate & staging (2 tasks, sequential)

### T31 — Staging intake
- **Owns:** `populate-package.tsx`, new
  `apps/web/src/app/api/staging-url/route.ts`.
- **Do:** client requests signed URL (auth’d, owner-scoped) → uploads zip
  direct to the bucket (kills the ~4.5 MB function-body cap) → posts
  `{packageId, stagingPath}`. Distinct client messages: too large,
  network, plan issues, partial+resume. Progress states.
- **Accept:** C7 (size), C8 (message quality).

### T32 — Repos-first resumable populate (after T31)
- **Owns:** `packages/package-ops/src/populate-package.ts`,
  `packages/package-ops/src/create.ts` (`isPristinePackage` → plan-diff
  replacement), `apps/web/src/app/api/populate-package/route.ts`.
- **Do:** route reads zip from staging; plan against **repo head +
  registry** (not just store); order: commit public → commit private →
  project store → registry → permalink rewrite pass (unchanged logic) →
  delete staging object. Idempotent re-run: replans, skips
  already-committed identical files, completes the remainder. Gate:
  pristine test replaced by a **plan-diff preview** (adds/replaces
  listed) + explicit confirm; refusals name blockers and offer "empty
  this course and upload" (Tier-3 confirm, wipes content files via
  writeThrough deletes).
- **Accept:** C7, C8. **Watchpoint:** stay within `maxDuration` by
  chunked commits; rely on resume for overruns (worker-lane P4 later).

---

## Wave 4 — verification (2 concurrent + the review)

### T41 — Adversarial sweep
- **Owns:** new test files only (any package; no source edits — findings
  become integrator fixes).
- **Do:** cross-cutting tests: commit-failure atomicity end-to-end;
  manifest CAS under interleaving; slot upsert normalization; populate
  resume; >1000-file store; carrier-extraction fuzz (island variants);
  private-leak attempts through every new door.

### T42 — Doc coherence pass
- **Owns:** docs only. Status, DecisionLog, Roadmap module notes,
  workspace specs — placeholder-era language removed; version-contract
  cross-refs verified; Deployment doc gains bucket TTL + migration order.

### T43 — Blind-critique round
- Per [blind-critique/README.md](blind-critique/README.md). Operator
  prepares environment; fresh context-denied verifiers; referee → fix →
  fresh re-verify; report under `docs/blind-critique/rounds/`.

---

## Conflict review (performed 2026-08-28, pre-execution)

**Hotspots & resolutions**
1. **Barrel files** (`packages/*/src/index.ts`) — multiple same-wave tasks
   need exports → barrels are integrator-owned; tasks only report needs.
2. **`github.ts`** — consumed by every Wave-1 task while its helpers are
   being obsoleted → resolved by *adding* `committer.ts` in Wave 0 (old
   helpers untouched), migrating callers in Wave 1, deleting dead helpers
   at the Wave-1 integrator step only after a zero-callers grep.
3. **`collection-actions.ts`** — needed by TH2 (Wave H), T13 (Wave 1),
   T22 (Wave 2): sequential waves, single owner in each → no conflict;
   T22's scope is explicitly limited to replace/create.
4. **`hosted-actions.ts`** — T12 (save paths, Wave 1) vs T23 (scaffold
   removal, Wave 2): sequential + disjoint functions; T12 is forbidden to
   touch seeding.
5. **`studio-shell.tsx`** (2.8k lines) — exactly one owner ever (T23).
6. **`isPristinePackage` timing** — de-seeding (Wave 2) does NOT break the
   old gate: a package with zero seed files still passes the
   scaffold-only test, and legacy packages keep their seeds → gate stays
   valid until Wave 3 replaces it. Verified against `create.ts` logic.
7. **Graduation path** — `publishToGitHubAction` is the deliberate
   truth-flip bulk write; explicitly EXEMPT from writeThrough migration
   (documented in spec §3); Wave-1 grep whitelist includes it.
8. **Migration ordering** — `content_sha` + bucket migration (T02) is
   additive and must be applied to prod before Wave-1 deploy; recorded in
   Deployment doc by T42.
9. **Reconcile** — untouched by design; with W4's every-commit-records-SHA
   audit, its foreign-commit detection only gets more precise. Absorb
   writes bypass writeThrough legitimately (repo→projection direction).
10. **Save latency** — behavior changes at T12 before UI polish (T23):
    T12 must ship at least a disabled-button saving state; acceptance B4
    judges the visible state, so it cannot be deferred silently.
11. **Two-tabs (H3 acceptance)** — file saves remain last-write-wins, but
    every save is a recorded version (E1/E2) → loss is recoverable, not
    silent; judged acceptable against the spec. Manifest gets CAS (the
    dangerous case). Recorded here so it isn't re-litigated mid-build.
12. **Vercel `maxDuration` residual** — populate can still hit 60 s on
    slow GitHub days; resume (T32) makes that survivable; full fix is
    worker-lane P4 (deferred, recorded).
13. **Acceptance-spec freeze** — no task may edit
    `blind-critique/acceptance-spec.md` except via its Amendment log with
    a dated entry; integrator enforces by diff check each wave.

**Confirmed:** with the two structural adjustments (committer moved to
Wave 0; pristine-gate untouched until Wave 3), every wave's tasks are
file-disjoint, interfaces freeze before consumers spawn, and no task can
break a not-yet-migrated path. Ready for concurrent execution.
