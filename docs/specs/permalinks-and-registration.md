# Permalinks & registration — the document contract in practice

**Status: direction locked (owner-reviewed 2026-07-04).** Consolidates the
permalink mechanism ([self-contained-editing.md §7](self-contained-editing.md))
with the file-as-atom / two-level-sharing decisions
([document-model.md](document-model.md)). The three open items were ruled
same-day (content-hash pins; platform-served pinned resolution; in-app
inbox notifications). Supersedes the permalink portions of
[carriers-and-assets.md](carriers-and-assets.md) §5–6 (raw GitHub URLs are
demoted to an internal transport, never the shared form).

## 1. Registration record (the document contract)

Every file in a package is **registered** — identically whether it was
created in the workspace, uploaded to it, or committed directly to GitHub
(origin parity; the reconciliation path registers external commits). The
record is a **rebuildable projection** (repos stay the source of truth):

| Field | Notes |
|---|---|
| `docId` | minted at first registration; immutable; survives rename/move/repo transfer |
| package, repo, path | current location (updated on rename/move) |
| layer / space | study-guide · slides · concept-map · assessment-guide · practice · assets · current · private |
| kind + format version | from the carrier kind registry (`md`, `slides`, `paged`, `ketcher`, `plot`, image, audio, plain md, …) |
| permalink class | **document** (final view) or **object** (insertable) |
| source hash | for carrier formats: hash of embedded markdown source |
| provenance | origin (created / uploaded / external-commit), author, time, `adapted-from` lineage |
| description / alt text | required for objects (a11y + element search) |
| license | inherited from package unless overridden per file |
| discoverable | boolean; set only by the owner's one-click **"share this"** (default false) |

Registration happens on: create, upload, save, and reconcile-absorb. A
deleted file's record is tombstoned (the docId is never reused;
its permalink resolves to a "no longer available" page with provenance).

## 2. Permalink forms

```
alembic.orz.how/d/{docId}                 live — the current version
alembic.orz.how/d/{docId}@{version}       pinned — one exact version
alembic.orz.how/p/{packageId}             package share point (site / portal / cite)
alembic.orz.how/p/{packageId}@{snapshot}  package at a named snapshot
```

- `{version}` for files is a **short content hash** of the file version
  (decided; educators see it as a dated entry in the file's history, never
  type it). Content hashes survive history rewrites (leakage remediation)
  where commit SHAs die.
- `{snapshot}` is the package-level named version ("fall-2026", a Git tag).
  A file permalink may also pin via snapshot: `/d/{docId}@{snapshot}` —
  "this figure, as taught in Fall 2026."
- Block anchors (optional, documents only): `/d/{docId}#blk-…` for
  fine-grained citation into a rendered document.

## 3. Resolution (layered; no platform lock-in)

| File state | Resolution |
|---|---|
| public + published | **302 redirect** to the file on the educator's GitHub Pages site (correct MIME + CORS; renders self-contained formats; survives without Alembic) |
| public + pinned | served **through the platform** from the Git object store with correct MIME (decided) — Pages keeps only the current build, and retaining snapshot builds on Pages would bloat repos |
| private / trial / unpublished | served through the platform (GitHub-App token or Supabase) with owner/access checks — the `/api/asset/…` pattern generalized |
| deleted | tombstone page (provenance, successor pointer if forked/renamed) |

Per-class behavior: **documents** resolve to the rendered self-contained
file (viewer + editor inside); **objects** serve raw bytes with correct
`Content-Type`, CORS for public objects, and cache split (live = short
cache; pinned = immutable). `<iframe>` of an HTML unit stays a tolerated
fallback, never recommended.

## 4. Versioning

- **File level:** a plain dated history — the file's states across
  commits/saves, listed per file ("Jun 12 · Jul 3 · …"). No user-facing
  names at file level.
- **Package level:** named snapshots (Git tags) — list, restore, compare,
  cite, DOI-mint. A snapshot pins every file at once.
- Generated files are stamped with their canonical permalink in carrier
  metadata (self-describing downloads).

## 5. Insertion registry & element notifications

Inserts are **pinned at insert** (owner decision). To power the
report→correct→notify and revise→fork→choose loops:

- **Insertion registry:** a rebuildable index of `(referencing docId,
  referenced docId@version)` pairs, extracted from registered documents'
  sources on every save/reconcile. No manual bookkeeping; the files are the
  truth.
- **Notifications:** when a discoverable element gains a new version
  (correction) or a fork (revision), every owner of a referencing document
  gets an educator-language notice with **update / keep** (and, for forks,
  **switch to fork**) — one click rewrites the pinned reference through the
  validated write path; "keep" records the choice so the notice doesn't
  repeat. Delivery (decided): **in-app inbox on the workspace** first;
  email digest later.
- Fork lineage: a revision by a non-owner creates a new file (new docId)
  with `adapted-from` provenance; both versions coexist and are separately
  discoverable.

## 6. Element search (Discover, second scope)

The registration records of **discoverable** files form the element index:
searchable by kind, discipline/topic (from package metadata), description/
alt text, and license. Results show class-appropriate actions — documents:
view · cite · adapt; objects: preview · copy permalink · insert. Excluded
always: `private` (never registered as discoverable) and `current`
(semester ephemera). Whole-package search (today's portal) is unchanged and
remains opt-in via **List publicly** (Tier 3).

## 7. What this replaces

- Raw `raw.githubusercontent.com` links: rejected as a shared form (wrong
  MIME + nosniff, path-coupled, no private serving, SHA-only pinning). May
  remain an internal transport inside the resolver.
- `livePermalink()` / `pinnedPermalink()` in package-contract currently
  emit raw-GitHub URLs — they will emit `/d/{docId}` forms once the
  resolver exists; `classifyReference()` gains the `/d/` scheme.
- The asset-only permalink scope: permalinks now cover **every** registered
  file, in two classes.
