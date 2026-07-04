# Alembic Roadmap — the 2026-07 module plan

**Status:** direction locked with the owner (2026-07-04). Supersedes the
phase-based 2026-06 roadmap ([archive/Roadmap-2026-06.md](archive/Roadmap-2026-06.md));
everything that plan built (phases 0–7, v0.1 deployed) stands and is
tracked in [Status.md](Status.md). This plan organizes the **next era**
around the self-contained-editing direction: the four owner-named elements
become five modules plus one cross-cutting enabler, with explicit seams so
they can be built independently without future conflict.

Governing specs: [SteeringNote.md](SteeringNote.md) ·
[specs/self-contained-editing.md](specs/self-contained-editing.md) ·
[specs/document-model.md](specs/document-model.md) ·
[specs/permalinks-and-registration.md](specs/permalinks-and-registration.md) ·
[specs/workspace-framework.md](specs/workspace-framework.md).

## The conflict-avoidance rules (read first)

Modules stay independent because each concern has exactly one owner:

1. **One schema owner.** All contract changes (registration record, spaces,
   `.md.html` as chapter source of record) land as **package-contract v2**
   in Module R — once, with an explicit versioned migration. No other
   module touches the schema; they consume it.
2. **One write path.** Every write — in-place edit, upload, AI edit,
   reconcile absorb — goes through `packageOps` validation. Editors,
   inboxes, and AI never gain a side door.
3. **One metadata source.** The registration record (a rebuildable
   Supabase projection of repo content) is the *only* place file metadata
   lives. Permalinks, discovery, notifications, version lists, and the
   student site index all read it; none keeps a private index.
4. **One editor seam.** Editing surfaces mount only through
   `@alembic/editor-kit` (`EditorModule`/`EditorHandle`). Adding a format =
   registering a module; the shell never special-cases a format.
5. **One inbox.** Everything that asks the educator for a decision —
   Tier-2 AI review, element update/keep notices, suggest-backs, external
   change reports — is an item in a single workspace Inbox with one item
   contract (kind, summary, diff/preview, actions). New decision types add
   a kind, not a surface.
6. **AI stays behind `AIProvider`** + the change-tier queue. AI features
   are verbs on files through the same write path — never a parallel
   document model. (Keeps Module I deliberately flexible.)
7. **The student site is a renderer concern.** Site structure/UX lives in
   `@alembic/renderer` (`course-site`) + worker builds; the workspace only
   decides *what is public*, never how the site looks.

## Module R — Registry: the document contract in code

*Owner element: "file contract of all types — create in place, upload to
workspace, or upload to GitHub source, all registered correctly."*

- **R0. Package layout spec** — the on-disk contract
  ([specs/package-layout.md](specs/package-layout.md)): folder structure,
  naming rules, manifest, so a package authored entirely outside Alembic
  registers automatically on adoption (+ a template repository as
  executable documentation).
- **R1. Contract v2** (`package-contract` + write paths): registration
  record (docId, path, **space**, kind, format version, source hash,
  provenance origin, license, description/alt-text, `discoverable`,
  permalink class, per-version `changeKind`); the v2 **layer set** — in v2,
  layers and spaces converge: `study-guide` / `slides` / `practice` /
  `concepts` / `assessment-support` / `assets` (renames `materials`) /
  `current` / `metadata` / `provenance` public, `private` (renames
  `private-instructor`, becomes the private-repo root); **chapter study
  guide = one `.md.html` file** (source embedded). Block IDs: *malformed or
  duplicate* IDs still reject a save; *missing* IDs are now legal (anchors
  are optional). Adaptation lineage: whole-package fork sets package-level
  `adaptedFrom` (files inherit); copying an individual file sets file-level
  lineage; permalink *reference* inserts set none (no new ID).
  **Known code touchpoints** (from the 2026-07-04 code audit): `layers.ts`
  allowlist + repo split; `validate.ts` carrier check (`materials/` →
  `assets/`); `reconcile.ts` + `editor-edit.ts` must extract carrier source
  for `.md.html` (today they only parse `study-guide/*.md`); carriers
  registry gains the `paged` kind **and a plain-media fallback** (`.png`,
  `.jpg`, `.pdf`, `.mp3`, … register as generic media assets instead of
  failing classification); hardcoded `private-instructor/` paths in
  adaptation/assessments. Explicit v1→v2 migration; v1 packages stay
  readable.
