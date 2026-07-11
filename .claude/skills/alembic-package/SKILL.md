---
name: alembic-package
description: Author a complete Alembic OER package offline (as a directory/zip, or to push to GitHub) that the platform ingests with zero friction. Use when creating course packages — study guides, slides, practice, assets, instructor-only material — outside the Alembic workspace. Covers the directory→repo split (the two-repo invariant), the alembic.json manifest, file formats, stable identity, and pre-upload validation.
---

# Authoring an Alembic package offline

You are creating an **Alembic OER package**: a course's open educational resources, laid out as a directory tree that Alembic turns into a **paired set of GitHub repositories** — one PUBLIC (shared with the world) and one PRIVATE (instructor-only). Your goal is a tree that passes Alembic's structural validator so it can be **uploaded as a zip or pushed to GitHub and ingested with zero friction**.

The educator is not a developer. Never surface Git/developer vocabulary in any content you write for them (use save, publish, share, cite). Repos are an implementation detail; you are laying out *content*.

---

## 0. The one rule you must never break — the two-repo invariant

**Instructor-only material (answer keys, full solutions, exam content, private notes) goes ONLY under `private/`. Everything else is public and will be shared with the world.**

Alembic keeps two repositories and will *refuse* a package that puts private content in a public folder — but it is your job to place every file correctly. When in doubt about whether something is student-facing, put it in `private/`.

The split is **total and decided by the top-level folder**. Every path resolves to exactly one repo:

| Top-level folder | Repo | Holds |
|---|---|---|
| `study-guide/` | **public** | Chapter study guides (the core reading) |
| `slides/` | **public** | Lecture slide decks |
| `practice/` | **public** | Practice questions / worked examples |
| `concepts/` | **public** | Concept maps / learning objectives |
| `assessment-support/` | **public** | Assessment-support content (public parts only) |
| `assets/` | **public** | Reusable media: images, chemical structures, plots, audio, video, PDFs |
| `current/` | **public** | The active teaching term (announcements, assignments) — see §7 |
| `metadata/`, `provenance/` | **public** | Platform bookkeeping (usually leave to Alembic) |
| **`private/`** | **PRIVATE** | **Answer keys, full solutions, exam content, instructor notes — NEVER public** |
| Root files | public repo root | `alembic.json`, `LICENSE`, `README.md`, `CITATION.cff`, `.gitignore` |

Notes:
- `assets/` is the current name; the platform also accepts the older `materials/` (public) and `private-instructor/` (private) for the same purposes. **Prefer `assets/` and `private/`.**
- Nothing else is allowed at the repo root or as a top-level folder. An unrecognized top-level folder is **rejected** (fail-closed) — stick to the folders above.
- Answer keys for a practice set live in `private/` (e.g. `private/answer-keys/set-01.md`), never beside the public practice file.

---

## 1. The package skeleton (minimum required files)

A valid package MUST contain, at the tree root:

1. **`alembic.json`** — the manifest (see §2). Required.
2. **`LICENSE`** — the full license text matching the manifest's `license` field. Required.

And for every chapter you declare in the manifest, its study guide must exist:

3. `study-guide/<chapter-slug>.md` — one per declared chapter (see §3).

That is the enforced minimum. A real course adds slides, practice, assets, and private answer keys.

---

## 2. The manifest — `alembic.json`

A single JSON file at the tree root. **You provide the content; Alembic assigns the repository coordinates.**

### Required fields
| Field | Type | Rule |
|---|---|---|
| `schemaVersion` | number | Use `2`. |
| `packageId` | string | A stable id. Convention: `pkg-<slug>-<8 lowercase-alphanumerics>`, e.g. `pkg-genchem-thermo-a1b2c3d4`. Must be non-empty and stable for the life of the package. |
| `title` | string | The course/package title. |
| `license` | enum | One of: `CC-BY-4.0`, `CC-BY-SA-4.0`, `CC-BY-NC-4.0`, `CC-BY-NC-SA-4.0`, `CC0-1.0`. |
| `createdAt` | string | ISO 8601 **with a `Z` suffix, no numeric offset** — e.g. `2026-07-11T00:00:00Z`. A `+00:00` offset will FAIL validation. |

