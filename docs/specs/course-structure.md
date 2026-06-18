# Course Structure — target model and v0.1 mapping

How a full **course** is organized, and how today's single-study-guide demo is
the degenerate case of that model. This document exists so multi-chapter
courses are a *fill-in*, not a rewrite: nothing in v0.1 forecloses it.

Related: [package-contract-v1.md](package-contract-v1.md) · [../Roadmap.md](../Roadmap.md)

---

## Target model

A **course = one package = one static website.** Within it:

- **Course index** — the site landing page (table of contents over chapters).
- **Course-level concept map + objectives** — the hidden planning layer for the
  whole course ("open does not mean flat"): stored, optionally published, not
  cluttering the student site.
- **Chapters (modules)** — each chapter is the working unit, containing:
  - chapter **concept map** + **objectives**;
  - **study guide** — the chapter's authoritative prose; **one chapter = one
    student webpage**;
  - **slides** — derived from the study guide;
  - **question templates** — how to ask questions about each topic/concept for
    different purposes (assignment, discussion, quiz, exam, …); private answer
    keys stay in the private repo.

The study guide remains the spine; slides and question generation derive from
its blocks and stay traceable to them (study-guide-centered principle).

## Repository layout (multi-chapter)

The package layers already in the contract carry this with no new layers —
chapters are a *naming convention within layers*, not a new top-level concept:

```
<course>-oer/ (public)
├── alembic.json                      # manifest; gains a chapter index (below)
├── concepts/
│   ├── course.json                   # course-level concept map
│   └── ch01.json, ch02.json …        # per-chapter concept maps
├── objectives/
│   ├── course.json
│   └── ch01.json …
├── study-guide/
│   ├── 01-stoichiometry.md           # one file == one chapter == one webpage
│   ├── 02-thermochemistry.md
│   └── …
├── materials/
│   └── slides/ch01.slides.html …     # derived slides per chapter
├── assessment-support/
│   └── question-templates/ch01.json… # public-safe question-template rules
├── provenance/ · metadata/
└── (built site → gh-pages: index.html + chapter pages + slides)

<course>-private/ (private)
└── private-instructor/
    ├── notes/ch01.md …
    └── answer-keys/…                 # keys for generated questions
```

## What v0.1 does today (the degenerate case)

A v0.1 package is a **one-chapter course**: a single
`study-guide/01-getting-started.md` rendered to a single-page site, with flat
worksheets under `materials/`. This is the n=1 special case of the model above,
chosen deliberately for the demo.

## Why it isn't foreclosed (current code is already general where it counts)

| Concern | Status today |
| --- | --- |
| Multiple chapter files | `loadStudyGuide`/`saveStudyGuide` already take a `path`; `DEFAULT_STUDY_GUIDE_PATH` is just the v0.1 default. Storage key `(package_id, repo, path)` already holds many files. |
| Block identity across chapters | IDs are globally unique (`newBlockId`) and live in source — they work the same across any number of files. |
| Layers for concepts/objectives/slides/question-templates | All already exist in the contract (`concepts`, `objectives`, `materials`, `assessment-support`, `private-instructor`). |
| Two-repo invariant | Path-based; multi-chapter public files and private keys classify correctly with no change. |
| One site per course | Already true — a package builds to one Pages site. |
| Derived-artifact drift tracking | Already records source block IDs + hashes; applies per chapter unchanged. |

## Contained changes to reach the target (all additive)

None require migrating existing single-chapter packages.

1. **Manifest:** add an optional `chapters: [{ slug, title, order }]` index
   (absent → treat the single study-guide file as the one chapter).
2. **package-ops:** a `listChapters` / per-chapter load/save over the existing
   path-parameterized ops (the path convention is centralized in
   `chapterStudyGuidePath`).
3. **renderer `buildSite`:** take `chapters: [{ slug, title, markdown }]` and
   emit one page per chapter plus an index linking them (today's single
   `studyGuideMarkdown` becomes the one-element case).
4. **editor UI:** a chapter list/switcher wrapping the existing single-doc
   editor (the editor itself already edits one study-guide doc by path).
5. **concept map / objectives / slides / question templates:** new editors and
   generators writing to the layers above — these are Roadmap Phase 2–4 work
   (Ketcher/import, snapshots; assessment & question templates), not v0.1.

## Display: unit term, page name, and the chapter h1

Three educator-facing refinements, all additive and display-only — the data
model is unchanged (a unit is always a `ChapterRef { slug, title }`):

- **Unit term** — a course calls its units "chapters", "modules", "lessons",
  "units", or "weeks". Stored as `manifest.unitTerm` (optional; absent →
  "chapter"). Pure wording: `unitTermForms()` derives singular/plural for the
  UI; it never changes paths or structure. Set at package creation and editable
  from the editor's **Manage** dialog (`setUnitTerm`).
- **Page name vs. title.** `slug` is the **page name** — the file name
  (`study-guide/<slug>.md`) and the public URL segment (`chapters/<slug>.html`);
  `title` is the display name and the page **h1**. They are independent: set
  both at creation, rename the title freely, and rename the page name via
  `renameChapterPageName` — which moves **every** slug-keyed file (study-guide
  page, chapter `concepts/<slug>.json`, `objectives/<slug>.json`) and updates
  the manifest. Block IDs are untouched, so derived artifacts stay linked. The
  page name change alters the public URL, so the UI warns first.
- **Chapter title as h1.** Each chapter page renders its title as an `<h1>` at
  the top, injected at render time from the manifest title (single source of
  truth — not authored in the markdown, where blocks are h2). Applies to the
  published build (`buildCourseSite`) and the editor preview (`renderDocument`'s
  `heading`).

## Compatibility guarantee

A v0.1 single-chapter package stays valid forever: with no `chapters` index it
is read as a one-chapter course. Adding chapters — or a `unitTerm` — is an
additive, logged change under the contract's versioning policy, never a silent
rewrite. Old packages with no `unitTerm` read as "chapter".
