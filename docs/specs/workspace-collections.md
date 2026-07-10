# Workspace collections + navigation restructure

**Status: design approved (owner, 2026-07-09), not yet built.** Implementation
plan for the three **collections** (Assets, Current, Private) and the workspace
navigation they require. Grounded in
[document-model.md](document-model.md), [package-layout.md](package-layout.md),
and the contract-v2 space model (`packages/package-contract/src/spaces.ts`).

## 1. The model

Two kinds of thing live in a package, and today's category rail conflates them:

- **Per-chapter documents** — one document, belonging to one chapter. These
  split by role (see [[spine-vs-deliverable]] below):
  - **the spine** — concept map, assessment guide. Non-public, concise plain
    text, hand-maintained. The skeleton of the course.
  - **the deliverables** — study guide, slides, practice questions. Public,
    comprehensive, richly formatted, rendered on the published site.
- **Collections** — Assets, Current, Private. Course-wide *libraries*, not
  per-chapter documents. Each spans scopes.

Their natural default scope differs, which is what drives the design:

| Collection | Repo | Default scope | Why |
| --- | --- | --- | --- |
| Assets | public | last-active chapter | mostly chapter-level, course-level needed too |
| Current | public | whole course | course-wide, plus a **term** dimension |
| Private | private | whole course | mostly course-level notes/keys |

### Scope by folder location

Within each collection's existing contract space:

- **course-wide** = files at the space root (or a named folder like
  `structures/`, `plots/`, `figures/`, `exams/`).
- **chapter-scoped** = files under the reserved `chapters/<slug>/` subtree.

**Verified: this needs no contract change for Assets or Private.** Both
`layerForPath` (v1) and `spaceForPath` (v2) classify by the *first path
segment only* and ignore depth, so `materials/chapters/03-step/fig.svg` and
`private-instructor/chapters/03-step/notes.md` already validate today.

### The scope control

Inside a collection, one plain-language control is **both the filter and the
write target**: `Showing: [ Whole course ▾ | 01 · Intro | 02 · … ]`. Selecting
a chapter lists that chapter's items, then a `Shared across course` band with
the course-wide items below (read-through — the `Add` button still targets the
selected scope). No "folder" vocabulary is ever surfaced.

## 2. Navigation

The left pane becomes one nav with three groups — Course / Chapters /
Collections — mapping to the three kinds of thing. The **category rail (pane 2)
is removed**; a chapter's documents are reached from the chapter's landing list
and switched with a dropdown above the editor.

```
⊙ Course                    ← details + concept map            [collapse ⇤]
CHAPTERS
  01 Introduction           ← opens the chapter's document list
  02 Step-growth …
COLLECTIONS
  Assets · Current (this term) · Private
```

**Opening a document** replaces the chapter's landing list with the editor:

- header row: `← back` · `02 · Step-growth` · **document dropdown** ·
  `lock · not published` (spine only) · `⋮ expand to tabs`
- the dropdown uses native `<optgroup>`s (`Course spine · not published` /
  `Published to the student site`) so the split stays visible while choosing;
- a toggle expands it into a horizontal tab strip for rapid switching;
- **no third column** — the editor keeps the full main-pane width, which the
  hosted `.md.html`/`.slides.html` iframes need;
- the left nav's **collapse control lives in its own top-right corner**; when
  collapsed an expand button appears at the start of the header row.

Clicking a chapter lands on its **document list** (not straight into the study
guide) — the spine must stay one click from view, not hidden behind a menu.

### URLs

| View | Today | After |
| --- | --- | --- |
| chapter document | `?chapter=<slug>&cat=<cat>` | `?chapter=<slug>&doc=<doc>` |
| course | `?cat=course` | `?view=course` |
| collection | `?cat=assets` | `?collection=assets&scope=<course\|slug>` |

`cat=` is accepted as a **back-compat alias** and mapped forward, because these
links exist outside the shell: `chapter-nav.tsx` (L47/251/372),
`api/github/installed/route.ts` (L47, `?publish=1`), and
`export/study-guide/route.ts` (reads `?chapter=`).

## 3. Phases

Durable logic first, thin client last (architecture rule 9). Each phase is
independently shippable and green (typecheck + tests + web build).

### Phase 0 — scope primitives (pure, no IO, no UI)

