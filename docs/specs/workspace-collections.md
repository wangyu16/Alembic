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

- header row: `← back` · `02 · Step-growth` · **document switcher** ·
  `👁̶ not shown to students` (spine only) · `⋮ expand to tabs`
- the switcher is a popover of anchors — **never a `<select>`**, whose
  `onChange` would unmount a hosted iframe unguarded (§2a.1) — captioned
  `Course spine · not shown to students` / `Published to the student site` so
  the split stays visible while choosing;
- **each document carries its own glyph** (linked nodes, clipboard-check, open
  book, presentation screen, question mark) so a row is identifiable before its
  label is read;
- the spine marker is an **eye-with-a-slash, never a padlock**: concept map and
  assessment guide live in the *public* repo and are citable like any other
  file — they are simply not rendered on the student site, to keep the course's
  scaffolding out of a student's way. A padlock would promise a confidentiality
  the two-repo invariant does not give them; genuinely private material lives
  in `private-instructor` (the Private collection);
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

## 2a. Hosted-editor constraints (non-negotiable)

Alembic ships **no editor of its own** for the main documents: it generates
self-contained `.md.html` / `.slides.html` via the sibling orz packages and
hosts each file's **own** in-file editor in a sandboxed iframe, talking to it
over `orz-host-save@1` / `orz-host-ai@1`. Audited 2026-07-09 against this
restructure. The sibling contract is **safe** — nothing in the orz files reads
the host's URL, DOM, or pane structure; generation receives only
`{markdown, title, theme, delivery}`; the handshake is per-mount. The coupling
boundary is five files (`editor-kit/host-save-client.ts`, `host-ai-client.ts`,
`hosted-carrier.ts`, `generators/index.ts` + `package.json`,
`worker-client.ts`), none of which this restructure touches.

But the restructure introduces four real hazards inside Alembic:

1. **BLOCKER — a `<select>`/`<button>` switcher silently destroys unsaved work.**
   `useUnsavedGuard` is the *only* protection for hosted editors (they have
   none of their own; there is no save-on-unmount, and the host cannot command
   a save — saves are file-initiated). It guards via (a) `beforeunload`, which
   **does not fire on client-side Next navigation**, and (b) a capture-phase
   click interceptor that **only matches `<a>` elements**
   (`use-unsaved-guard.ts`, `target.closest("a")`). Today's prompt fires purely
   because chapter/category switches are `<Link>` anchors. A dropdown that
   calls `router.push` bypasses both; `destroy()` runs and edits vanish silently.
   → **The document switcher must be anchors** (a popover menu of `<a href>`,
   matching the existing `AIAssistant` popover pattern), **and** call the
   already-existing-but-unused `confirmDiscard(dirty)` imperatively.
2. **SERIOUS — no generation cache anywhere.** Every mount is a fresh worker
   round-trip returning a ~0.84–1 MB inline bundle, plus a handshake (400 ms
   cadence, 20 s give-up). Making switching one click turns deliberate page-navs
   into rapid-fire regenerations with "Preparing the editor…" stalls.
   → Memoize generated HTML per `(packageId, path, theme)` for the session.
3. **SERIOUS — the mount key must be identity-only.** Keys today are
   `content:${activePath}` etc. A save runs `revalidatePath`; if the new key
   ever derives from saved content or theme, that refresh remounts the iframe
   mid-session and loses in-progress edits. Key on `doc` + `path`, never on
   mutated state.
4. **MINOR — preserve an explicit `doc → OperationCategory` map.**
   `HOSTED_STUDY_GUIDE_AI_OPS` / `HOSTED_SLIDES_AI_OPS` are
   `operationsForCategory("content"|"slides")`. If the new `?doc=` ids don't map
   back cleanly, the handshake still completes but advertises empty ops and AI
   silently disappears.

Also true, and load-bearing: the iframe's `allow-same-origin` sandbox flag must
stay (orz-mdhtml renders its preview into a *nested* iframe via
`contentDocument`; an opaque origin yields a blank file and a dead pencil). The
workspace editing surface is `delivery:"inline"`, so the CDN `-browser` lockstep
trap affects only the published site. `orz-paged` is registered but mounted
nowhere in the workspace — no paged editor pane is required.

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

### Phase 1 — validator dual-mode upgrade (**prerequisite for Current only**) ✅ done

`current/` is a v2 space with **no v1 layer**, so any call site that runs it
through the **v1-only** `assertPathAllowedInRepo` throws.

**Corrected scope (the call-site map, not the guess):** only the sites that
iterate *arbitrary* files are affected — **two files, four lines**:
- `github-bridge/src/index.ts` `validateCommitPlan` (every commit), and
- `package-ops/src/release-gates.ts` (both loops iterate every public file, so a
  `current/` file would have failed the publish gate).