### Common optional fields
| Field | Type | Notes |
|---|---|---|
| `description` | string | One plain-text paragraph (not markdown), ≤ ~200 words. |
| `keywords` | string[] | Discovery tags. |
| `discipline` | string | Defaults to `"chemistry"`. Set it for other fields. |
| `courseContext` | object | `{ courseName?, level?, institutionType?, instructor?, courseNumber?, department? }` — all optional strings. |
| `chapters` | `{ slug, title }[]` | Ordered units. `slug` must match `^[a-z0-9]+(?:-[a-z0-9]+)*$` (lowercase, digits, single hyphens). Each needs a `study-guide/<slug>.md`. Omit for a single-unit course. |
| `unitTerm` | enum | Wording for a unit: `chapter`\|`module`\|`lesson`\|`unit`\|`week`. Display only. |
| `theme` | string | An orz theme id (e.g. `light-neat-3`, `dark-elegant-1`). |
| `themes` | object | Per-space theme overrides, keyed by space name. |
| `currentTerm` | string | Immutable id of the active term (see §7). Must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`. |
| `currentTermLabel` | string | Human label, e.g. `Fall 2026`. |

### Do NOT set (Alembic assigns these)
- `publicRepo`, `privateRepo` — the repository coordinates. Omit them; the platform fills them in when the package is published.

### Minimal manifest
```json
{
  "schemaVersion": 2,
  "packageId": "pkg-intro-thermo-a1b2c3d4",
  "title": "Introduction to Thermochemistry",
  "license": "CC-BY-4.0",
  "createdAt": "2026-07-11T00:00:00Z"
}
```

### Full example
```json
{
  "schemaVersion": 2,
  "packageId": "pkg-genchem-thermo-a1b2c3d4",
  "title": "General Chemistry: Thermochemistry",
  "description": "A one-unit introduction to energy, heat, and enthalpy for first-year chemistry.",
  "keywords": ["chemistry", "thermochemistry", "enthalpy", "OER"],
  "discipline": "chemistry",
  "license": "CC-BY-4.0",
  "unitTerm": "chapter",
  "courseContext": {
    "courseName": "General Chemistry I",
    "level": "undergraduate",
    "instructor": "Dr. A. Educator",
    "courseNumber": "CHEM 101",
    "department": "Chemistry"
  },
  "chapters": [
    { "slug": "01-energy", "title": "Energy and heat" },
    { "slug": "02-enthalpy", "title": "Enthalpy" }
  ],
  "createdAt": "2026-07-11T00:00:00Z"
}
```

---

## 3. Study guides — `study-guide/<slug>.md` (PLAIN markdown)

The chapter study guide is the core artifact. It is **plain markdown at `study-guide/<slug>.md`** — NOT a `.md.html` file. Alembic renders it to a shareable page on publish.

Structure:
- Optional leading `# Title` and intro paragraph (the *preamble*).
- Each **section is an H2 heading** (`## ...`); everything under it (including `###` subsections) belongs to that section, until the next `##`.
- A section may carry a **stable block id** appended to its heading: `## Heat and work {{attrs[#blk-<12 lowercase-alphanumerics>]}}`. Block ids are **optional** but recommended for durable citation/provenance. If present they must be well-formed (`blk-` + 8+ lowercase alphanumerics) and **unique within the file**. Generate a fresh random id per section; never reuse or renumber them.
- Code fences are respected — a `##` inside a fenced block is not a heading.

Example:
```markdown
# Energy and heat

This chapter introduces energy, heat, and the first law.

## What is energy? {{attrs[#blk-7f3a91c2e0d4]}}

Energy is the capacity to do work...

## Heat vs. temperature {{attrs[#blk-2b8e4a1096ff]}}

Heat is energy in transit...
```

