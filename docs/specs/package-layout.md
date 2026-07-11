# Package layout — what a full course package looks like on disk

**Status: direction locked (owner-reviewed 2026-07-04).** The on-disk
companion to contract v2 (Roadmap **R0/R1**): folder structure, naming
rules, and metadata, specified precisely enough that a package **created
entirely outside Alembic** — by hand, by an AI agent, or by another tool —
and pushed to GitHub **registers automatically and completely**. Grounded
in [document-model.md](document-model.md) and the v1 layout
([package-contract-v1.md](package-contract-v1.md)); v1 packages remain
readable, migration is explicit. The four §8 items were ruled by the owner
same-day (all per recommendation: `assets/`, `private/`,
`current/<term-id>/` + `currentTerm` pointer, template repository ships).

## 1. The repositories

A package is one **public repository** (required) and one **companion
private repository** (optional — needed only when private materials exist).
A public-only package is valid; so is an **elements-only package** (assets
with no chapters) — the "start small" path. The manifest links the pair.

## 2. Public repository layout

```
alembic.json                        # manifest — the one required file
                                     # (course description + tags/keywords
                                     # are manifest fields now, not files —
                                     # owner decision 2026-07-09, superseding
                                     # this section's original "canonical
                                     # course description (md)" framing for
                                     # metadata/course.md below; see Status.md)
metadata/
  course.md                         # "Course concept map" — free-form notes
                                     # on concepts/topics/objectives, any
                                     # structure; never published or shown on
                                     # Discover
concepts/
  <chapter>.md                      # per-chapter concept-map notes (plain md,
                                     # the "Concept map" category rail item) —
                                     # distinct from the structured JSON
                                     # concept/objective records
                                     # (packages/package-contract/src/concepts.ts,
                                     # deferred — data layer only, no editor yet)
study-guide/
  <chapter>.md.html                 # chapter study guide — source of truth
slides/
  <chapter>.slides.html             # chapter slide deck
assessment-support/
  <chapter>.md                      # assessment guide (methods, plain md)
practice/
  <chapter>.md.html                 # example & practice questions
assets/                             # the shared-elements space (decided)
  **/*                              # any depth; kind by extension
current/                            # this-term space (pointer model)
  <term-id>/**                      # one folder per term, e.g. 2026-fall/;
                                    # manifest.currentTerm names the active one,
                                    # every other <term-id>/ is an archived cycle
provenance/                         # attribution & adaptation records
.alembic/                           # platform bookkeeping — REBUILDABLE,
                                    # never required for registration
```

A committed site build configuration (the no-lock-in guarantee) is created
by Alembic on first publish; external creators may omit it.

## 3. Private repository layout (when present)

```
private/                            # the whole repo is the Private space
  <chapter>/**                      # optional per-chapter grouping
  **/*                              # exams+keys, personal notes, drafts
```

Nothing in the private repository is ever registered as discoverable,
served publicly, or included in adaptation. (Decided: `private/`; v1's
`private-instructor/` maps to it in migration.)

## 4. Naming rules

- **Chapter slugs:** `[a-z0-9-]+` (kebab-case), unique per package; the
  same slug names the chapter's files across all five per-chapter folders
  (`concepts/acids.md`, `study-guide/acids.md.html`, `slides/acids.slides.html`, …).
- **File kind = extension**, resolved longest-suffix against the kind
  registry: `.md.html`, `.slides.html`, `.paged.html`, `.ketcher.svg`,
  `.plot.svg`, `.md`, plus plain media (`.png`, `.svg`, `.jpg`, `.mp3`,
  `.pdf`, …) in the spaces.
- **Space file names:** URL-safe (`[A-Za-z0-9._-]`, no spaces) — they
  become permalink paths and site URLs.
- Not every chapter needs every file: a chapter is valid with only its
  study guide; slides/practice/concept map/assessment guide are optional
  per chapter.

## 5. The manifest (`alembic.json`, schema v2 sketch)

```jsonc
{
  "schemaVersion": 2,
  "title": "Intro Acid–Base Chemistry",
  "license": "CC-BY-4.0",            // SPDX; per-file overrides live in
                                      // registration, default is this
  "unitTerm": "chapter",              // chapter|module|lesson|unit|week
  "chapters": [                       // order = teaching order
    { "slug": "acids", "title": "Acids and Bases" }
  ],
  "privateRepo": { "owner": "…", "name": "…" },   // optional
  "currentTerm": "2026-fall"          // optional; labels the current/ space
}
```

Everything else (per-file descriptions, alt text, discoverability, change
kinds, docIds) lives in **registration records**, not the manifest — the
manifest stays small enough to write by hand.

## 6. Auto-registration (door #3, end to end)

1. **Adopt:** the educator signs in and points Alembic at the repository
   (explicit GitHub-App installation consent — goal.md's adoption step).
   Alembic never registers repos it wasn't invited to.
2. **Validate:** manifest parses; layout paths map to known folders/spaces;
   kinds resolve by extension; two-repo invariant holds (nothing
   private-shaped in the public repo); carrier files have extractable
   source. Failures produce an educator-language report — fix and push
   again. Nothing is half-registered (fail-closed, quarantine semantics as
   in external-edit reconciliation).
3. **Register:** every file gets a registration record + docId + permalink
   (origin: `external-commit`). Files lacking descriptions/alt text
   register with a **needs-description flag** — surfaced as Inbox items,
   never blocking registration (only blocking "share this" and publish
   gates where a11y requires alt text).
4. **Continue:** subsequent direct pushes flow through the normal
   reconcile-and-register pipeline. Uploading the same file through the
   workspace produces a byte-identical record (origin parity).

## 7. Relation to v1 (migration)

v1 packages (`schemaVersion: 1`, block-based `study-guide/<chapter>.md`,
`materials/` assets, `objectives/`) remain readable forever. Migration to
v2 is an explicit, logged operation — a manual "Upgrade package" action
with preview (a Tier-3-style deliberate act, per recommendation):

- chapter `.md` → `.md.html` (source embedded);
- `materials/` → `assets/`; `private-instructor/` → `private/` (private
  repo root); `objectives/` content folds into concept maps;
- **additive manifest fields**: `unitTerm` (absent → `"chapter"`) and
  `currentTerm` (absent → no active cycle; an empty `current/` space is
  created on migration);
- **`privateRepo` stays nullable**: a public-only package is permanently
  valid. The companion private repo is created *on demand* — at the first
  save of private content (guided step), never as an empty repo at
  graduation. Private-shaped content appearing in the *public* repo is a
  quarantine, exactly as in v1.

## 8. Decisions (owner-ruled 2026-07-04, all per recommendation)

1. **Space folder name: `assets/`** — the spec's audience is people writing
   packages by hand; v1's `materials/` maps to it in migration.
2. **Private repo root: `private/`** (v1's `private-instructor/` maps in
   migration).
3. **`current/` uses the pointer model: `current/<term-id>/`**, with
   `currentTerm` in the manifest naming the active cycle (immutable id) and
   `currentTermLabel` its display name; every other `<term-id>/` is archived.
   Files never move on rollover — the pointer moves.
4. **Template repository ships** (`create-alembic-package`: README +
   skeleton + one example chapter) — the spec's executable documentation;
   an R0 deliverable.