- **R2. Registry projection**: `documents` table (RLS), rebuildable from
  repos; registration hooks in all three doors — packageOps create/save
  (in place), the upload path, and `reconcilePublicRepo` (direct GitHub
  commits). Tombstones for deletions.
- **R3. Version listing**: per-file dated history (from Git / sandbox
  saves) + content-hash version ids; package snapshots unchanged.
- *Definition of done:* the same file uploaded, created, or committed
  externally produces byte-identical registration records; deleting and
  recreating never reuses a docId.

## Module E — Editing experience (FIRST)

*Owner element: the editing UX; also workspace-framework.md §3.*

- **E1. Editor hosting**: mount the orz-family in-file editors through
  `editor-kit` — orz-mdhtml (`.md.html`), orz-slides (`.slides.html`),
  orz-paged (`.paged.html`) — in the shell's editor pane; saves return
  through `applyEditorEdit`. (Ketcher/plot modules already prove the seam.)
- **E2. The minimal text editor**: plain `.md` files (concept maps,
  assessment guide) get a simple source editor with a rendered-view toggle
  — the one editing surface Alembic itself provides.
- **E3. Study-guide switchover**: chapter study guide becomes one
  `.md.html` file edited in-file (needs R1's source-of-record change);
  the interim block editor retires at parity. Practice questions follow
  (same format).
- **E4. Spaces UI**: Assets / Current / Private become real file managers
  (list, upload, organize, per-file actions); Current gains semester
  archiving when R1 lands.
- **E5. Full-height, distraction-free pass** (impeccable) over the shell
  once E1–E4 settle.
- *Definition of done:* an educator edits every file type in its own
  editor inside the shell; no block-level save path remains.

## Module P — Permalinks, sharing, adaptation

*Owner element: "version control, sharing, adapting mechanism."*

- **P1. Resolver**: `/d/{docId}` (live → 302 to Pages for public;
  platform-served for private/trial/pinned), `/d/{docId}@{version}`
  (content-hash pins), `/p/{packageId}[@snapshot]`; permalink stamped into
  generated files; `livePermalink()`/`pinnedPermalink()` re-emit `/d/`
  forms.
- **P2. Share this**: per-file opt-in discoverability (Tier-3 spirit);
  element index feeds Discover's Elements scope (excludes `current`,
  never `private`).
- **P3. Insertion registry + notices**: pinned-at-insert references
  extracted on save/reconcile; correction/fork notices with
  update / keep / switch-to-fork — delivered as Inbox items (Module T).
- **P4. File-level adaptation**: adapt/pull-updates/suggest-back
  re-anchored from blocks to files (block anchors assist AI merges);
  fork lineage via `adapted-from`.
- *Definition of done:* the owner's illustration story works end to end —
  publish small → discover → insert → correct → notify → fork → choose.

## Module T — Trust surfaces: Inbox + versions (complete UI/UX redesign)

*Owner ruling: review queue, accessibility, assessments, adaptation,
planning, per-chapter history, reconcile banner are **good features whose
UI/UX must be redesigned completely** — re-land per the new design, never
port the old panels.*

- **T1. The Inbox** (one surface, rule 5): Tier-2 AI proposals,
  element notices (P3), suggest-backs, and "changed outside Alembic"
  reconcile reports — each an item with preview/diff + educator-language
  actions. Undoable Tier-1 log lives here too. **Notice taxonomy for
  external changes:** content change to a discoverable/referenced file →
  Inbox item; invariant violation → publish-blocking quarantine notice;
  valid rename/move → silent re-registration; delete → tombstone (silent
  unless referenced).
- **T2. File history**: per-file dated version list + restore, in the
  file's context (replaces the old per-chapter history panel).
- **T3. Checks as status, not panels**: accessibility/reference/ID checks
  run at registration and publish gates; surfaced as per-file badges +
  fix-with-AI Inbox items (replaces the a11y panel).
- **T4. Assessments & planning surfaces**: re-designed homes — the
  assessment-guide *file* is already editable in its category (that stays
  the interim); richer blueprint/template and concept-map planning tools
  return later as category-scoped surfaces, not side panels.
- *Definition of done:* every parked feature from workspace-framework.md
  §2 is reachable again, through Inbox/badges/categories — zero legacy
  panel layouts.