Reference figures with **relative paths** to `assets/` — Alembic rewrites them to durable links on ingest:
```markdown
![Enthalpy diagram](../assets/figures/enthalpy.png)
```

---

## 4. Self-contained documents — `.md.html`, `.slides.html`, `.paged.html`

Some documents are **self-contained HTML files** that carry their own editor/renderer:
- `.slides.html` — a slide deck (`slides/lecture-01.slides.html`).
- `.paged.html` — a paginated print/PDF document.
- `.md.html` — a self-contained continuous document (used for practice sets or standalone pages; the *chapter study guide* stays plain `.md`, see §3).

**Do not hand-write these.** Generate them with the orz-family command-line tools, which produce a valid, byte-correct file:
- Decks: **orz-slides** — author a deck source in orz-slides markdown, then build it. Skill: `https://cdn.jsdelivr.net/npm/orz-slides/orz-slides-skills/SKILL.md`
- Continuous docs: **orz-mdhtml** — Skill: `https://cdn.jsdelivr.net/npm/orz-mdhtml/orz-mdhtml-skills/SKILL.md`
- Paginated docs: **orz-paged** — Skill: `https://cdn.jsdelivr.net/npm/orz-paged/orz-paged-skills/SKILL.md`

Follow those skills for the exact source grammar and CLI. All three self-contained formats are **public** — place them under `slides/`, `practice/`, or `assets/` (a self-contained document must never live under `private/`).

### Stable identity for self-contained documents (recommended)
To give a self-contained document a **permalink that survives edits, renames, and re-uploads**, embed a unique id in its metadata island. In the file's `<head>`:
```html
<script type="application/orz-meta+json" id="orz-meta">
{ "uid": "doc-<12 lowercase-alphanumerics>" }
</script>
```
- The `uid` becomes the document's permanent id in Alembic. Generate a **fresh, unique** `uid` per document (format: `doc-` + 12 lowercase alphanumerics). **Never reuse a uid across two files** — duplicate uids collapse to one document.
- The orz CLIs can write this island for you via document metadata; prefer that over hand-editing.
- Plain files (`.md`, images, PDFs) do not carry a uid; their identity is their location — that is fine.

---

## 5. Assets — `assets/`

Reusable media and editable objects go under `assets/` (public). Recognized types:

| Extension | Kind | Notes |
|---|---|---|
| `.png` `.jpg` `.jpeg` `.gif` `.webp` `.avif` `.svg` | Image | Plain raster/vector images. |
| `.ketcher.svg` | Chemical structure | Editable structure object (produced by Ketcher / the orz tooling). |
| `.plot.svg` | Plot | Editable plot object. |
| `.mp3` `.wav` `.m4a` `.ogg` | Audio | |
| `.mp4` `.webm` `.mov` | Video | |
| `.pdf` | Download | Handout / printable. |
| `.csv` | Data | |
| `.md` | Markdown snippet | Insertable/transcludable source. |

Rules:
- A renderable/editable object (`.ketcher.svg`, `.plot.svg`, `.md.html`, `.slides.html`, `.paged.html`) MUST be public — validation rejects one placed under `private/`.
- Organize freely with sub-folders (`assets/figures/`, `assets/structures/`, `assets/data/`). There is no required sub-structure.
- To scope an asset to one chapter, you may nest it: `assets/chapters/<chapter-slug>/figure.png`. Otherwise it is course-wide.

---

## 6. Private material — `private/`

Everything the students must not see:
- `private/answer-keys/<name>.md` — solutions to practice/exams.
- `private/notes/<name>.md` — instructor notes, teaching tips.
- `private/exams/<name>.md` — exam content.

Plain markdown is ideal here. **Never** place a self-contained renderable document or a shared asset under `private/`.

---

## 7. The current term — `current/<term-id>/` (optional)

