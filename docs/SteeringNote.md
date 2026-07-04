# Steering note — self-contained editing era (July 2026)

**Status: living document.** Owner's working notes from the 2026-07-03 design
discussion, to be refined further **before implementation** — nothing here is
scheduled yet. The formalized version of the locked parts lives in
[specs/self-contained-editing.md](specs/self-contained-editing.md); when this
note and that spec disagree, this note is newer thinking until the spec is
updated. The core product idea in [goal.md](goal.md) is unchanged.

## 1. Editing moves out of the platform (decided)

Editing has been largely offloaded from the Alembic platform to
**self-contained files**, built by the sibling projects in the `orz-family`
mother folder:

| Format | Project | Role |
|---|---|---|
| `.md.html` | orz-mdhtml | webpage-like document, quietly editable in place |
| `.slides.html` | orz-slides | slide deck with per-slide in-file editor |
| `.paged.html` | orz-paged | print-paged document, in-browser editor + templates |

Consequences:

- **The workspace builds no editors.** It simply **plugs in** the three
  in-file editors and hosts them. Alembic's jobs: registration, validation,
  versioning, GitHub publication, provenance, permalinks, reuse.
- **Studio (`/studio`) is removed.** A self-contained file *is* the local,
  anonymous, nothing-to-install editor — open in a browser, click the pencil.
  *(Done 2026-07-04: `/studio` deleted and replaced by a `/guide` page — a
  brief orientation to the most important concepts.)*

## 2. Document contract — origin parity (decided)

Documents must be treated **equally regardless of origin**:

- created in the workspace,
- uploaded to the workspace, or
- uploaded/committed directly to the corresponding GitHub repository.

So a **document contract** is needed: files are *registered*, not merely
*created*, and registration works identically for internal and external
origins (identity, path/layer, carrier kind + format version, embedded-source
hash, provenance/origin, block IDs, public-private status). The two-repo
invariant applies on every door, fail-closed.

## 3. Permalinks (decided: the requirements + two classes; proposed: the mechanism)

**Requirements (decided).** Every file has a permalink, always available.
Two classes with different contracts:

- **Documents = final user-facing views** (`.md.html` / `.slides.html` /
  `.paged.html`). **Never inserted into anything.** Their permalink is a
  *promise to find that specific file anytime* — for sharing and citation —
  and the file's built-in **editor and viewer are always available** because
  they travel inside the file.
- **Objects = insertable sources** — images, audio, raw markdown, data,
  structures/plots, …. Their permalink is **used directly as `src`** to
  embed into a page (`<img src>`, `<audio src>`, markdown include).
- `<iframe>` may embed an HTML page/unit when nothing else works — a
  tolerated fallback, **not a preferred solution**.

**Mechanism (recommended, awaiting owner confirmation).** Raw GitHub links
are rejected: `raw.githubusercontent.com` serves `text/plain` + `nosniff`
(self-contained HTML shows as source code), URLs embed username/branch/path
(break on rename/move/transfer), private files can't be served, pinning
means commit SHAs. Instead:

- **Permalink = ID, not path.** `alembic.orz.how/d/{docId}` (live),
  `/d/{docId}@{snapshot-name}` (pinned for citation),
  `/d/{docId}/blocks/{blockId}` (raw markdown fragment — block IDs already
  exist in source). IDs are minted by the document-contract registration;
  the ID→path mapping updates on rename/move/transfer, the ID never changes.
- **Layered resolution.** Public + published → **302 redirect to the
  educator's GitHub Pages site** (correct MIME + CORS, renders the
  self-contained formats, educator-owned, keeps the no-lock-in promise —
  Alembic adds stability without becoming a dependency). Private / trial /
  owner-only → served through the platform (GitHub-App token or Supabase)
  with access checks and correct content-type (the existing
  `/api/asset/{pkg}/{path}` pattern, generalized).
- **Object permalinks serve raw bytes** with correct `Content-Type`,
  permissive CORS for public objects, cache split by form (live = short
  cache; `@snapshot` = immutable).
- **Files are self-describing:** the canonical permalink is stamped into
  each generated file's carrier metadata.
- Trade-off acknowledged: the resolver is platform infrastructure with a
  sustainability obligation (same class as the portal).

## 3b. Package structure: file as the unit, sharing at two levels (owner decision, 2026-07-04)

The basic content unit changes. Previously: a *section* of a chapter's study
guide (heading-bounded block). Now: **the whole study guide of a chapter is
the unit — one `.md.html` file.** Sections remain internal structure of the
file, not units of storage or sharing. (Consequence: the chapter's source of
record is the `.md.html` file itself, with markdown source embedded;
registration extracts and hashes it. Slides/paged handouts derive from the
chapter file and trace to it — study-guide-centered, coarser grain.)

**Sharing at two levels:**

- **File level** — every single file is individually shareable: a study
  guide, a slide deck, an image, a plot, an element, a piece of markdown
  source, …. A reusable markdown piece is its own small object file (not an
  addressable block inside a chapter). **Each file has version control and a
  permalink** (per-file history comes from Git; pinned form = the file at a
  version). The two permalink classes (§3) apply: documents = view/cite/find;
  objects = insert as `src`.
- **Package level** — a whole course package is shared as a whole (portal
  page / published site / repo pair) and has **united version control**:
  named snapshots (Git tags). A package snapshot pins every file at once; a
  file permalink can pin either to the file's own version or to a package
  snapshot ("this figure, as taught in Fall 2026").

**Discover searches both levels:** whole course packages (exists) and
**elements** — individual files across registered packages (new; powered by
the document-contract registration index: kind, description/alt text,
provenance, license, permalink). Element results are public-safe only, with
class-appropriate actions (view/cite/adapt vs copy-permalink/insert).

Open sub-questions: block IDs demote to optional in-file anchors (citation,
provenance, AI merge assistance) — no longer editing/sharing units, and
suggest-back becomes file-level; file versions stay a plain dated history
while *named* versions exist only at package level (snapshots); element
search scope = public layer of registered packages. (Owner to confirm.)

Next: the owner defines **what a whole OER package should have** (the
document taxonomy, §4).

## 4. Document taxonomy (delivered 2026-07-04 → specs/document-model.md)

The owner delivered the taxonomy in
[userinputs/userguide.md](userinputs/userguide.md); it is structured in
[specs/document-model.md](specs/document-model.md) (DRAFT, open questions
marked). Highlights: course concept map + per-chapter {concept map, study
guide `.md.html` (source of truth), slides, assessment guide, practice
questions} + three file spaces {assets, current, private}; start-small
element publishing with report→correct→notify and revise→fork loops;
element discovery is **per-file**, not gated on whole-package portal
listing. Confirmed same day: block IDs demote to optional anchors; file
versions are a dated history, named versions exist only at package level.

Other open questions (tracked in the spec §6): study-guide source of record
(`.md` source vs `.md.html`-native); fate of the current studio-shell block
editor; `.md.pdf` vs `.paged.html`; upload policy vs the trial-storage
decision.

## 5. Unchanged foundations

Two-repo public/private invariant (fail-closed everywhere) · `packageOps` as
the single validated write path · repos as source of truth (DB = rebuildable
projection) · immutable block IDs · Tier-3 educator approval for
publish/registration · orz-markdown as the only markdown engine.
