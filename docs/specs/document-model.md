# Document model — package structure, taxonomy, versioning, discovery

**Status: direction locked (owner-reviewed 2026-07-04).** Synthesized from
the owner's [UserInputs/userguide.md](../UserInputs/userguide.md),
[SteeringNote.md §3b](../SteeringNote.md), and the 2026-07 direction
([self-contained-editing.md](self-contained-editing.md)); the four open
questions were ruled by the owner same-day (assessment guide public +
adapt-included; pin at insert; one-click "share this" opt-in; current space
excluded from element search). This spec supersedes the taxonomy/asset
portions of [carriers-and-assets.md](carriers-and-assets.md) (codec details
remain there until the specs rebuild reaches it).

## 1. Principles

- **The file is the atom.** Every shareable thing is a file with its own
  version history and permalink. The chapter study guide is one `.md.html`
  file; sections are internal structure, not storage units. Block IDs are
  optional in-file anchors (citation, provenance, AI merge assistance) — not
  units of editing or sharing.
- **Two share levels.** Individual files (each versioned + permalinked) and
  whole packages (united version control via named snapshots + one share
  point). A package snapshot pins every file at once.
- **Start small is a first-class path.** An educator may contribute a single
  element (an illustration, a derivation, a concept explanation) into
  `assets` and make it discoverable — no complete course required. Any small
  piece of contribution can be published for others to use.
- **Version naming:** files carry a plain dated history (from Git); *named*
  versions exist only at package level (snapshots).

## 2. What a complete course package contains

### Course level

| Item | Format | Function | Visibility | Adapt |
|---|---|---|---|---|
| Course concept map | `.md` (basic markdown, renderable by any parser) | Course-level topics/concepts/objectives and their correlations | In public repo, **not** on the course website | Included in whole-course adaptation |
| Course website index | generated | Organizes all public-facing resources; study guide at the center; everything easy to find | Public (GitHub Pages) | n/a (generated) |

### Per chapter

| # | Item | Format | Function | Visibility | Adapt |
|---|---|---|---|---|---|
| 1 | Chapter concept map | `.md` | Chapter-level topics/concepts/objectives + correlations | Public repo, not on website | Included |
| 2 | **Study guide** (name flexible: lecture note, handout, …) | `.md.html` | Complete description of topics/concepts/objectives with illustrations, tables, examples; concise companion when a textbook exists, textbook-grade detail when not. **Includes everything; the chapter's source of truth.** | Public-facing | Included |
| 3 | Slides | `.slides.html` | Deck derived from the study guide — same outline, concise bullets, reuses its graphics/tables | Public-facing | Included |
| 4 | Assessment guide | `.md` | *How* to assess each topic/concept: question kinds and phrasing, differentiation across assignment/discussion/quiz/exam, example question ideas per objective. Methods, not a question pool. | Public repo, **not** on the course website (not private) | **Automatically included** when adapted |
| 5 | Example & practice questions | `.md.html` | Questions created per the assessment guide, showing students what to expect | Public-facing | Included |
| 6 | **Assets** (space, not a file) | any (images, reaction schemes, plots, diagrams, markdown-source pieces, pdf/docx/pptx, …) | Individual reusable elements; each file searchable and adaptable on its own | Public repo; per-file discoverable | Per-file |
| 7 | **Current** (space) | any; prefer `.paged.html` for exam sheets/handouts | Current teaching cycle: this semester's assignment list, completed exams with keys for student review, …. Newest set shown on the website; on semester turnover the old set is archived. | Public-facing (website shows newest set; inclusion per instructor) | **Not** auto-included |
| 8 | **Private** (space) | any; prefer `.paged.html` for exams/handouts | Confidential (exam questions with keys), personal notes, unfinished drafts | **Private repo** — no public link, not discoverable, not adaptable | Never |

Rows 1–5 are one file per chapter each; 6–8 are file spaces with a file
organization interface in the workspace.

## 3. Element lifecycle: publish → discover → improve → fork

The element-level improvement loop (owner's example: a shared illustration):

1. **Publish** a single element into `assets`; make it discoverable.
2. **Discover & insert:** others find it (element search) and insert it into
   their course documents by permalink (`src`).
3. **Report & correct:** a user reports a mistake; the author corrects it;
   **everyone using the element is notified to update.**
4. **Revise & fork:** a user makes a revision/expansion; users are notified;
   each may **adapt** to the revision or **keep** the original — the element
   forks into versions, each with its own lineage.

Implications (new platform capabilities):

- **Insertion registry:** to notify "everyone using this picture," the
  platform records which registered documents reference which element
  permalinks (rebuildable projection — references live in the files).
- **Notifications:** element-level notices (correction available, revision
  available) delivered in educator terms.
- **Insert default (decided): pin at insert.** Inserted references point at
  a pinned version; when the element gains a new version (correction or
  revision/fork), users are notified and each chooses update or keep. A live
  permalink would propagate changes silently, removing that choice.

## 4. Registration & discovery

- Every file registers per the document contract (origin parity: created /
  uploaded / direct-commit). Registration records identity, path/layer, kind,
  format version, source hash, provenance, license, description/alt text,
  permalink class.
- **Discover searches two scopes:** whole course packages (today's portal)
  and **elements** (individual files). Element discoverability is **per
  file**, not gated on whole-package listing — supporting the start-small
  path. Files in `private` are never discoverable; `current` files are
  **excluded from element search** (semester ephemera, not reusable OER —
  they remain visible on the course website only).
- **Discoverability default (decided): opt-in per file** via a one-click
  **"share this"** affordance. Making something discoverable stays a
  deliberate act (Tier-3 spirit); nothing is indexed merely because the
  repo is public.

## 5. Workspace consequences

- Metadata editing + document organization (spaces 6–8 need a file manager).
- Basic `.md` files: a **simple text editor with a rendered-view toggle**
  (the one deliberately minimal editing surface Alembic provides; concept
  maps and assessment guides are plain markdown).
- `.md.html` / `.slides.html` / `.paged.html`: the workspace hosts each
  file's **built-in editor** and saves back to the repository through the
  validated write path.
- Editor registration stays open for new types (as `.ketcher.svg` does
  today) — the `editor-kit` module mechanism generalizes.

## 6. Contract impact (v2 direction)

The current contract's nine closed layers and section-block editing model
predate this structure. This taxonomy implies an explicit, versioned schema
evolution (never a silent rewrite): per-chapter file set (concept map, study
guide, slides, assessment guide, practice), the `assets` / `current` /
`private` spaces, per-file registration records, and semester archiving for
`current`. Old packages must remain readable; migration is an explicit,
logged operation. Details belong to the package-contract spec rebuild.