For time-bound teaching (announcements, this-term assignments), use the `current/` space, which is scoped by an immutable **term id**:
- Path: `current/<term-id>/<section>/<file>`, where `<term-id>` matches `^[a-z0-9]+(?:-[a-z0-9]+)*$` (e.g. `2026-fall`).
- Set `manifest.currentTerm` to that same `<term-id>` and `manifest.currentTermLabel` to a human label (`"Fall 2026"`).
- Reserved sections (conventional folder names): `announcements/`, `assignments/`, `misc/`.
  - `announcements/` — timestamped `.md` notes shown to students this term.
  - `assignments/` — this-term assignments (`.md`, `.md.html`, `.paged.html`, or a `.pdf`).

Example: `current/2026-fall/announcements/welcome.md`, with `"currentTerm": "2026-fall"` in the manifest.

---

## 8. Naming rules (must follow)

- **Chapter slug** and **term id**: `^[a-z0-9]+(?:-[a-z0-9]+)*$` — lowercase letters, digits, single hyphens. No spaces, underscores, uppercase, or dots.
- **Block id**: `blk-` + 8+ lowercase alphanumerics, unique within a file.
- **Document uid**: `doc-` + 12 lowercase alphanumerics, unique across the whole package.
- **No `..`** anywhere in a path (traversal is rejected).
- File base names: keep them simple (lowercase, hyphens). Avoid spaces.
- Extensions are matched by **longest suffix**: `chapter.md.html` is a self-contained document (not a plain `.md`); `benzene.ketcher.svg` is a structure object (not a plain `.svg`).

---

## 9. Validate before you ship

Before zipping or pushing, the package must pass Alembic's structural validator — the *same* check the platform runs on ingest. If it passes, ingestion is friction-free.

Conceptually, the validator (`validatePackageForImport` in `@alembic/package-ops`, wrapping the pure `validateProject` in `@alembic/package-contract`) checks:
1. `alembic.json` parses and is a valid manifest; `alembic.json` and `LICENSE` are present.
2. Every file sits in a folder allowed for its repo (the two-repo invariant) — derive each file's repo with `repoForPath(path)`.
3. Every declared chapter has its `study-guide/<slug>.md`.
4. Every renderable object (`.ketcher.svg`/`.plot.svg`/`.md.html`/`.slides.html`/`.paged.html`) is in a public folder.

Self-check without the code:
- [ ] `alembic.json` at root, valid, `createdAt` ends in `Z`, no `publicRepo`/`privateRepo`.
- [ ] `LICENSE` at root, matching the manifest license.
- [ ] Each chapter in the manifest has `study-guide/<slug>.md` (plain markdown).
- [ ] Nothing student-facing is under `private/`; no answer keys/solutions outside `private/`.
- [ ] No renderable object under `private/`.
- [ ] Only recognized top-level folders (§0); no stray files at the root beyond the allowlist.
- [ ] Slugs, term ids, block ids, and uids match their patterns; every `uid` is unique.
- [ ] Self-contained `.slides.html`/`.md.html`/`.paged.html` were built with the orz CLIs, not hand-written.

---

## 10. Delivering the package

- **As a zip:** zip the whole tree (with `alembic.json` at the archive root) and upload it in Alembic.
- **To GitHub directly:** the public files (everything except `private/`) go to the package's public repository; the `private/` subtree goes to the private repository. Never commit `private/` content to the public repo, even transiently.

Alembic assigns the repository coordinates, mints any missing ids, and registers every document — created, uploaded, or committed — identically.

---

## Reference layout

```
my-course/
├─ alembic.json
├─ LICENSE
├─ README.md                      (optional)
├─ study-guide/
│  ├─ 01-energy.md
│  └─ 02-enthalpy.md
├─ slides/
│  └─ lecture-01.slides.html      (built with orz-slides; carries a uid)
├─ practice/
│  └─ set-01.md.html              (built with orz-mdhtml; carries a uid)
├─ assets/
│  ├─ figures/enthalpy.png
│  ├─ structures/benzene.ketcher.svg
│  └─ data/heat-capacities.csv
├─ current/
│  └─ 2026-fall/
│     └─ announcements/welcome.md
└─ private/
   ├─ answer-keys/set-01.md
   └─ notes/pacing.md
```