## Module I — AI incorporation (deliberately open)

*Owner element: "no clear idea yet — keep future design flexible."*

- **I1. Preserve the seams** (rule 6): `AIProvider`, change tiers,
  entitlements, the worker/agent-harness boundary. No new AI surface
  commitments now.
- **I2. Single affordance interim**: the existing "Ask AI"
  propose→diff→approve per pane stays as the only AI UI; its approvals
  route through the Inbox once T1 exists.
- **I3. Design session later**: when the owner's picture firms up, AI UX
  gets its own spec — everything it will need (validated writes, tiers,
  Inbox, registry) exists by then. Explicitly out of scope until called.

## Module S — Student site (public static website)

*Owner element: "well organized, intuitive to find what a student needs."*

- **S1. Information architecture**: course index organized per the
  document model — study guide central; per chapter: study guide, slides,
  practice; downloads offered as the self-contained files themselves;
  Current-term section shown/hidden per instructor.
- **S2. Design pass** (impeccable, brand register): typography/navigation
  for reading, not authoring; orz-markdown 1.3.1 themes; LRMI markup
  stays; copy-as-source works on every page.
- **S3. Build pipeline**: stays in renderer + worker (rule 7); permalink
  stamps + pinned assets from P1.
- *Definition of done:* a student finds any public resource in ≤2 clicks
  from the course home, on a phone.

## Module W — Worker tier (cross-cutting enabler, build as needed)

Job queue + container workers: site builds, paged/print generation,
periodic reconciliation (door #3 without user action), agent-harness runs.
Pulled in by the first module that needs it (likely P1 pinned serving or
S3 builds).

## Sequencing

```
now →   E1 E2 ──────────── E3 E4 E5        (editing experience first)
        R1 R2 (v2 core) ── R3
                  P1 P2 ── P3 P4
                       T1 ── T2 T3 T4
                              S1 S2 S3
                              I2 (interim)          W: on demand
```

- **Start together:** E1/E2 (pure seam work against existing files) and
  R1/R2 (contract v2) — E3 needs R1, so the contract slice is pulled
  forward rather than blocking editing.
- **E3 waits for R1 in code, not just on paper** (code-audit flag): until
  contract v2 is deployed, the editor must not write `.md.html` into
  `study-guide/` — v1 validation would reject or, worse, skip it. Gate the
  format switchover on `PACKAGE_SCHEMA_VERSION >= 2`.
- P needs R2; T1 needs P3's item shapes (design them together); S can
  start its IA/design anytime, ships after P1 (note: `course-site.ts`
  types carry no slides/practice/current yet — that extension is S1
  work).
- Each lands with tests + Status.md updates; durable logic first, thin
  client last (unchanged discipline).

## Flexibility guarantees (modules without final plans)

T, I, and S are **interface-committed, implementation-open** — they can be
redesigned wholesale without touching R/E/P:

- **T** commits only to the *Inbox item contract* (kind + summary +
  preview + actions; versioned and additive per forward-compatibility).
  Producers (AI, P3 notices, reconcile, suggest-back) target that contract
  and never a UI; the Inbox UI owns nothing else.
- **I** commits only to the seams (`AIProvider`, change tiers,
  entitlements, worker boundary). No module may call a model directly or
  assume any particular AI surface exists.
- **S** commits only to *reading the registry* (what is public + file
  metadata). No module may depend on site structure; the site may be
  rebuilt at any time from registry + repos alone.
- Corollary: nothing in R/E/P may import from, or special-case, T/I/S
  internals. Dependencies point one way — flexible modules consume stable
  ones, never the reverse.

## Approval semantics (registration vs sharing — review resolution)

- **Registration is Tier-1**: automatic on any door, undoable, mints the
  docId. It changes nothing public.
- **"Share this" (discoverability) is the Tier-3 act itself**: one click
  *is* the explicit educator decision (Tier 3 means a deliberate human
  choice, not a heavyweight form). It stays disabled until required
  metadata (description/alt text) exists.
- **Publishing to the student site** remains Tier-3 at package scope
  (existing publish flow). `current/` files register with
  `discoverable: false` **locked at registration time** (policy, not a
  search-time filter) — moving a file to `assets/` and choosing "share
  this" is the only route to element discovery.
- `changeKind` tags are educator-supplied only; Tier-1 auto-applies never
  mint public version entries.
