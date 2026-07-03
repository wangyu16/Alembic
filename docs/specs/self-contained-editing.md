# Design update: self-contained editing, document contract, universal permalinks

**Date:** 2026-07-03 · **Status:** direction locked (owner decision), implementation not started.
**Relation to [goal.md](../goal.md):** the core idea is unchanged — educators
organize knowledge; the platform handles structure, versioning, GitHub
publication, provenance, and reuse. What changes is *where editing happens*.

## 1. Editing offloads to self-contained files

Editing has largely moved out of the Alembic platform and into the
dual-extension files themselves, built by the sibling orz-family projects
(mother folder `orz-family/`):

| Format | Project | What it is |
|---|---|---|
| `.md.html` | [orz-mdhtml](../../../orz-mdhtml) | self-contained webpage, quietly editable in place (pencil → edit → save) |
| `.slides.html` | [orz-slides](../../../orz-slides) | self-contained slide deck (reveal.js), per-slide in-file editor |
| `.paged.html` | [orz-paged](../../../orz-paged) | self-contained print-paged document (A4/Letter, headers, page numbers), in-browser editor + templates |

**Consequence for the workspace:** Alembic does **not** design built-in
editors. The workspace *plugs in* the `.md.html`, `.slides.html`, and
`.paged.html` in-file editors and hosts them. The platform's jobs remain
registration, validation, versioning, publication, provenance, permalinks,
and reuse — not editing surfaces. (This is the logical end-point of the
existing "editor UI is a replaceable client" rule: the client is now the
file's own editor.)

## 2. Studio is removed

The local Studio page (`/studio`, the anonymous in-browser markdown editor)
is superseded: a self-contained file *is* the local, anonymous, no-account
editor — open it in a browser, click the pencil. Remove the Studio page and
its supporting code when this direction is implemented; don't extend it in
the meantime. ([local-mode.md](local-mode.md) is superseded accordingly.)

## 3. Document contract: origin parity

Documents must be treated equally regardless of how they arrive:

- created inside the workspace,
- uploaded to the workspace, or
- committed/uploaded directly to the corresponding GitHub repository.

This requires a **document contract** (a package-contract extension): a
document is *registered*, not merely *created*, and registration works the
same for internal and external origins. A registration records at least:

- identity and package-relative path (which repo of the pair, which layer);
- carrier kind and format version (via the kind registry / carrier codec);
- embedded-source hash where the format carries source;
- provenance (origin: workspace-created / workspace-uploaded / external
  commit; author; time);
- block IDs where the content is block-bearing (validated, never rewritten);
- public/private status — the two-repo invariant applies identically to
  uploaded and externally committed files (fail-closed).

The existing external-edit reconciliation rules (detect and absorb, never
overwrite; quarantine on invariant violation) are the enforcement path for
the direct-to-GitHub origin; upload and in-app creation route through
`packageOps` as today. Same validation, same registration record, whichever
door a file comes through.

## 4. Every file gets a permalink

Each file in Alembic carries a **permalink** usable for two purposes:

- **cite** — a stable reference for attribution/citation (snapshot-pinned
  when citing a version, per the snapshot/citation model);
- **insert** — paste/click-insert into any page or document (the
  carriers-and-assets live-permalink + pin-at-publish model, extended from
  assets to *all* registered files).

See [carriers-and-assets.md](carriers-and-assets.md) §asset permalinks — that
mechanism generalizes; permalinks are no longer an asset-only feature.

## 5. What this does NOT change

- Two-repo public/private invariant, enforced fail-closed on every path.
- `packageOps` as the single validated write path for app-side writes.
- Repos as the source of truth; app DB stays a rebuildable projection.
- Block identity rules (IDs immutable, never reused, validated on save).
- Tier-3 educator approval for publish/registration.
- orz-markdown as the only markdown engine (all three formats build on it).

## 6. Open questions (not yet decided)

- Study-guide source of record: does the chapter stay a `.md` file with
  `.md.html` generated from it, or become `.md.html`-native with the source
  extracted on registration?
- Fate of the current studio-shell block editor (`/workspace/[id]/edit`):
  transitional until the plug-in editors land, or retired with Studio?
- `.md.pdf` vs `.paged.html`: does `.paged.html` (+ browser print-to-PDF)
  replace the `.md.pdf` export target?
- Upload policy vs the trial-storage decision (trial packages are text-only
  in Postgres; binary upload gated to published packages) — how uploads of
  self-contained HTML files (text, but potentially large) are classified.