- `CHAPTER_SCOPE_DIR = "chapters"`; `chapterScopedPath(spaceDir, slug, rest)`.
- `scopeForPath(spaceDir, path, chapterSlugs) → {kind:"course"} | {kind:"chapter", slug}`
  — a path is chapter-scoped only when it sits under `<spaceDir>/chapters/<slug>/`
  **and** `<slug>` is a live chapter; everything else is course-wide.
- No legacy compat rule is needed: the only per-chapter private notes that exist
  today are throwaway test data (owner, 2026-07-09), so Private is restructured
  cleanly rather than carrying `private-instructor/notes/<slug>.md` forward.
- Unit tests incl. adversarial: `..` traversal, a `chapters/` folder whose slug
  is not a chapter (→ course scope, never a phantom chapter), nested depth.

### Phase 1 — validator dual-mode upgrade (**prerequisite for Current only**)

`current/` is a v2 space with **no v1 layer**, and `github-bridge`'s
`validateCommitPlan` plus most `package-ops` writers still call the **v1-only**
`assertPathAllowedInRepo`. Committing anything under `current/` throws today.

- Swap those call sites to `assertPathAllowedInEitherContract`
  (`packages/package-contract/src/validate.ts:38`).
- **This touches two-repo-invariant enforcement — the highest-blast-radius code
  in the repo (architecture rule 1).** It is not a bypass: the dual-mode check
  is fail-closed (a path rejected by *both* contracts still throws).
- Its safety rests on an unstated property: **no directory is public under one
  contract and private under the other.** Verified true today
  (`private-instructor/` v1-only private; `private/` v2-only private;
  `materials/` v1-only public; `assets/`/`current/` v2-only public; every shared
  name public in both). **Pin it with a test that enumerates `LAYER_REPO` and
  `SPACE_REPO` and asserts no dir name disagrees on repo** — otherwise a future
  space silently opens a hole.
- Adversarial tests: `private-instructor/**` and `private/**` never accepted for
  the public repo under either contract; unknown dirs still throw; root
  allowlist unchanged.

### Phase 2 — nav restructure (client only, no storage change)

- Split `StudioCategory` into `ChapterDoc` (`concept-map`, `assessment-guide`,
  `content`, `slides`, `practice`) and `Collection` (`assets`, `current`,
  `private`). Delete `CATEGORY_RAIL`.
- Rebuild `StudioShell`'s panes: unified left nav (3 groups) + main pane. Mobile
  collapses from **two** overlay drawers to **one** (`max-md` drawer, backdrop
  `z-10`/drawer `z-20`, `md:` = 768px per DESIGN.md).
- Add the chapter landing list, breadcrumb header, document `<select>`
  (`className="field text-xs"` — `.field` sets no font-size; every real select
  in the app is `text-xs`), and the tabs toggle.
- Move the collapse control into the nav's top-right; add the expand button.
- **Preserve, do not regress**: `PublishHeader`; the `dirty` plumbing
  (`useUnsavedGuard` + `useReportDirty`, incl. hosted-iframe `onDirty` — the
  shell-level guard is the *only* guard for hosted editors); `ManageDialog`
  (gear in the chapters group); optimistic nav (`optCat`/`optSlug` → now
  `optDoc`/`optCollection`) and the `navigating` indicator; the `key={}` remount
  strategy per file/document; `AIAssistant` + `useSelectionAI` mount points; the
  "← Workspace" link; the `● Unsaved` badge.
- Back-compat: map `?cat=` → the new params.

### Phase 3 — Assets collection

- `package-ops`: `listCollection(store, packageId, space, {chapterSlugs})`
  returning `{path, kind, scope}`; today's `listAssets` is flat and
  scope-blind.
- Upload targeting: `importFileAction` computes a **root-only** path today
  (`materials/<kindDir>/<file>`); add a `scope` argument →
  `materials/chapters/<slug>/<kindDir>/<file>`. `saveAssetAction` already
  accepts a caller-chosen `input.path`, so it needs only the scope-aware caller.
- UI: scope selector, `Shared across course` band, `Add to <scope>` button.
  Reuse `AssetEditor`, `ShareControl`, `AdaptControl`, `UploadControl` verbatim.
- `api/asset/[packageId]/[...path]` already refuses non-`materials` layers and
  serves nested paths — no change.

### Phase 4 — Private collection