Everything else assert a *specific known v1 path* (`MANIFEST_PATH`, the
study-guide path, `materials/…`) and can never see a `current/` path:
`create.ts` and `adaptation.ts` validate their own locally-built v1 seed lists;
`assets.ts`'s `layerForPath(...) !== "materials"` is a carrier-placement check,
not a repo check. Left alone deliberately — the invariant diff stays minimal
and reviewable. `reconcile.ts`, `editor-edit.ts`, `document-registry.ts` and
`validateProject` were **already** dual-mode.

- Swapped those call sites to `assertPathAllowedInEitherContract`
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
- Adversarial tests (landed): `private-instructor/**` and `private/**` never
  accepted for the public repo under either contract, nested included; public
  spaces rejected for the *private* repo (the invariant runs both ways);
  unknown dirs and `..` traversal still throw; root allowlist unchanged; a plan
  smuggling one private file among valid v2 public ones is rejected. Both new
  "accepts v2-only public spaces" tests were **verified to fail against the old
  v1-only code** — a test that passes either way proves nothing.

### Phase 2 — nav restructure (client only, no storage change)

Split into independently verifiable subtasks. **P2.1 must land first** — it is
the data-loss fix, and every later subtask depends on switching being safe.

- **P2.1 — unsaved-edit safety (do first, alone).** Extend `useUnsavedGuard`
  with an exported imperative `confirmDiscard(dirty)` gate (it already exists,
  unused) and add a regression test proving a **non-anchor** switch is guarded.
  Verifiable on today's UI before any nav change.
- **P2.2 — generation memo.** Cache generated editor HTML per
  `(packageId, path, theme)` for the session, so a document switch that returns
  to a previously-opened document is instant and costs no worker call. Verify by
  observing a single worker call across two switches.
- **P2.3 — types + URL scheme.** Split `StudioCategory` into `ChapterDoc`
  (`concept-map`, `assessment-guide`, `content`, `slides`, `practice`) and
  `Collection` (`assets`, `current`, `private`); delete `CATEGORY_RAIL`; add the
  explicit `doc → OperationCategory` map. New params with `?cat=` back-compat;
  update the external link builders (`chapter-nav.tsx` L47/251/372,
  `api/github/installed/route.ts:47`, `export/study-guide/route.ts`).
- **P2.4 — left nav.** Unified nav (Course / Chapters / Collections), collapse
  control in the nav's own top-right, expand button in the header row. Mobile
  collapses from **two** overlay drawers to **one** (`max-md` drawer, backdrop
  `z-10` / drawer `z-20`, `md:` = 768px per DESIGN.md).
- **P2.5 — chapter landing list + document switcher.** The switcher is a
  **popover menu of `<a href>` links** (not a `<select>`, not buttons — see
  §2a.1), styled like the existing `AIAssistant` popover, with the spine /
  published grouping, a per-document glyph, and an eye-with-a-slash "not shown
  to students" marker on spine documents (**not** a padlock — they are public,
  just unrendered); plus the tabs-expansion toggle (also anchors) and the
  breadcrumb. Any control that
  can't be an anchor calls `confirmDiscard` first — in the shipped shell none
  exists, so `confirmDiscard` stays unused there (calling it *and* letting the
  anchor interceptor run would prompt twice).
  **Guard invariant discovered here:** `useUnsavedGuard` must install exactly
  **one** listener pair process-wide. Several components are dirty at once by
  design (the editor owns `dirty`; the shell mirrors it so the publish header
  can block, and so the hosted iframes — which arm no guard — are covered).
  Per-hook listeners meant one prompt *per dirty component* on the accept path:
  `stopPropagation()` does not stop other listeners on the same node, and the
  `defaultPrevented` early-return only masks it when the user cancels. It is
  now refcounted. Do not reintroduce per-hook listeners.
- **P2.6 — preserve, do not regress**: `PublishHeader`; the `dirty` plumbing
  (`useUnsavedGuard` + `useReportDirty`, incl. hosted-iframe `onDirty`);
  `ManageDialog` (gear in the chapters group); optimistic nav (`optView` +
  `optSlug`, reconciled on a stable `viewKey(view)` string) and the
  `navigating` indicator; the `key={}` remount strategy — **keyed on identity
  only** (§2a.3); `AIAssistant` + `useSelectionAI` mount points;
  "← Workspace"; the `● Unsaved` badge.

Browser-verify P2 at 375 / 768 / 1280 px in both themes, and explicitly test:
open a hosted document, type without saving, then attempt each of (a) document
switch, (b) chapter switch, (c) collection switch, (d) tab close — all four must
warn.

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
