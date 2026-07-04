# Workspace framework — the shell as the one editor host

**Status: direction locked (owner brief, 2026-07-04); framework changes
landed same day, deep alignment in progress.** The owner's brief: the
current three-pane editor layout is good; the header can be full width; the
classic editor is not needed anymore; the categories list follows
[document-model.md](document-model.md); upload and external source changes
must be acceptable (origin parity); each file type / space aligns to the
updated design.

## 1. Landed now (framework pass)

- **Classic editor removed** (`editor.tsx`, ~2.2k lines, + its per-chapter
  history component). `/workspace/[packageId]` now redirects to `./edit`.
  The shell at `/workspace/[packageId]/edit` is *the* editor.
  `PublishingState` moved to `_components/publish-header.tsx`.
- **Site header is full width** (app chrome, not a centered column).
- **Categories = the document model**, in taxonomy order: Concept map ·
  Study guide (was "content") · Slides · Assessment guide · Practice
  questions · Assets · **Current (this term)** · Private. "Current" renders
  an explanatory space view (uploads + semester archiving arrive with the
  document contract; contract-v2 layer question tracked in
  document-model.md §6).
- **Upload affordances (origin parity, door #2):** the Study-guide pane
  accepts `.md` / `.md.html` uploads (block-ID reconciling merge — re-upload
  updates in place); the Assets pane accepts carrier files
  (`.ketcher.svg` / `.plot.svg` / documents). Both reuse the existing
  lossless import pipeline (`importFileAction` → `classifyImport` →
  `reconcileImportedBlocks`). Door #3 (direct GitHub commits) remains the
  reconcile path.

## 2. Consciously parked (re-land per the new design, not the old panels)

Removing the classic editor unshipped its side panels. Their durable logic
(server actions + package-ops) is untouched; each returns to the shell when
its place in the new design is settled:

| Parked surface | Durable logic that remains |
|---|---|
| Review queue / changes (Tier-1 undo, Tier-2 accept/reject) | `change-actions.ts`, `lib/changes` |
| Accessibility panel | `a11y-actions.ts`, `@alembic/a11y` |
| Assessments (blueprints, question generation, LMS export) | `assessment-actions.ts`, export route |
| Adaptation (adapt from portal, upstream updates, suggest-back) | `adapt-actions.ts`, suggestions table |
| Planning (concept map ops, outline-from-plan) | `planning-actions.ts` |
| AI restructure of pasted text (Tier-2) | `restructureImportAction` |
| Per-chapter history / restore | `snapshot-actions.ts` / github-bridge |
| Reconcile banner (external commits) | `reconcile-actions.ts`, `reconcilePublicRepo` |

The review queue and reconcile banner are the highest-priority re-lands
(they gate trust); the shell header is the natural home.

## 3. Deep alignment (next, with the document contract)

**E1 mounting strategy (investigated 2026-07-04):** the orz-family
packages are CLI-first (no library exports) — correctly so, because *the
file carries the editor*. Their in-file runtimes currently save via the
File System Access API (Chromium) with a download fallback; **no host
hook exists yet**. Decision: define a tiny versioned **host-save
postMessage protocol** implemented upstream in the three runtimes (the
owner controls orz-mdhtml/orz-slides/orz-paged): when the file detects a
host (`window.parent` handshake), its Save action posts
`{ type: "orz-host-save", source, html }` to the parent instead of
hitting the filesystem. Alembic's `EditorModule` per format then simply
mounts the file in a sandboxed iframe and listens — saves return through
`applyEditorEdit`. Upstream work item for the sibling repos; the Alembic
side is a thin editor-kit wrapper.

**Protocol scope (owner-confirmed 2026-07-04): all three runtimes, one
pass.** The protocol is format-agnostic and lands in orz-mdhtml,
orz-slides, and orz-paged together (~40 lines each) so one version, one
review, one test harness — and Alembic ships a single generic
hosted-carrier `EditorModule` parameterized by kind, not three wrappers.
The spec lives **upstream in the orz-family** (a versioned `PROTOCOL.md`,
`orz-host-save@1`) because it's a property of the files, usable by any
host. It must pin two things: **origin discipline** (host-save enables
only after a verified handshake from the parent; replies target that
origin only — these files are executable HTML) and **capability
negotiation** (host announces the protocol; an unhosted file keeps its
normal File-System-Access/download save). Alembic consumes md first (E3);
slides/paged panes activate later with no upstream work left.

**Status 2026-07-04: implemented upstream and browser-verified** — canonical
`PROTOCOL.md` + runtime in orz-mdhtml (`efd6d4b`), orz-slides (`37459cc`),
orz-paged (`c5f25e9`); committed locally, **not pushed / not published**
(owner releases). Verified: handshake (bogus hellos ignored), save with
ack + 10s watchdog, dirty signal (+ post-handshake catch-up), unhosted
behavior unchanged. Host-side notes for Alembic's EditorModule: **retry
the hello** until `orz-host-ready` (CDN-slow files boot late); the
framework self-Update flow stays on the file's own save path in v1.

- Study guide becomes one `.md.html` file per chapter with its **in-file
  editor hosted** in the editor pane (orz-mdhtml via the `editor-kit`
  seam); the block editor is the interim surface until then.
- Slides/practice/paged: hosted in-file editors the same way.
- Assets / Current / Private become real **file spaces** with a file
  organization interface, per-file registration, "share this", permalinks.
- Concept maps + assessment guide stay plain `.md` with the minimal
  text-editor-with-preview.

## 4. Constraints unchanged

Every write path still goes through `packageOps` validation; two-repo
invariant fail-closed on uploads exactly as on saves; Tier-3 publish
approval; repos as source of truth.
