# Storage & Write-Path — modularized task plan

**Date:** 2026-08-28. Executable decomposition of
[StorageWritePathPlan.md](StorageWritePathPlan.md) into subtasks that are
**independently implementable and verifiable**, organized in **waves**:
tasks inside a wave own disjoint files and may run as concurrent subagents;
waves are sequential with an integrator gate between them. Conflict review
at the bottom — read it before executing.

## Execution status (updated 2026-08-28 by T42)

| Wave | Tasks | Status |
|---|---|---|
| **H** — hotfixes | TH1–TH4 | ✅ shipped (`c66f622`) |
| **0** — contracts & seams | T01–T03 | ✅ shipped (`72ebea6`) |
| **1** — adopt write-through | T11–T14, T14b | ✅ shipped (`0e5560a`, `b201577`) |
| **1.5** — consolidate prepare/validate | T15 | ✅ shipped (`b201577`) |
| **2** — slots, not placeholders | T21, T21b, T22, T23, T24 | ✅ shipped (`b201577`, `b522d7b`, `fe95e73`, `851bcef`) |
| **3** — populate & staging | T31, T32 | ✅ shipped (`851bcef`) |
| **4** — verification | T41 adversarial sweep | 🔄 in progress (uncommitted `*.adversarial.test.ts` files present in the working tree at the time of this update) |
| | T42 doc coherence pass | ✅ done (this update) |
| | T43 blind-critique round | ⬜ blocked on an operator-prepared environment ([blind-critique/rounds/README.md](blind-critique/rounds/README.md)) |

**Correction to the Wave-1 integrator greps (T42, verified at `851bcef`):** the
instruction "`mirrorManifestToSandbox` callers = 0 → delete it" was **not**
carried out, and should not be — it has exactly **one** caller,
`github-actions.ts:252`, which is the deliberately exempt publish/graduation
truth-flip. It stays for that path only. The genuinely dead code the grep should
have caught is `syncFilesToGitHub` / `syncPrivateFilesToGitHub`
(`apps/web/src/lib/github.ts:124,150`), which now have **zero** callers.

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
- **ALSO FIX (confirmed bug, found by T03 2026-08-28):**
  `renameChapterPageName` (`chapters.ts` ~line 296) moves only three file
  families — the study guide, `concepts/<slug>.json`, and
  `objectives/<slug>.json`. It does **not** move the four other slot
  documents (`concepts/<slug>.md`, `assessment-support/<slug>.md`,
  `slides/<slug>.md`, `practice/<slug>.md`), so renaming a chapter's page
  name **orphans four of its five documents** at the old slug — they
  vanish from the chapter and linger as stray files. Use
  `chapterSlotPaths()` (new, from `@alembic/package-contract` — T03) to
  build the move list from the slot table so the set can never drift
  again; keep the `.json` planning families as extra moves. Add a
  regression test: create chapter, write all five documents, rename the
  page name, assert all five moved and none remain at the old slug.
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

### T14 — Remaining writers (added 2026-08-28 by integrator after a full
call-site inventory; the original three tasks covered only 13 of 26 sites)
- **Owns:** `planning-actions.ts`, `asset-actions.ts`,
  `assessment-actions.ts`, `change-actions.ts`, `adapt-actions.ts`,
  `apps/web/src/app/workspace/lifecycle-actions.ts`.
- **Do:** same migration as T11–T13 — every `syncFilesToGitHub` /
  `syncPrivateFilesToGitHub` + preceding `putFiles` pair becomes one
  `writeThrough` call; manifest mutations (lifecycle rename) go through
  `updateManifest`. `change-actions` (Tier-1/2 apply + undo) and
  `adapt-actions` (fork, adapt, suggest-back, upstream updates) are the
  trust-critical ones: their accept/undo paths must be atomic — a failed
  commit must leave the change queue row unresolved, not half-applied.
- **Accept:** E2 (restore/undo), F3 (adapt), G2 (review apply).
- **Watchpoint:** `adaptFromPortalAction` / `forkOwnPackageAction` create a
  NEW package — that is a graduation-class bulk write; keep its existing
  creation path and migrate only its post-creation writes.

### T14b — `PackageOps` return-type widening (integrator-added, small)
- **Owns:** `packages/package-ops/src/ops.ts`.
- **Do:** `renameChapter` / `reorderChapters` / `deleteChapter` in the
  `PackageOps` interface return `Promise<void>`, which forced T11's
  equivalents to stay void and the web actions to re-read the manifest
  after each call. Widen them to return the updated manifest (as
  `createChapter` and `renameChapterPageName` now do) and drop the
  re-reads in `chapter-actions.ts`. Purely mechanical; typecheck proves it.

### T15 — Consolidate the prepare/validate half (integrator-added
2026-08-28, after T12/T13 reports; runs as a Wave-1.5 cleanup)
- **Owns:** `packages/package-ops/src/editor-edit.ts`, `study-guide.ts`,
  `slides.ts` (+ their tests); `apps/web/src/lib/editor-save.ts`,
  `apps/web/src/app/workspace/[packageId]/import-prepare.ts`,
  `apps/web/src/app/workspace/[packageId]/actions.ts`.
