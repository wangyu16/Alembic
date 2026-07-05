# Package contract v2 — the authoritative schema

**Status: authoritative (2026-07-05).** Single source of truth for the v2
package schema. Consolidates what was scattered across
[document-model.md](document-model.md),
[permalinks-and-registration.md](permalinks-and-registration.md),
[package-layout.md](package-layout.md), and Roadmap Module R, and resolves the
2026-07-05 coherence audit. Supersedes the *schema* of
[package-contract-v1.md](package-contract-v1.md) (kept for history). The
**pure implementation** is `packages/package-contract` (`spaces.ts`,
`registration.ts`, `ids.ts`, `manifest.ts`) — this doc is normative prose over
that code; where they differ, fix the doc or the code deliberately, never
silently.

Non-negotiable invariants (unchanged from v1): two-repo public/private
separation enforced fail-closed on every write; `packageOps` is the one
validated write path; repos are the source of truth (all app state is a
rebuildable projection).

## 1. Spaces (v2 replaces "layer" with "space")

In v2 the organizational unit is the **space**. "Layer" is deprecated in v2
docs — say "space." A space is *both* the on-disk folder and the
registration classification; there is one term, one meaning.

`PACKAGE_SPACES` (`spaces.ts`), public unless noted:

| Space | Folder | Repo | Holds |
|---|---|---|---|
| `study-guide` | `study-guide/` | public | chapter study guides — one `.md.html` per chapter (§4) |
| `slides` | `slides/` | public | `.slides.html` decks |
| `practice` | `practice/` | public | `.md.html` example/practice questions |
| `concepts` | `concepts/` | public | course + chapter concept maps (`.md`), off-website |
| `assessment-support` | `assessment-support/` | public | assessment guide (`.md`), off-website |
| `assets` | `assets/` | public | reusable objects (images, structures, plots, md fragments, media) |
| `current` | `current/` | public | this-term files; newest on the site, `current/archive/<term>/` off |
| `metadata` | `metadata/` | public | `course.md`, portal/LRMI records |
| `provenance` | `provenance/` | public | attribution & adaptation records |
| `private` | `private/` (private-repo root) | private | notes, keys, embargoed, drafts — never discoverable |

**Visibility is not repo-membership alone.** Both `concepts` and
`assessment-support` live in the *public repo* yet are *off the student
website* — the space carries that fact, which is why the `space` field is
retained (not collapsed into repo).

**v1 → v2 mapping** (`spaceForV1Layer`):

| v1 layer | v2 space |
|---|---|
| study-guide | study-guide |
| concepts | concepts |
| objectives | concepts (merged) |
| materials | assets · slides · practice (by kind/path) |
| assessment-support | assessment-support |
| private-instructor | private |
| provenance | provenance |
| metadata | metadata |
| research-schema | metadata (reserved; empty in practice) |

`spaceForPath(path)` resolves a repo-relative path to its space (root
allowlist → `metadata`); `assertPathAllowedInRepoV2(path, repo)` is the
fail-closed two-repo check. Both exist in code and become the active contract
when the manifest bumps to v2 (§7).

## 2. Registration record (the document contract)

Every file is **registered** — identically whichever door it came through
(created in workspace / uploaded / committed directly to GitHub). The record
is a **rebuildable projection** of repo content (repos win on disagreement),
stored in the `documents` table (§3). Schema = `RegistrationRecordSchema`
(`registration.ts`):

| Field | Meaning |
|---|---|
| `docId` | `doc-<12 base36>`, immutable; identity that survives rename/move/transfer |
| `packageId`, `repo`, `path` | current location; `path` updates on rename/move, `docId` never |
| `space` | one of §1 |
| `kind`, `formatVersion` | from the carrier kind registry (§6) |
| `sourceHash` | content hash of the extracted source (carrier formats) or file bytes |
| `origin` | `created` \| `uploaded` \| `external-commit` |
| `author`, `registeredAt` | provenance |
| `license` | per-file; defaults to the package license |
| `description`, `altText` | for objects (a11y + element search); may be captured lazily |
| `discoverable` | **mutable** boolean, default `false`; only "share this" sets it `true` (§5) |
| `permalinkClass` | `document` (final view) \| `object` (insertable) |
| `tombstoned` | true after deletion; the docId is **never reused** |
| `adaptedFrom` | optional file-level lineage (§8) |

**Idempotency (identity keying).** Re-registering the *same* file **updates
the existing record, does not mint a new docId**. Identity match order:
(1) embedded id if present [future], (2) **content hash** [MVP], (3) else it
is new. This is what makes permalinks durable across offline re-uploads and
`current`→`assets` moves. `assertRegistrationInvariants` forbids
`discoverable=true` in `private`/`current` and requires `repo` to match the
space.

*Known edge — duplicate content (resolved at wire time):* content-hash
identity is ambiguous when two live files in one package have byte-identical
source — a single-file `registerFile` call can't tell a *move* (reuse docId)
from a *duplicate* (mint a new docId). The authoritative resolution is a
**same-location tiebreaker** available only with the full package file list:
prefer an exact `(repo, path)` match; treat a cross-path hash match as a move
**only when the matched record's old path is no longer present** (else it is a
distinct duplicate → new docId). `rebuildPackageRegistry` has the file list and
implements this; the Supabase-backed store wired into the three doors applies
the same rule. The pure `registerFile` (memory-tested) favors move-continuity
in isolation — correct for the common flows, refined by rebuild.

**Mutable vs immutable.** Immutable: `docId`. Mutable on re-registration:
`path`, `sourceHash`, `description`, `altText`, `discoverable`, `license`.
Deletion sets `tombstoned=true` (record retained forever; permalink resolves
to a tombstone page).

## 3. `documents` table (R2 projection)

