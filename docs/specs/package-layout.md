# Package layout — what a full course package looks like on disk

**Status: DRAFT for owner review (2026-07-04).** The on-disk companion to
contract v2 (Roadmap **R1**): folder structure, naming rules, and metadata,
specified precisely enough that a package **created entirely outside
Alembic** — by hand, by an AI agent, or by another tool — and pushed to
GitHub **registers automatically and completely**. Grounded in
[document-model.md](document-model.md) (locked) and the v1 layout
([package-contract-v1.md](package-contract-v1.md)); v1 packages remain
readable, migration is explicit. Open items marked **[open]**.

## 1. The repositories

A package is one **public repository** (required) and one **companion
private repository** (optional — needed only when private materials exist).
A public-only package is valid; so is an **elements-only package** (assets
with no chapters) — the "start small" path. The manifest links the pair.

## 2. Public repository layout

```
alembic.json                        # manifest — the one required file
metadata/
  course.md                         # canonical course description (md)
concepts/
  course.md                         # course concept map (plain md)
  <chapter>.md                      # chapter concept maps (plain md)
study-guide/
  <chapter>.md.html                 # chapter study guide — source of truth
slides/
  <chapter>.slides.html             # chapter slide deck
assessment-support/
  <chapter>.md                      # assessment guide (methods, plain md)
practice/
  <chapter>.md.html                 # example & practice questions
assets/                             # the shared-elements space [open: name]
  **/*                              # any depth; kind by extension
current/                            # this-term space
  **/*                              # newest set, shown on the site
  archive/<term>/**                 # archived cycles, e.g. archive/2026-spring/
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
served publicly, or included in adaptation. **[open]** v1 used a
`private-instructor/` root — keep that name or simplify to `private/`?

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
v2 is an explicit, logged operation: chapter `.md` → `.md.html` (source
embedded), `materials/` → the assets space, `objectives/` content folds
into concept maps. **[open]** whether Alembic offers one-click migration at
first open or a manual "Upgrade package" action (recommended: manual with
preview — a Tier-3-style deliberate act).

## 8. Open items (owner)

1. **Space folder name:** `assets/` (clear for external creators) vs
   keeping v1's `materials/` (no rename in migration). Recommendation:
   `assets/` — the spec's audience is now people writing packages by hand.
2. **Private repo root:** `private/` vs v1's `private-instructor/`.
   Recommendation: `private/`.
3. **`current/` archiving convention:** `current/archive/<term>/` as above,
   with `currentTerm` in the manifest labeling the active cycle — confirm.
4. **Template repository:** ship a `create-alembic-package` template repo
   (README + skeleton + one example chapter) so external creation starts
   from a working example — recommended, cheap, doubles as the spec's
   executable documentation.