- **Why:** Wave 1 had to separate *validate* from *persist* (writeThrough
  commits before projecting, so the old `applyEditorEdit`-then-sync order
  is illegal). Lacking a package-ops export, T12 and T13 each recreated the
  validation locally — so the block-ID + `TEXT_EXT` rules now live in FOUR
  places (`editor-edit.ts`, `write-through.ts`, `lib/editor-save.ts`,
  `import-prepare.ts`). Rule 3 says there is one validated write path;
  four copies of its validator is that rule decaying.
- **Scope EXPANDED (T14 report, 2026-08-28):** the projects-before-commit
  problem is not limited to editor saves. These package-ops functions all
  compute content *and* project it, so any caller that then commits has the
  projection ahead of the repo — and `CommitFailedError`'s "nothing was
  changed" copy is then not literally true: `saveStudyGuide`, `writeAsset`,
  `adaptBlocksInto`, `adaptGivenBlocksInto`, `adaptAssetInto`,
  `applyUpstreamUpdate`, `applyEditorEdit`, `saveQuestionItem`,
  `saveAnswerKey`, `applyProposedChangeSet`. **Constraint discovered by
  T14:** `batchAcceptReviewAction` RELIES on the current projecting
  behavior to accumulate several accepted changes onto one file in order,
  so the prepare/persist split must keep an in-order staging story (a
  `prepare` that takes the pending in-memory state, not just the store).
- **Do:** export validate-only `prepareEditorEdit` / `prepareStudyGuideSave`
  / `prepareSlidesSave` (and the equivalents for the list above) from
  package-ops; re-express `applyEditorEdit` /
  `saveStudyGuide` / `saveSlidesDeck` as `prepare + putFiles` (behavior
  identical, tests unchanged); collapse the two web copies to thin
  re-exports. **Also migrate the orphan** `saveStudyGuideAction` in
  `apps/web/src/app/workspace/[packageId]/actions.ts:28` — still
  store-first + best-effort commit, owned by no Wave-1 task (found by T12),
  and **still live**: `studio-shell.tsx:1646` calls it, so it is a real
  remaining silent-divergence path, not dead code.
- **Accept:** B4, B5, E1 (closes the last silent local-only save path).

**Call-site inventory (2026-08-28):** collection-actions 8 · change-actions
8 · adapt-actions 6 · populate route 6 (Wave 3) · term-actions 5 ·
metadata-actions 4 · import-actions 3 · edit-actions 3 · lifecycle 2 ·
planning 2 · hosted 2 · asset 2 · assessment 2. Publish/graduation in
`github-actions.ts` is exempt (the deliberate truth-flip).

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
- **ALSO FIX (third instance of the slot-drift bug family, found by T11
  2026-08-28):** `deleteChapter` deletes only the study-guide file, so
  deleting a chapter **orphans its other four slot documents** (concept
  map, assessment guide, slides, practice) as stray files in the repo.
  Same fix as the rename: derive the delete set from `chapterSlotPaths()`
  + the two `.json` planning records, deleting only paths that exist.
  Regression test mirroring T11's rename test (write all seven, delete the
  chapter, assert nothing keyed to that slug remains).
- **Accept:** B3 (no boilerplate-as-content), A3, B2 (delete).
- **Watchpoint (audit done 2026-08-28 by integrator — act on it):**
  `chapters.ts` derives `IMPLICIT_CHAPTER_SLUG` from
  `DEFAULT_STUDY_GUIDE_PATH`, and `effectiveChapters()` materializes that
  implicit chapter whenever `manifest.chapters` is empty. **If package
  seeding is removed without also writing an explicit `chapters: [...]`
  entry at creation, a fresh package shows a phantom chapter pointing at a
  file that does not exist.** So `createSandboxPackage` MUST write one
  explicit first chapter into the manifest (no file), and the
  implicit-chapter fallback stays only for legacy packages.
  Other consumers to check: `study-guide.ts` default arg,
  `github-actions.ts:291`, `adapt-actions.ts:263`, and
  `study-guide.test.ts` / `chapters.test.ts` expectations.

### T21b — Slot vocabulary bridge (web)
- **Owns:** `apps/web/src/app/workspace/[packageId]/edit/nav.ts`.
- **Do:** map the UI's `ChapterDoc` union (which calls the study guide
  `"content"`) onto the contract's `ChapterSlot` (`"study-guide"`) with an
  explicit `Record`, so a missing/renamed slot is a compile error; replace
  `edit/page.tsx`'s ad-hoc `assessment-support/${slug}.md` /
  `concepts/${slug}.md` path building with `slotPath()`. (Found by T03:
  two vocabularies + hand-built paths in the page component.)