New Supabase migration (`0014_documents.sql`), following existing conventions
(snake_case, `references public.packages(id)`, RLS `owner_id = auth.uid()`).
Keyed by `doc_id` (primary), unique on `(package_id, repo, path)` among
non-tombstoned rows. Owner reads their own; no public read in MVP (Discover
reads a public-safe view later). **Rebuildable**: a full re-scan of a
package's repos reproduces every row; the table is a cache, repos are truth.

**Registration hooks — all three doors** (R2):
- **created / saved in place** → `packageOps` save path registers/updates.
- **uploaded** → the import path registers after validation.
- **external commit** → `reconcilePublicRepo` registers/updates on absorb.

Same validation and same record shape at every door (origin parity); only the
`origin` field differs.

## 4. Study guide = one `.md.html` file (source of record)

A chapter's study guide is **one `.md.html` file** at
`study-guide/<chapter>.md.html`, committed to git — the primary artifact. Its
editable markdown lives **embedded** in the file's carrier island; on
registration the source is extracted and hashed (`sourceHash`). The educator
edits the **markdown** (via the in-file editor); the `.md.html` is
regenerated on save (worker tier). So: file is the storage/sharing unit;
embedded markdown is what's edited; extraction is always available for hash,
AI, reconcile, and derived artifacts.

**Block IDs demote to optional anchors.** A section may carry a block id
(`{{attrs[#blk-…]}}`) for fine-grained citation / provenance / AI-merge, but
**missing ids are legal**. Save-time validation rejects only *malformed or
duplicate* ids; it never requires their presence. (Code note: the current
`validateBlockIds` null-cast must be fixed to treat null as "anonymous
section," not a string.)

## 5. Discoverability & change significance

- **`discoverable`** is opt-in per file via a one-click **"share this"**
  (default `false`; `private`/`current` can never be set true). Setting it is
  the Tier-3-spirited deliberate act; nothing is indexed merely because a repo
  is public.
- **`changeKind` (`fix`|`update`|`variation`)** — the field exists in the
  version schema (`DocumentVersion`) and is retained **dormant** for MVP: no
  save-time prompt, no notification wiring. It rides with element
  notifications (deferred — §9). Keeping the field costs nothing and avoids a
  later migration.

## 6. Carrier kind registry — ownership

`@alembic/carriers` **is** the kind registry and codec owner today (pure, no
IO): `BUILTIN_KINDS` + `PAGED_KIND` + `MEDIA_KINDS`, `embedSource`/
`extractSource` (reads the native `orz-carrier` island **and** the upstream
`orz-src`/`orz-deck` islands). `package-contract` consumes kind ids by
injection (`validateProject({knownCarrierExtensions})`) — it never defines
kinds. Adding a kind = registering it in `@alembic/carriers`. (A future
extraction to a shared `orz-artifacts` npm package is aspirational and does
not change this ownership rule.)

## 7. Migration (v1 → v2) — staged, one-way

`PACKAGE_SCHEMA_VERSION` bumps `1 → 2`. Migration is an **explicit, one-way,
Tier-3-style "Upgrade package" action**, logged as one commit; rollback is via
a pre-migration GitHub snapshot (no in-place downgrade). Staged to de-risk:

1. **Stage A (this phase):** version bump + activate the space contract in
   write paths + carrier extraction for `.md.html`. v1 packages still read.
2. **Stage B:** folder renames (`materials/` → `assets/`, `private-instructor/`
   → `private/`) — mechanical bookkeeping.
3. **Stage C (rides later modules):** new fields exercised (`changeKind`,
   file-level `adaptedFrom`) — additive.

Old `.md` study guides become `.md.html` (source embedded) in Stage A/B;
the `.md` is removed after the `.md.html` is generated and verified.

## 8. Adaptation lineage — two scales, defined

- **Package-level:** `manifest.adaptedFrom` set on a whole-package fork
  (`forkPackage`, already implemented — re-mints block ids, remaps
  references, forks the private repo); files inherit the package lineage.
- **File-level:** `registration.adaptedFrom` (a `sourceDocId`, optional
  `sourceSnapshot`) set when a single file is **copied** into another package.
- **Reference (insert by permalink):** **no lineage, no new docId** — it is a
  reference, recorded only in the insertion registry (deferred, §9).
  Attribution for referenced objects is the referencing document's job.

## 9. Explicitly deferred (owner decision, lean-core-first 2026-07-05)

Kept out of the near-term "planned part," to be sequenced right after the core
loop. Schema seams stay dormant so nothing is rebuilt:

- **Element notifications** (report→correct→notify, revise→fork→choose): build
  only the insertion-registry *extraction* when needed; no notify UI yet.
- **`changeKind` prompt/UI** (field stays dormant).
- **Unified Inbox** (Roadmap rule 5 is softened to "decisions surface in the
  workspace"; the one-surface-vs-separate question is decided when Module T is
  actually built). For the core loop, re-land only the two trust-critical
  surfaces (review queue + reconcile banner) in their own places.
- **Module I (AI)** stays deliberately open; only the existing propose→diff→
  approve remains; no new seams built.
- **Resolver** is ID-based (`/d/{docId}`) but implemented as a **thin route**
  over the `documents` table (302→Pages public; platform-served
  private/pinned) — not "permanent infrastructure."

## 10. Terminology (fixes the object/asset/document/element overload)

- **Object** — any registered file (generic).
- **Asset** — a reusable object in the `assets` space (image, structure, plot,
  md fragment, media). Source of truth = the file.
- **Document** — a final user-facing view (`.md.html`/`.slides.html`/
  `.paged.html`). Never inserted into another document.
- **Element** — a **discoverable** registered file (any kind/space) — the term
  used in Discover / element search.
