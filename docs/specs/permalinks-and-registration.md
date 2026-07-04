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
| `space` | study-guide · slides · concepts · assessment-support · practice · assets · current · metadata · provenance · private — in contract v2 the space IS the layer (one term, one meaning; the v1 layer names map in migration: `materials`→`assets`, `private-instructor`→`private`) |
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
- Block anchors, two distinct forms (optional, documents only):
  `/d/{docId}#blk-…` — a *view* anchor (scrolls the rendered document;
  client-side); `/d/{docId}/blocks/{blockId}` — a *raw fragment* endpoint
  (serves the block's markdown source, `text/markdown`, for includes).
- **Version vocabulary (one sentence each):** every save that changes
  content adds a *dated history entry*; the entry's identity is its
  *content hash* (the `@{version}` pin; identical content never
  duplicates); a `changeKind` tag + note attaches to a history entry when
  the file is shared/referenced; *named* versions exist only at package
  level (snapshots).

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

## 4b. Change significance (owner decision, 2026-07-04)

When saving a new version of a file that is **discoverable or has downstream
references**, the educator tags the change (ordinary WIP saves never ask;
skipping defaults to Update). Version entries carry
`changeKind: fix | update | variation` + a one-line note (the release note,
in educator language — it becomes the notification text).

| Kind | Meaning | Downstream behavior |
|---|---|---|
| **Fix** | error/mistake correction everyone should take | notify all referrers promptly, "Update" emphasized; adapters may opt in per element to *auto-accept fixes from this source* (auto-update is opt-in per user — pin-at-insert stays the default) |
| **Update** | expansion / new progress in the field | notify with neutral update/keep, batchable in the Inbox |
| **Variation** | local customization few others need | **no notices**; visible in the file's history. On a file *with* downstream references, "Variation" offers fork-as-named-variant (new docId, `adapted-from`) as the default, keeping the shared main line meaning-stable |

The tag is **advisory, never trusted**: a mislabeled fix still arrives as the
same update/keep choice — the kind shapes prominence and sorting only (fixes
first/loud, updates batched, variations silent). Tier rules unchanged.
Discover may sort elements by recent fixes/updates (a maintenance signal).
Schema lands with contract v2 (Roadmap R1) so no later migration is needed.

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
- **Reference vs copy (review resolution):** inserting by permalink is a
  *reference* — no new docId, recorded only in the insertion registry.
  Copying a file into one's own package is an *adaptation* — new docId +
  file-level `adapted-from`. Whole-package forks set package-level lineage
  which files inherit.

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