- Convert from a single per-chapter file to a real collection. **No migration
  and no read-compat** — the only existing per-chapter notes are test data
  (owner, 2026-07-09), so the old `private-instructor/notes/<slug>.md`
  convention is simply dropped.
- Layout: course-wide = space root and named folders (`answer-keys/` already
  exists, written by `assessment-actions.ts`); chapter-scoped =
  `private-instructor/chapters/<slug>/…`.
- Touch points to update, not just add:
  - `edit/page.tsx:77` — delete the hardcoded `notes/<slug>.md` resolution.
  - `create.ts:95` and `adaptation.ts:311` — seed a course-level
    `private-instructor/notes.md` instead of `notes/getting-started.md`.
- Writes already route through `applyEditorEdit` (dual-mode) +
  `syncPrivateFilesToGitHub`. Registration auto-locks `private` as
  non-discoverable (`registration.ts:109`), so nothing leaks.

### Phase 5 — Current collection + the term dimension (**needs Phase 1**)

**Decided (owner, 2026-07-09): the pointer model, `current/<term-id>/…`.**
Rejected alternative: a live `current/` root that bulk-moves into
`current/archive/<term>/` on rollover. The pointer model wins because:

1. **File paths never change.** Every file carries a docId + permalink and the
   registry keys identity by path; the archive model moves every file each term,
   churning permalinks, registry rows, and the reconcile diff.
2. **Rollover is atomic and reversible** — one manifest field, one commit. A
   bulk move can be interrupted, leaving a term both live *and* archived.
3. **"Archived" is derived, not positional** ("not the pointer"), so there is no
   second source of truth to desync.
4. **Carry-over is a copy**, not a move-then-copy.

The archive model's one advantage — a stable "latest" URL — is recovered for
free at the render layer: the published site is generated, so `course-site.ts`
resolves "this term" through the pointer and renders it at a stable public URL.
Students never see repo paths.

- Activate `manifest.currentTerm` (today: **dead schema**, zero readers/writers).
- **Split identity from label**: `currentTerm` holds an *immutable* term id
  (`2026-spring`) used in paths; a separate manifest field holds the display
  label ("Spring 2026"). Renaming the label must never move a file — otherwise
  the path churn the pointer model avoids comes straight back.
- Structure `current/<term-id>/…`, chapter scope at
  `current/<term-id>/chapters/<slug>/…`.
- Term switcher above the scope control; editing an archived term stamps a
  revision note; new-term carry-over offers structure-only (default) or
  structure+files.
- **Stale docs to correct**: `spaces.ts:78`'s doc comment and
  `package-layout.md` §2 both describe `current/archive/<term>/`, predating this
  decision.
- The published course home's static `current-term` placeholder
  (`renderer/course-site.ts:301`) becomes data-driven off the pointer.

### Phase 6 — docs + tracker

- Update `package-layout.md` (§2 layout, the `current/` convention), the
  `spaces.ts` doc comment, `document-model.md` if it names the rail, and
  `Status.md` in the same commit as each phase.

## 4. Risks and open questions

1. **Phase 1 is the only dangerous change.** Do it alone, with the
   repo-disagreement test above, and verify before anything depends on it. If
   Current slips, Phases 2–4 still ship (Assets/Private need no validator work).
2. ~~`current/<term>/` vs `current/archive/<term>/`~~ — **resolved**: pointer
   model, with an immutable term id separate from the display label (Phase 5).
3. ~~Private legacy path~~ — **resolved**: no existing real data; clean
   restructure, no compat rule (Phase 4).
4. **Orphaned durable actions** (`reconcile-`, `a11y-`, `assessment-`,
   `planning-`, `integrity-`, `agent-`, `ai-actions`, most of `adapt-actions`)
   are already unreachable from any pane. The restructure neither fixes nor
   worsens this; the new nav is where they'd eventually surface.
5. **`saveFileAction` uniquely revalidates `/workspace/<id>/edit`** while every
   other action revalidates `/workspace/<id>` — keep this in mind when the
   route's params change.

## 5. Verification

Per phase: `pnpm typecheck` (13 workspaces), `pnpm test`, `pnpm --filter
@alembic/web build`. Phases 2–5 additionally verified in a real browser at
375px / 768px / 1280px in both themes — the nav restructure changes drawer
behavior, and DESIGN.md requires editing surfaces to go single-column below
`lg:` and navs to become overlay drawers below `md:`.
