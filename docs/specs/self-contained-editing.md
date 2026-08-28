# Design update: self-contained editing, document contract, universal permalinks

**Date:** 2026-07-03 · **Status:** direction locked (owner decision);
**substantially implemented** — Studio removed (§2), the registration record and
migration `0014_documents` shipped, the `/d/{docId}` resolver ships, and the
hosted in-file editors for `.md.html` / `.slides.html` are live. *(Header
corrected 2026-08-28 — it said "implementation not started", which caused
readers to discount a doc that mostly describes shipped behavior. Three specific
passages below are now WRONG rather than merely pending: the `.md.html`-native
study guide in §6, "block IDs … never rewritten" in §4, and the 302-redirect
resolution model in §7. Each carries its own correction.)*
**Companion:** [../SteeringNote.md](../SteeringNote.md) — the owner's living
steering note for this direction; it is refined ahead of this spec, so treat
it as newer thinking where the two disagree.
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
editor — open it in a browser, click the pencil.
([local-mode.md](local-mode.md) is superseded accordingly.)

**Done 2026-07-04:** `/studio` (and its studio-only `/api/render/md-html`
route) removed; replaced by **`/guide`** — a brief educator-facing
orientation page (owner decision). Header nav and homepage now point to the
guide.

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
- block IDs where the content is block-bearing — **a well-formed existing id is
  preserved** across saves and AI rewrites (that is the immutability rule).
  "Never rewritten" overstates it: a save **mints** an id for a block that has
  none, and **re-mints** one for a marker that is present but malformed. Missing
  ids are legal (anonymous sections); only malformed or duplicate ids fail
  validation. *(Corrected 2026-08-28; matches
  [upload-contract.md](upload-contract.md) and
  [package-contract-v2.md](package-contract-v2.md) §4.)*
- public/private status — the two-repo invariant applies identically to
  uploaded and externally committed files (fail-closed).

The existing external-edit reconciliation rules (detect and absorb, never
overwrite; quarantine on invariant violation) are the enforcement path for
the direct-to-GitHub origin; upload and in-app creation route through
`packageOps` as today. Same validation, same registration record, whichever
door a file comes through.

## 4. Every file gets a permalink — in one of two classes

Each registered file carries a **permalink**, but files split into two
classes with different contracts (owner clarification, 2026-07-03):

- **Documents (final views).** The dual-extension files — `.md.html`,
  `.slides.html`, `.paged.html` — are *final user-facing views*. They are
  **never inserted/transcluded into anything**. Their permalink is a
  **promise of findability**: share it, cite it (snapshot-pinned), and
  always be able to locate that specific file — with its built-in viewer
  and editor coming along in the file itself.
- **Objects (insertable sources).** Images, audio, raw markdown fragments,
  data files, structures/plots, …. Their permalink is used **directly as a
  `src`** to embed into a page (`<img src>`, `<audio src>`, markdown
  include/reference). This extends the carriers-and-assets asset-permalink
  model to all insertable objects.
- **HTML units:** an `<iframe>` *may* embed an HTML page/unit when nothing
  else works, but it is **not a preferred solution** — prefer inserting the
  underlying objects/markdown and rendering in place.

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

- **⭐ NEXT DESIGN SESSION (owner, 2026-07-03): the document taxonomy.**
  What types of documents a course package should have, in what formats,
  with what functions — the detailed per-type descriptions. This is the
  next most important set of questions and blocks the document contract's
  schema. The owner asked to be reminded to continue with these.
- ~~Study-guide source of record~~ ~~**DECIDED (2026-07-04):** `.md.html`-native~~
  → **RE-DECIDED, and this is the permanent answer (2026-07-08, confirmed
  2026-08-28): lean `.md`.** The committed source of record is
  `study-guide/<slug>.md`; the `.md.html` is a **generated** editing/viewing
  surface and is never committed. Meaningful per-file history and the
  no-lock-in legibility promise both require lean sources. Registration still
  extracts and hashes embedded source — that is how an *uploaded* `.md.html` is
  absorbed back into its `.md`. See
  [educator-version-contract.md](educator-version-contract.md) §7.