- **Note:** `edit/page.tsx` is shared with T23/T32 — T21b touches ONLY the
  path-building lines; integrator merges.

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
- **REQUIRED (integration note from T22, 2026-08-28):** `DocumentActionsBar`
  must render for a chapter document **even when it has no file yet** —
  otherwise the C4 upsert (replace/upload into a never-opened document) has
  no door in the UI and the fix is unreachable.
- **Accept:** B3, B4 first-edit flow, C4 (reachability).

### T24 — Publish/site skip empty slots + spec sync
- **Owns (renderer):** `course-site` types/build; **(web)**
  `site-actions.ts` inputs; **(docs/skills)** `alembic-package` SKILL,
  `upload-contract.md`, `package-layout.md`, template repo notes.
- **Scope narrowed (integrator audit 2026-08-28):** the site build ALREADY
  skips empty slides (`site-actions.ts:285` `authored.source.trim()`) and
  empty practice (`:307` `practiceMarkdown.trim()`), and the renderer
  already emits the links conditionally
  (`course-site.ts:464-465`). So T24's remaining site work is only: (a)
  confirm/handle an EMPTY OR ABSENT study guide (does a chapter with no
  study-guide file still get a page?) — that is the one unverified slot;
  (b) mirror whatever it does in `site-preview/page.tsx:129-133`, which
  duplicates the same decisions. Do NOT rewrite the working slides/practice
  logic.
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
- **Also owns (integrator note 2026-08-28):**
  `apps/web/src/app/workspace/[packageId]/edit/page.tsx` line ~74 — the
  second `isPristinePackage` consumer (it gates the "this course is empty"
  populate CTA). It must move to the same replacement predicate, or the
  CTA logic and the upload gate will disagree.
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

## Performance follow-up — the registry rebuild on WRITES (2026-08-28)

Page loads no longer rebuild the registry (they compare paths — two
content-free queries — and rebuild only when the path set actually moved).
**Writes still do a full rebuild**: `syncPackageRegistry` → 
`rebuildPackageRegistry` reads every file's content and performs one database
round-trip **per file**, so a single save on a 333-file course does hundreds of
serialized queries. There are 13 call sites.

**Do:** register only the files the write actually touched — give
`syncPackageRegistry` an optional `paths` argument and have `writeThrough`'s
callers pass their own change set — falling back to the full rebuild only for
populate/reconcile, where the whole package legitimately changed. The pieces
exist (`registerFile` is already per-file); this is plumbing, not design.

## Open findings from the adversarial sweep (T41, 2026-08-28)

Four of the seven findings were fixed at the gate (F1 duplicate paths in one
change set, F2 the v1-only reference guard, F3 out-of-contract repo values,
F5 truncated carriers). Three remain, deliberately:

- **F4 — a failed manifest commit during `renameChapterPageName` leaves all
  five documents under the NEW slug while the manifest still names the old
  one.** Verified recoverable: a plain retry finds nothing at the old paths,
  moves nothing, and updates the manifest — it converges. But the
  ordering-rule comment in `chapters.ts` undersells this case ("at worst an
  empty slot" is true for delete, not for rename). **Do:** correct the
  comment and surface an educator-facing "try that again" prompt on this
  specific failure.
- **F6 — `matchScriptById` (`packages/carriers/src/html.ts`) reads the island
  opening tag with `<script\b([^>]*)>`,** so a `>` inside an attribute value
  (e.g. `data-x="a > b"`) makes extraction compute the body from the wrong
  offset and **succeed with markup bleeding into the "source"**. Not live
  (Alembic's writers emit fixed attributes), but silent success is the wrong
  failure mode for a door. **Do:** parse the tag properly or fail closed.
- **F7 — `SupabaseSandboxStore.replaceFileIf` puts the ENTIRE expected content
  into a PostgREST filter** (`.eq("content", …)`), i.e. into the request URL's
  query string. A course with many chapters can push the manifest past typical
  URI length limits (HTTP 414). Today's manifests are small, so this is a
  scale bug, not a live one. **Do:** add a `content_sha` column (the additive
  `0021` migration anticipated in T02) and CAS on the hash, or move the
  compare-and-swap into an RPC that takes the content in the body.

## Cross-repo follow-up (owner decision needed, 2026-08-28)

**Coursewerk `check_oer.mjs:186-190` still ERRORS** where Alembic now warns:
*"Chapter … is declared but its study guide … is missing."* CLAUDE.md requires
`package-contract`, `release-gates`, the `alembic-package` skill, and
coursewerk's `check_oer.mjs` to stay in sync, so the two are now out of step
on exactly this rule.

Arguably defensible as-is: coursewerk is a **producer** and may hold itself to
stricter completeness than the platform accepts (its other quality-lane
presence rules at `:464-472` are producer-only by design). The question is
whether a declared-but-unwritten chapter should block a coursewerk run the way
it no longer blocks an Alembic import. **Not changed here** — coursewerk is a
separate repository and this is a product call, not a mechanical sync.

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
