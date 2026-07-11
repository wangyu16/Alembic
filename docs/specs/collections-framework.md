# Collections framework

**Status: framework design approved (owner, 2026-07-11).** The durable, shared
machine behind the three collections (Assets, Current, Private). Per-collection
*detail* (metadata UIs, Current's sections, the creatable-formats roadmap) is
polished on top of this and tracked in §9. Builds on
[workspace-collections.md](workspace-collections.md) (scope model + navigation,
already built through P2.6), the contract-v2 spaces
(`packages/package-contract/src/spaces.ts`), the document contract
([SteeringNote §2–§3](../SteeringNote.md)), and the trial-storage decision
([carriers-and-assets.md §5](carriers-and-assets.md)).

## Decisions locked (2026-07-11)

1. **Folders: scope + free nesting.** Scope (course vs chapter) is the semantic
   top layer; below it the educator makes free folders/subfolders that carry no
   semantics. The contract already ignores path depth, so this needs no contract
   change.
2. **Type registry: curated classes, user-addable.** Alembic ships known types;
   the educator can add an extension and pick one of a **fixed set of handling
   classes**. Every type therefore has a defined behavior (insert / open /
   download).
3. **Upload: follow GitHub; binaries need publish.** No Alembic-imposed cap;
   warn near GitHub's 50 MB, block only what GitHub blocks (100 MB). Binary
   uploads require the package to be published (trial packages stay text-only in
   Postgres — no object-store tier). Text files work in a trial.

## 1. One framework, three collections

The three collections are the **same machine** with different config. Only the
right three columns vary.

| Collection | Repo | Per-file metadata | Publishing | Extra dimensions |
| --- | --- | --- | --- | --- |
| **Private** | private | none | never | — |
| **Assets** | public | description + tags + license (required to share) | element-level to Discover | — |
| **Current** | public | + term, + section | a "This term" area on the course site | **term** (current vs archived), **section** (announcements / assignments / misc) |

Everything else — storage, scope, folders, the type registry, registration,
permalinks, the upload/create doors — is shared and defined below.

## 2. Storage, scope, folders

A collection file's path:

```
<space>/[chapters/<slug>/]<free/nested/path>/<name>.<ext>
   │            │                  │
   │            │                  └─ the educator's own folders (no semantics)
   │            └─ present ⇒ chapter-scoped; absent ⇒ course-scoped (semantic)
   └─ the collection's contract space (assets / current / private-instructor)
```

- **Scope is the top, semantic layer** and comes from the first path segment
  after the space. It drives *where a file appears and publishes*
  (course-wide vs inside a chapter). This is the existing `scopeForPath`
  (`packages/package-contract/src/scope.ts`) — unchanged.
- **Folders below scope are free and organizational** — a familiar
  file-manager tree, no meaning attached. The contract classifies by the first
  segment and **ignores depth**, so `assets/chapters/03-step/figures/fig.svg`
  already validates today.
- **Move within a scope** = pure reorganization. **Move across scope**
  (course ⇄ chapter, or chapter A ⇄ chapter B) *re-associates* the file — a
  real semantic change the UI must name ("Move to chapter 3"), distinct from
  "put in a folder".
- **Two-repo invariant**, unchanged: Private → private repo; Assets/Current →
  public. Every write goes through `packageOps` and `validateCommitPlan`,
  fail-closed. `LICENSE`-style root files are irrelevant here; collection files
  live under their space.

**No "folder" or "path" vocabulary leaks into publishing logic.** Publishing
reads *scope* (course/chapter) and, for Current, *term/section* — never the
free folder path.

## 3. The file-type registry

The registry is what lets Alembic treat an uploaded file as more than opaque
bytes. Each entry maps an extension to exactly one **handling class**:

| Handling class | Permalink class | What the educator can do | Examples |
| --- | --- | --- | --- |
| `document` | Document (view/cite) | open, view, cite — **never inserted** | `.md.html`, `.slides.html`, `.paged.html` |
| `insertable-image` | Object (src) | insert as `<img src>`, open in a tab | `.svg`, `.png`, `.jpg`, `.ketcher.svg`, `.plot.svg`, `.excalidraw.svg` |
| `insertable-media` | Object (src) | insert as `<audio>`/`<video src>` | `.mp3`, `.mp4`, `.webm` |
| `insertable-source` | Object (src) | insert via markdown include | `.md`, `.csv` |
| `opaque-download` | Object (download) | download / open in a tab — not insertable | `.pdf`, `.zip`, `.docx`, `.xlsx` |

- **Built-in registry** ships the rows above (the base every package gets).
- **Per-package extension** lives in the manifest as an additive, versioned
  field (CLAUDE.md rule 9): `{ extension, label, class }`. A package is
  self-describing and a fork inherits the types it actually uses. The educator's
  "add a supported type" writes here; they pick the class from the fixed set, so
  behavior is always known. *(Alternative — a global per-user toolbox — is noted
  in §9 as a possible detail; the manifest field is the portable default.)*
- The class — not the extension — decides the affordances. A new `.foo` mapped
  to `insertable-image` is inserted like any image; mapped to `opaque-download`
  it is a download link. Unknown extensions with no registry entry default to
  `opaque-download` (never rejected — it is the educator's own repo).

## 4. Registration, metadata, permalinks

- **Every collection file is registered** (document contract, SteeringNote §2):
  identity/`docId`, path, space, scope, handling class, embedded-source hash
  where applicable, origin, public/private. Registration is origin-agnostic
  (created in-app / uploaded / committed directly on GitHub all register
  equally). The existing `documents` table + `SupabaseDocumentRegistryStore` is
  the projection; collections extend it, they do not add a parallel store.
- **Permalink class follows the handling class**: `document` → Document
  permalink (`/d/{docId}`, view/cite); everything else → Object permalink (raw
  bytes with correct `Content-Type`, used as `src`). This is SteeringNote §3,
  applied uniformly to collection files.
- **Metadata is the varying layer** (§1). Private: none. Assets: description +
  tags + license, **required before a file can be shared/discoverable** — the
  same fields the portal + element search already read. Current: term + section
  (§6). Metadata is stored in the registry row, not the file, except where a
  format embeds its own (a `.md.html`'s own carrier metadata still wins for the
  fields it carries).

## 5. Upload & create doors

Two doors, both ending in a `packageOps` write + registration:

- **Create-in-app** — the creatable self-contained formats (`.md`, `.md.html`,
  `.slides.html`, `.paged.html`, `.ketcher.svg`, `.plot.svg`, `.html`, and the
  roadmap formats in §9). Each opens its in-file editor.
- **Upload** — any file. Gated by storage (decision 3): on a *trial* package,
  text-ish files only; **binary uploads require the package to be published**,
  after which they commit straight to the educator's public repo. Warn near
  50 MB, block at 100 MB (GitHub's limits, surfaced — not Alembic's).

Both doors take an explicit **(scope, folder)** target and a **type** (resolved
against the registry), superseding today's `importFileAction`, which hardcodes
`materials/figures/…` and knows only a fixed asset set
(`apps/web/src/app/workspace/[packageId]/import-actions.ts`). The generalized
door is the single collection writer; `importFileAction` folds into it.

## 6. Per-collection detail (shape only; polished in §9)

- **Private** — the simplest instance, and therefore the one that proves the
  framework first: a plain private-repo file store with folders, no metadata, no
  publishing, no Discover. If Private works, the framework works.
- **Assets** — adds the metadata gate (§4) and the two element actions from the
  handling class: **insert** (Object permalink as `src`) and **open** (a tab).
  Fully-described assets flow to Discover's element search (SteeringNote §3b).
- **Current** — adds two dimensions on top of the framework:
  - **term** — the pointer model `current/<term-id>/…` (immutable term id vs a
    display label; a term switcher; archived terms are read-only; see
    [[collections-organization-decisions]]).
  - **section** — announcements (timestamped `.md`, title + body), assignments
    (`.md.html`/`.paged.html`), misc. Sections drive a reserved **"This term"**
    area on the published course home (the placeholder already stubbed in
    `renderer/course-site.ts`).

## 7. What this reuses vs. adds

**Reuses (do not duplicate):** `scope.ts` (scope from path), `collections.ts`
(`listCollection`, `collectionItemPath`), the `documents` registry + store, the
two-repo validators, the permalink direction (SteeringNote §3), and the trial
storage gate.

**Adds:** the file-type registry + handling classes (contract, pure); a
folder-aware tree listing + folder ops (package-ops); one generalized
upload/create door that takes (scope, folder, type) and registers; the
"metadata required to share" gate (Assets); and Current's term + section
dimensions.

## 8. Implementation plan (modularized)

Durable logic first, thin client last (rule 9). CF0–CF2 are the shared
framework; CF3–CF5 are the three collections; CF6 is the formats roadmap.
Disjoint pieces are marked ∥ (parallelizable via subagents).

- **CF0 — type registry (pure, contract).** ∥ `HandlingClass`, the built-in
  registry, the additive manifest field + schema, `classForPath(path,
  manifest)`. No IO. Adversarial tests: unknown → `opaque-download`; a manifest
  entry can only pick a valid class; the two-repo invariant unaffected.
- **CF1 — folder-aware listing (package-ops).** ∥ Extend `listCollection` to
  return a scope×folder tree (nodes = folders, leaves = files with class +
  registry metadata), deterministic order. `folderOps` (create/rename/move/
  delete within a scope; cross-scope move = re-associate). Pure over the store.
- **CF2 — the generalized door.** The single collection writer: `(packageId,
  space, scope, folder, filename, bytes|source)` → resolve type → `packageOps`
  write → register → (published) commit. Enforce the storage gate + size
  policy. `importFileAction` folds in. Adversarial: binary on a trial package
  rejected with a clear message; path traversal rejected; private space never
  reaches the public repo.
- **CF3 — Private UI.** The framework's first client: tree view, create folder,
  upload (text in trial / binary when published), rename/move/delete. Proves the
  machine end-to-end with the least surface.
- **CF4 — Assets.** Metadata panel (description/tags/license) gating share;
  insert & open actions from the handling class; element registration →
  Discover.
- **CF5 — Current.** ✅ Landed. Term dimension (pointer model, switcher,
  archived = read-only) + reserved course-level sections
  (announcements/assignments/misc) + the data-driven "This term" published area.
  A term is a two-segment `spaceDir` (`current/<term-id>`); `scopeForPath` +
  `listCollection` were generalized to a boundary-safe multi-segment prefix so
  the framework is reused verbatim. `terms.ts` (contract: sections, id
  validation, `currentSpaceDir`; ops: `listTerms`, `planCarryOver`),
  `term-actions.ts` (start/activate/relabel/announce), `current-collection-view.tsx`,
  and `course-site.ts` `CourseTermData`. See workspace-collections.md P5.
- **CF6 — creatable formats.** ✅ First six shipped (create + edit in-app on the
  framework): `.md`, `.md.html`, `.slides.html`, `.paged.html`, `.ketcher.svg`,
  `.plot.svg`. Each creatable type carries an `editorKind` (contract); a shared
  `CollectionEditorPane` mounts the surface — plain-text for `.md`, the
  self-contained file's own in-file editor (hosted carrier + orz-host-save) for
  the three documents, and an editor-kit WYSIWYG (embed-on-save) for the two
  SVGs. `createCollectionFileAction` seeds the four text/doc formats;
  `saveCollectionFileAction` is the one host-save sink. **Planned, not yet
  shipped** (uploaded-only until their builders land): `.html` (plain web page)
  and the roadmap formats — Excalidraw `.excalidraw.svg` (whiteboard/diagram),
  3Dmol/NGL `.mol.html` (3D structures), p5.js `.sim.html` (simulations).

Each phase: durable module + tests first, thin disposable client last; the
client stays replaceable per rule 9.

## 9. Details to polish (after the framework)

- Exact metadata UIs (Assets share panel; Current announcement composer).
- Current's section list — is announcements/assignments/misc complete? Reserved
  webpage layout for "This term".
- Type-registry home — per-package manifest (chosen default) vs. a global
  per-user toolbox, or both.
- Creatable-formats priority + which to build first (lean: Excalidraw, then a
  chemistry-specific 3D viewer).
- Per-file size *warning* copy and the published-package upgrade nudge.