- ~~Fate of the studio-shell block editor~~ **DECIDED, and done**: it was the
  interim surface and the hosted in-file editors reached parity —
  `HostedStudyGuideEditor` (study guide + practice) and `HostedSlidesEditor`
  (authored decks) are live; the block editor remains only as a fallback.
- ~~`.md.pdf` vs `.paged.html`~~ **DECIDED**: `.paged.html` (+ browser
  print-to-PDF) replaces the `.md.pdf` export target (see goal.md).
- ~~Upload policy vs the trial-storage decision~~ **DECIDED and shipped.**
  `uploadVerdict` (`apps/web/src/lib/collection-upload.ts`) classifies by
  text-vs-binary and size: binaries need a published package (trials stay
  text-only in Postgres, the permanent policy), with a warn threshold and a hard
  block above it. Whole-course zips have their own stated **50 MB** limit
  (`MAX_PACKAGE_ZIP_BYTES`) and travel through the staging bucket, not a request
  body. *(Corrected 2026-08-28 — this was still listed as open.)*

## 7. Permalink mechanism (proposal — recommended, pending owner approval)

Raw GitHub links (`raw.githubusercontent.com`) are rejected: they serve
`text/plain` + `nosniff` (self-contained HTML shows as source, never a
page), embed username/branch/path (break on rename, move, or transfer),
can't serve private files, and pin only via commit SHAs (Git-speak).

**Proposal: ID-based permalink indirection owned by Alembic, with GitHub
doing the serving wherever possible.**

- **Shape:** `alembic.orz.how/d/{docId}` (live) ·
  `/d/{docId}@{snapshot-name}` (pinned, for citation) ·
  `/d/{docId}/blocks/{blockId}` (markdown-fragment insert — block IDs
  already exist in source). The `docId` is minted by the document
  contract's registration record; the ID→current-path mapping is updated on
  rename/move/transfer while the ID never changes. This is a primary reason
  registration must be origin-agnostic (§3).
- **Resolution, layered.** *(Corrected 2026-08-28 — the proposal below was
  **not** what shipped, and the difference is deliberate.)* The `/d/{docId}`
  resolver (`apps/web/src/app/d/[docId]/route.ts`) **does not 302-redirect**.
  Public + GitHub-backed files are **platform-served from the public repo with
  the correct MIME type**: `raw.githubusercontent.com` is an internal transport
  only — it answers `text/plain` with `nosniff`, so a self-contained HTML
  document redirected there would display as source code instead of rendering.
  Private / trial-sandbox / owner-only files are served through the platform
  (github-bridge App token or Supabase) with access checks — the
  `/api/asset/{pkg}/{path}` pattern generalized, as proposed. The no-lock-in
  argument is unaffected: the educator's own Pages site and repositories are
  still the durable, Alembic-independent copy; the permalink is a stable
  *citation* address, not the only way to reach the file.
- **Per-class behavior (see §4):**
  - *Document permalinks* (final views; never embedded): share → browser
    renders the file, whose built-in viewer/editor satisfy "editor and
    viewer always available"; cite → `@snapshot` pins to the tag; find →
    the ID promise survives rename/move/transfer. Optional `?edit` opens
    the file hosted in the workspace so saves return through `packageOps`.
  - *Object permalinks* (insertable sources): the URL is the `src`. It must
    therefore serve the **raw bytes** with the correct `Content-Type`,
    permissive CORS for public objects, and cache headers split by form
    (live link: short cache; `@snapshot`: immutable). Raw markdown
    fragments (`/blocks/{blockId}`) serve `text/markdown` for
    include-style insertion. GitHub Pages provides MIME+CORS for the
    public-redirect path; the platform proxy provides them for
    private/trial.
  - *Not supported:* transcluding a rendered dual-extension document into
    another document. `<iframe>` embedding of an HTML unit stays a
    tolerated fallback, never the recommended insert path.
- **Self-describing files:** stamp the canonical permalink into each
  generated file's carrier metadata, so downloaded copies know their home.
- **Trade-off:** the resolver is platform infrastructure with a
  sustainability obligation (same class as the portal). Mitigation: for
  public content the resolver only adds stability (redirect), it is not a
  dependency; IDs recorded in provenance keep links reconstructible.
