# Package contract v3 (FC-15 v3) — mini-spec

**Status:** draft 5, 2026-10-29: the FD-09 ownership split (§0) and new mechanics sections (§11–§14). G0 rounds 2 and 3 passed with fixes, all applied (§15, §16). Draft 2 (2026-10-27) passed round 1 (resolutions in §10). Module K1 of the build plan
(orz-family `docs/ALEMBIC-BUILD-PLAN.md`). Design source: orz-family
`docs/ALEMBIC-WORKSPACE-DESIGN.md` §4, §13, §18.2 (owner rulings R18, R20,
R24, R27, R31). Replaces v1 (`layers.ts`) and v2 (`spaces.ts`) as the only
contract once the cut-over happens (R31: no backward compatibility).

## 0. Who owns what (FD-09)

The owner's ruling (2026-10-29): everything about the **content** of course
materials, including the licence, accessibility and the file tree, is
**Coursewerk's**; everything else is **Alembic's**. In this contract:

| Rule | Owner | In this document |
|---|---|---|
| The file tree: folders, root files, chapter parts and their paths, where figures and instructor material live | **Coursewerk** | §2 space list, §3 private subfolders, §4 slots, §12.1 — an **interim mirror** |
| Manifest content fields: title, licence and its allowed list, description, audience, level, chapters, order, draft/ready | **Coursewerk** | §6 content fields, §13.2 validity — interim mirror |
| Part formats and starter structures, accessibility, copyright, provenance, the content gate | **Coursewerk** | not defined here; Alembic runs Coursewerk's checks (I8) |
| Path hygiene, the two repositories, projection, regular files only | **Alembic** | §1, §2 rules 1 and 3–6 |
| The list of root files and root folders (§2 rule 2), the reserved slug `course` (it follows from `concepts/course.md`), which parts appear on the student site (§4 `published`) | **Coursewerk** | interim mirror (D-126) |
| Roles and who may change which path class | **Alembic** | permissions-v3.md; §12.2, §13.3 |
| Storage: files that aren't text, size and type safety, serving | **Alembic** | §11 |
| Source pointers and the source store | **Alembic** | §5 |
| How course settings change: one checked operation, compare-and-swap, history | **Alembic** | §13 |
| Manifest mechanics fields: `packageId`, `repos`, `createdAt`, `coursewerk` version pin, `upstream` | **Alembic** | §6 |

**Profile rule (FD-10).** Alembic is a general publishing platform, and the
content rules come from a **content profile**: the `ContentProfile`
interface in `package-contract/src/profile/`, implemented for now by the
Coursewerk OER profile (`profile/coursewerk-oer/`). Core code takes the
profile as a parameter. "The mirror" below means that profile module.

**Mirror rule.** `package-contract` holds the content rules as a mirror of
Coursewerk's definitions, labelled with the Coursewerk version it follows
(`COURSEWERK_CONTENT_VERSION`). Rules Coursewerk hasn't published are marked
*interim* in code and here; Coursewerk's later definition replaces them
without an Alembic design change. Alembic adds no content rule of its own.
Today's differences are family drift **D-126**.

## 1. The two repositories

| Repo | Name | Holds | Written by |
|---|---|---|---|
| **working** (private) | `<slug>-private` | the whole course tree, every space | the write path only (and, on GitHub, the owner and any collaborator the owner added; forbidden content is undone, `queue-and-jobs-v3.md` §4) |
| **public** | `<slug>-oer` | the projection: public spaces of published units | Publish only |

`RepoKind` keeps its two values; `"private"` now means the working repo.

## 2. Spaces and paths

The v2 space list is kept, unchanged in name and directory:

```
study-guide  slides  practice  concepts  assessment-support
assets  current  metadata  provenance  private
```

Rules:

1. **Path hygiene first** (`normalizePath`, applied before anything else;
   failures throw `PathLayerError`): reject any path that is not in Unicode
   NFC form (no silent normalising: one name, one form), a leading `/`,
   backslashes, empty segments, `.` and `..` segments, any `%`, control
   characters (U+0000–U+001F, U+007F), and Unicode bidi/format characters
   (Cf category); segments at most 255 bytes; total at most 1024 bytes.
   Then **classification** (`spaceForPath`) as before: the first segment
   decides the space; unknown directory or root file throws.
2. **Root files:** `alembic.json`, `README.md`, `LICENSE`, `CITATION.cff`,
   `.gitignore`, and new **`orz-site.json`**. Root directories: `.alembic`,
   `.github`. They classify as space `metadata` as before. **`.github/`,
   `.alembic/` and `.gitignore` are server-generated only** (refused from every user and
   agent write; permissions spec §3) and **`.github/` is never
   projectable**; the public repo's `.alembic/` is regenerated at Publish
   from public items only.
3. **Working repo accepts every classifiable path**
   (`assertPathAllowedInWorkingRepo(path)`: throws only if `spaceForPath`
   throws).
4. **Public repo accepts only public spaces**
   (`assertPathAllowedInPublicRepo(path)`): any path in space `private`
   throws `SpaceBoundaryViolation`; root files allowed. No override
   parameter, by design (unchanged invariant).
5. **Projectable** (`isProjectable(path)`): true for every path the public
   repo accepts, **except** `provenance/coursewerk/…` (written only by the
   publish profile), `.github/…`, `.alembic/…` and `.gitignore` (written by
   Publish itself). This is a path-level rule; *which units* are published
   (draft chapters, kept units) is the publisher's decision.
6. **Only regular files.** A working-repo tree entry is accepted only with
   mode `100644` or `100755`. Symlinks (`120000`) and submodules (`160000`)
   are never created by Alembic; if pushed on GitHub they are undone by a
   front-of-line system commit (`queue-and-jobs-v3.md` §4); Publish refuses
   a tree that still contains one (fail closed) and waits for the undo.

## 3. The private space

```
private/instructor/…             answer keys, exams, notes
private/sources/<opaque-id>.json source pointers (schema §5)
private/coursewerk/…             Coursewerk records (FC-16 v1 decides the files)
private/legacy/…                 content moved from retired v1 layers
```

`private/` subfolders other than these four are rejected by
`assertPrivatePath(path)` (fail closed), so new private kinds are an
explicit contract change.

## 4. Chapter slots

The five slots stay: `concept-map`, `study-guide`, `slides`,
`assessment-guide`, `practice`. Changes:

| Slot | Path | `published` (on the student site) |
|---|---|---|
| concept-map | `concepts/<slug>.md` | false (public repo, not on the site) |
| study-guide | `study-guide/<slug>.md` | true |
| slides | **`slides/<slug>.slides.md`** (was `.md`) | true |
| assessment-guide | `assessment-support/<slug>.md` | false (R27) |
| practice | `practice/<slug>.md` | true |

All slot files carry the FC-18 header. `slotPath` / `slotForPath` keep their
exact bijection. The slot's `repo` field becomes informative only (all slot
files live in the working repo and project to the public repo).

## 5. Source pointer (`private/sources/<id>.json`)

```json
{
  "schema": "alembic.source/1",
  "id": "src_<26 lowercase base32>",
  "title": "…", "kind": "file|link|book-description",
  "uploader": "<user id>",
  "aiAllowed": true,
  "sharedWithCourse": false,
  "rightsNote": "…",
  "sha256": "<hex, file kinds only>", "size": 0,
  "storageKey": "<opaque key, file kinds only>",
  "removedAt": null
}
```

The id is opaque (no title in it). Validated by a zod schema; unknown fields
rejected.

**Authority:** the database row `sources(id, package_id, uploader_id,
storage_key, sha256, size, ai_allowed, shared_with_course, …)` is the only
authority for ownership, flags and the storage key. The repo file is a
**mirror written only by the server**; edits to `private/sources/` through
any door are refused (Door C: undone). The server never reads `uploader`,
`storageKey`, `aiAllowed` or `sharedWithCourse` from the file.
**Storage keys** are `<package_id>/<128-bit random>`; the R2 bucket is
private and only the server holds credentials, so a key is useless without
a server-issued signed link (60 s), which is issued only after
`can(role, 'source.see-file', {uploaderId, sharedWithCourse})` from the row.

## 6. Manifest (`alembic.json`) schemaVersion 3

Adds to v2: `unitTerm` (exists), `level`, `audience`, `coursewerk`
(`{version}` or absent), `upstream` (`{packageId, version}` or absent),
`chapters[].mode` (`"draft"|"package"`, default `"package"`).
Two schemas: **`WorkingManifestV3`** (may carry `repos`) and
**`PublicManifestV3`** (rejects any field naming the working repo; lists
only the chapters present in the public tree). Publish writes the public
one. Writing uses v3 only (R31); a read-only `parseLegacyManifest` (v1/v2)
stays for the migration helper and for reading others' older public repos.

## 7. Functions (package-contract, pure)

| Function | Behaviour |
|---|---|
| `spaceForPath(path)` | unchanged, plus `orz-site.json` root file |
| `assertPathAllowedInWorkingRepo(path)` | §2.3 |
| `assertPathAllowedInPublicRepo(path)` | §2.4 (= today's `assertPathAllowedInRepoV2(path, "public")`) |
| `isProjectable(path)` | §2.5 (`alembic.json` is not projectable: Publish generates the public one) |
| `isPublishGenerated(path)` | `alembic.json`, `.alembic/`, `.gitignore`, `.github/`, `provenance/coursewerk/` |
| `assertPublishWritable(path, origin)` | public-repo boundary AND (`unit` ⇒ `isProjectable`; `generated` ⇒ `isPublishGenerated`) |
| `assertPrivatePath(path)` | §3 |
| `SourcePointerSchema` | §5 |
| `PackageManifestSchemaV3` | §6 |
| `slotPath` / `slotForPath` | §4 |

Removed at the cut-over: `layerForPath`, `assertPathAllowedInRepo` (v1),
`LAYER_*`, `spaceForV1Layer` (kept only in the migration helper script).

**Reserved chapter slug:** `course` (it would collide with
`concepts/course.md`).

## 8. Claims (bound to tests)

- **K1.1** every path the public repo accepts is classifiable; no `private/…`
  path is ever accepted by the public repo; every path in the hygiene list
  (`./private`, `private/../x`, `study-guide/%2e%2e/private/x`,
  backslashes, leading slashes, empty and dot segments, control and bidi
  characters, non-NFC forms) is **rejected** (property test over generated
  paths).
- **K1.7** `.github/`, `.alembic/`, `private/sources/` are refused from user
  and agent writes; `.github/` is never projectable.
- **K1.8** trees with symlink or submodule entries are refused.
- **K1.9** the chapter slug `course` is refused.
- **K1.2** the working repo accepts every classifiable path and rejects every
  unclassifiable one.
- **K1.3** `provenance/coursewerk/…`, `.github/…`, `.alembic/…` and
  `.gitignore` are never projectable; every other public-repo-accepted path
  is.
- **K1.4** `assertPrivatePath` accepts exactly the four subfolders.
- **K1.5** slot bijection holds with `.slides.md`.
- **K1.6** source pointer and manifest v3 schemas reject unknown fields and
  a public manifest naming the working repo.

## 9. Coordination

Coursewerk fetches the newest contract from Alembic's public `main`
(Coursewerk D37). v3 lands on `main` only at the cut-over, after Coursewerk
has seen this draft (sent 2026-10-27 through AgentPortal).

## 10. Review resolutions (G0 round 1)

| Finding | Resolution |
|---|---|
| 3.7 encoded / dot / control / bidi paths | §2 rule 1 hygiene, K1.1 |
| 3.5 `.github/` | §2 rules 2 and 5, K1.7 |
| 3.4 symlinks, submodules | §2 rule 6, K1.8 |
| 3.3 forged pointers, 3.11 storage keys | §5 authority and keys |
| 2.3 draft chapters | §2 rule 5 (publisher decides units) |
| 2.4 two manifest schemas | §6 |
| P-1 reserved slug | §6, K1.9 |
| manifest `[3]` breaks reading older repos | §6 legacy read-only parser |
| imports from `layers.ts` (`PathLayerError`, `RepoKind`) | move them into a new `paths.ts` before `layers.ts` is removed |
| `.slides.md` call sites (`slides.ts`, `fork-remint.ts`, `document-registry.ts`, `slot-upsert.ts`) | changed together with K1, one commit, tests updated |

## 11. Files that aren't text (Alembic)

**11.1 Where they go.** Figures and other non-text files are stored **in the
course's working repo on GitHub, directly** (owner, 2026-10-29). Which folder
holds them is Coursewerk's (interim: `assets/…`). The source store (R2, §5) is
for private sources only.

**11.2 How they enter: the upload route.**
1. The browser checks the size first, then sends the file as a raw or
   multipart body, never base64 JSON.
2. The server checks the person's role for the target path, the size, the
   quota and rate limits (§11.3), and the type (§11.4).
3. Only then does it create the GitHub blob, and record it in the
   **`course_blobs` ledger**: `(package_id, sha, size, kind, path,
   uploaded_by, created_at, committed_at)`. The ledger is service-role only.
4. Then it queues the change. A queued file entry is either text or a blob
   reference, never bytes:

```
{ path, baseVersion, text }                     text file (existing)
{ path, baseBlob, blob: { sha, size } }         non-text; baseBlob = the blob it replaces, null if new
{ path, baseVersion | baseBlob, delete: true }
{ path, movedFrom, baseVersion | baseBlob }     a move: delete + create in one commit
```

**The committer accepts a blob reference only if `(package_id, sha)` is in the
ledger and the ledger's kind matches `fileKind(path)`** (G0r2 H1, G0r3): a PNG
blob can't be placed at an `.svg` path. A member calling `enqueue_write` directly with any other
sha is refused, so every upload check is unavoidable. A move takes its content
from the current tree, never from a supplied sha.

**Online only.** This is the one exception to write-path §2 ("no GitHub calls
in the request"), and that spec is amended to say so. If GitHub can't be
reached, the upload is refused at once: "Couldn't upload now; try again in a
few minutes." The person still has the file. If a queued row finds its blob
gone when it commits (a 422 from GitHub after a long outage), the row is
refused with "Upload the file again", and the uploader gets a Needs-you item.
Bytes are never kept by Alembic.

**11.3 Limits (Alembic's, for hosting).**
- At most **4 MB per file** through the web app, checked in the browser
  before sending. Larger media wait for staged uploads (later), and the
  message says so plainly.
- **Quota per course, counted from the ledger:** every blob created, committed
  or not, plus the text tree. A warning at 500 MB, a refusal at 1 GB. Git
  history keeps replaced files, so the count only grows. It is shown to the
  owner.
- **Rate limits:** 60 uploads an hour per person and 200 per course. Each
  upload is one GitHub call on the owner's installation.
- At most 50 files in one change (as for sync).

**11.4 Type safety (Alembic's checks, on Coursewerk's list).** Which figure
kinds a course may hold is Coursewerk's (interim: PNG, JPEG, GIF, WebP, SVG).
Alembic checks mechanically:
- **One kind function:** `fileKind(path)` from the FC-17 registry, used by the
  upload route, the committer, Door C and Publish (G0r2 M5).
- **Bytes match the kind:** magic bytes for raster images. An SVG must parse
  as XML with an `svg` root.
- **Every SVG is checked on every write** (upload, text sync of
  `.ketcher.svg`/`.plot.svg`, Door C, the agent) **and again at Publish**. It
  is refused if it contains `script`, `foreignObject`, any `on*` attribute,
  `javascript:` or `data:` URLs in links, or external references. GitHub Pages
  can't send a CSP, and an SVG opened directly there runs on the owner's
  shared `<owner>.github.io` origin, so this check is the protection.
- **SVGs are never merged:** they follow §11.5, as non-text files do.
- **SVG's kind:** an uploaded `.svg` is a blob. Editor-made `.ketcher.svg`
  and `.plot.svg` are synced as text (FC-17). All three get the SVG check,
  and none are merged.
- **What happens to a failed check:**
  - on a write through Alembic: refused, with the path named;
  - pushed on GitHub: Door C undoes it (queue §4) and tells the pusher and
  the owner;
  - at Publish: the Publish is refused, naming the file.
- **Alembic's own serving:** every course file carries
  `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`.
- **Text means:** a text kind in the registry **and** valid UTF-8 with no
  NUL. Text kinds never take a blob entry, and a move keeps its kind (a blob
  can't be moved to a `.md` path).

**11.5 The version rule for non-text files (and SVGs).**
- `baseBlob` equals the current blob → landed.
- They differ → **both changed**. The incoming file is committed as a kept
  version, and the current one stays on top: an upload is never
  `fromOpenEditor`. Both people get a Both-changed item showing the two
  pictures side by side, with "Use this one" for each. Nothing is lost.
- They are never combined.

**11.6 Deletes and moves.**
- `path` and `movedFrom` both go through path hygiene, are de-duplicated
  within a change, and are each checked by role and space.
- A move keeps the file mode of the current tree entry (`100644` or
  `100755`).
- **Deleting needs a delete right:**
  - outside `private/`: the space's edit action;
  - in `private/`: `delete.private` (owner, deputy; new in the permission
    matrix);
  - moving a file out of `private/` counts as deleting it, and needs the
    target space's edit right as well.
- **A chapter's part files can't be deleted or moved** while the chapter is
  in the manifest, except by `removeChapter` (§13). This holds for every
  role, which keeps Coursewerk's "every chapter has a study guide".
- The manifest and server-only files can't be deleted or moved.
- A delete whose base isn't the current version is **both changed**, and the
  current version stays.

## 12. Instructor-only documents

**12.1 Where (Coursewerk's, interim).** `private/instructor/<name>.md`, where
`<name>` is lowercase and hyphen-joined (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), at most
60 characters. Folders under `instructor/` follow the same rule.
`private/README.md` (from the template) is a server-only note: it is added to
`isServerOnlyPath`, isn't listed as a document, and can't be written. It is
the stated exception to `assertPrivatePath` (K1.4).

**12.2 Who (Alembic's).**
- **Read:** every member. **Create and edit:** `edit.private` (owner, deputy,
  co-author, agent). **Delete:** `delete.private` (owner, deputy).
- A new document is a sync with `baseVersion: null`, through the usual write
  path.
- Never projectable (§2 rule 4 already holds).

## 13. Course operations

**13.1 The operations.** The course settings (`alembic.json`) change only
through these named operations:

| Operation | Who | Effect on the manifest | Effect on files, in the same commit |
|---|---|---|---|
| `addChapters(titles[], startParts)` | owner, deputy | appended as drafts; slugs from titles, never colliding | the study guide, or all five parts, created from the starter structures (Coursewerk's; interim in `chapter-parts.ts`) |
| `renameChapter(slug, title)` | owner, deputy | title only; the slug is the chapter's path identity and doesn't change | none |
| `moveChapter(slug, toIndex)` | owner, deputy | reorders | none |
| `removeChapter(slug)` | owner, deputy | removed | its part files deleted **at their current versions**; the commit records them |
| `restoreChapter(slug, fromCommit)` | owner, deputy | the entry back (at the end if its place is gone) | its part files as they were at `fromCommit` |
| `setChapterMode(slug, draft\|package)` | owner, deputy | mode (shown as Draft / Ready) | none |
| `setCourseDetails({title?, description?, audience?, level?})` | owner, deputy | those fields | none |
| `setLicense(license)` | **owner** (`license.change`) | licence | `LICENSE` and `CITATION.cff` regenerated (permissions §3) |

A slug change (renaming files and their links) is not an operation. It is
raised with Coursewerk. If Coursewerk changes a path rule (for example, the
slides file name), existing courses move only through a course-upgrade job
(D6) or the move helper, never silently. Each course records the Coursewerk
content version it follows (`coursewerk`, §6).

**13.2 Validity (Coursewerk's, interim).** The resulting manifest must pass
the content rules held in the mirror: today `WorkingManifestV3Schema`, the
licence list (D-126) and a **tree-aware** rule (every listed chapter has its
study guide; G0r3 N3). The same check runs in `applyCourseOp` and in Door C. An operation whose result fails is refused, and nothing
is written.

**13.3 Mechanics (Alembic's).**
- **A row kind of its own:** `courseop`. The row stores the **operation and
  its arguments**, not a finished manifest (G0r2 H3). It has an actor, and at
  execution the committer re-checks the actor's right (`edit.course-files`, or
  `license.change` for `setLicense`; G0r2 M2).
- **Applied at the head:** the committer works one row at a time per course.
  It reads the manifest at the head, applies the operation with the pure
  `applyCourseOp(manifest, tree, op)`, and refuses only if the operation no
  longer applies or the result is invalid. Example: renaming a chapter
  someone just removed.
  - **Two renames at once:** both land, in order.
  - **No browser re-apply** is needed, so no change is lost to a closed tab.
- **Order:** `priority 0`, first in first out with syncs. A course operation
  doesn't jump ahead of typing queued earlier.
- **Idempotency:** the client supplies an operation id, which becomes the
  queue key `courseop:<uuid>`.
- **Publish waits** while any open row of kind `courseop` exists. This is
  checked in SQL (`request_publish`) and in the action by kind, not by key
  pattern. The migration converts the open `system:mode:%` and
  `chapters:add:%` rows (G0r2 L1).
- **History:** every commit message names the operation in plain words (e.g.
  `Removed chapter “Gases”`) with the actor trailer.

**13.4 Removing a chapter while someone types (G0r2 M1).**
- The part files are deleted at their current versions; nothing waits on a
  base.
- A sync that arrives later for a removed chapter's file is kept as a kept
  version.
- **Its author** gets a Needs-you item: "Chapter “Gases” was removed by Ana.
  Your text is kept, and the owner and deputy have been asked whether to
  restore it."
- **The owner and deputy** get an item with **Restore the chapter**. It runs
  `restoreChapter` from the removal commit's **parent**, then lands the kept
  text on top.
- **If the slug has been reused** by a newer chapter, the chapter is restored
  under the next free slug with "(restored)" in its title, and its files at
  the matching paths.
- The open editor shows the same notice when the removal arrives.
- Nothing is orphaned unseen.

**13.5 One manifest, two kinds of fields (G0r2 M8, G0r3 N1).**
- **Content fields** (Coursewerk's: title, licence, description, audience,
  level, chapters): the repo's `alembic.json` is authoritative, and the
  `packages.manifest` column mirrors them.
- **Mechanics fields** (Alembic's: `packageId`, `repos`, `createdAt`,
  `coursewerk`, `upstream`): the database is authoritative. The file carries
  a copy, but Alembic never reads them from the file. Publish and every job
  take them from the database.
- `update_manifest` is retired for v3 courses at the cut-over.

**13.6 Edits on GitHub (G0r2 M7, G0r3 H2).** Door C undoes, with a
front-of-line system commit:
- a pushed `alembic.json` that fails §13.2 (restoring the last valid one);
- a pushed change to its mechanics fields;
- a licence change pushed by anyone but the owner (the pusher is matched to a
  member; an unmatched pusher is not the owner);
- edits to `LICENSE` and `CITATION.cff`;
- any push to `private/README.md`;
- removals of a listed chapter's part files;
- unsafe SVGs and blobs whose bytes don't match their kind (§11.4).

An owner's valid licence change pushed on GitHub is accepted, and
`LICENSE`/`CITATION.cff` are regenerated in the next system commit.

Valid manifest edits on GitHub are accepted as outside changes, as today.

## 14. New claims (draft 4)

- **K1.10** A non-text file reaches the course only through the upload route.
  The committer accepts a blob reference only from the `course_blobs` ledger
  (a direct `enqueue_write` with another sha is refused). Bytes never enter
  the database, and over 4 MB is refused with a plain message.
- **K1.11** Every course file Alembic serves carries `nosniff` and a sandbox
  CSP. A file whose bytes don't match its kind is refused. An SVG with
  scripts, `foreignObject`, `on*`, `javascript:`/`data:` links or external
  references is refused on every write and at Publish.
- **K1.12** Non-text files and SVGs whose base isn't current: both changed, a
  kept version, nothing lost; never combined.
- **K1.13** Deletes and moves check every path (both ends of a move) by role
  and space in one commit, and keep the file mode. A listed chapter's part
  files, the manifest and server-only files can't be deleted or moved through
  them. Deleting in `private/` needs `delete.private`.
- **K1.14** `private/instructor/<name>.md` can be created and edited by
  `edit.private` roles and is never projectable. `private/README.md` is
  neither listed nor writable.
- **K1.15** Course operations are `courseop` rows (operation and arguments,
  actor re-checked at execution) applied at the head in order. Two operations
  made at once both land unless one no longer applies; Publish waits for open
  ones.
- **K1.16** `removeChapter` and `restoreChapter` are inverses. A sync arriving
  for a removed chapter's file is kept and offers Restore.
- **K1.17** Every content rule lives in one versioned mirror
  (`package-contract/src/content-mirror/`, `COURSEWERK_CONTENT_VERSION`):
  the tree, the slots, the licence list, the manifest content fields and the
  starter structures (moved from `chapter-parts.ts`). `access.ts` and
  `contract-v3.ts` import space names from it. A scan test forbids
  **path-shaped** literals (`study-guide/`, `.slides.md`, `assets/`) and
  licence identifiers (`CC-BY-…`) elsewhere in `package-contract`,
  `package-ops` and `apps`. Ordinary words in UI text are fine.
- **K1.18** Only the owner changes the licence, and `LICENSE`/`CITATION.cff`
  follow in the same commit.
- **K1.19** Upload quota and rate limits are counted from the ledger (created
  blobs, committed or not).

## 15. Review resolutions (G0 round 2, 2026-10-29)

| Finding | Resolution |
|---|---|
| H1 co-author bypasses upload checks via raw blob refs | `course_blobs` ledger; committer accepts only ledger blobs (§11.2, K1.10) |
| H2 deputy licence change; LICENSE not regenerated | `setLicense` owner-only, regenerates `LICENSE`/`CITATION.cff` (§13.1, K1.18) |
| H3 "never silently lost" relied on a browser re-apply; priority 1 jumps the queue | rows store operation + arguments, applied at head by the committer; priority 0 (§13.3) |
| M1 removal vs typing; orphans | delete at current; `restoreChapter`; Needs-you "Restore the chapter" (§13.4) |
| M2 no role re-check for system rows | row kind `courseop` with actor, re-checked (§13.3) |
| M3 upload calls GitHub in the request | stated exception to write-path §2; online-only; blob-gone → "upload again" (§11.2) |
| M4 quota undefined | counted from the ledger incl. uncommitted blobs; rate limits (§11.3, K1.19) |
| M5 SVG paths that skip checks; public site has no CSP | one `fileKind`; SVG checks on every write and at Publish; never merged (§11.4) |
| M6 delete rights | `delete.private`; part files only via `removeChapter` (§11.6) |
| M7 pushed `alembic.json` not undone | Door C undo list extended (§13.6) |
| M8 two manifests | repo file authoritative; column a mirror; `update_manifest` retired (§13.5) |
| L1 publish guard by key pattern | by row kind, SQL and TS; open old rows converted (§13.3) |
| L2 move checks, file mode | §11.4 last bullet, §11.6 |
| L3 `isServerOnlyPath`, K1.4 exception | §12.1 |
| L4 unlabelled content rules; `level` vs `courseContext.level`; `orz-site.json` | §0 table row; D-126 items 7–8; `level`/`upstream` added to the code schema |
| L5 base64 body over the host limit | raw/multipart body, size checked in the browser (§11.2) |
| L6 scan can't define content rules | one mirror module + scan (K1.17) |
| Goldfish Q2, Q4, Q5, Q7, Q8 ambiguities | §11.5 what each sees; §13.4; §13.3 two renames; §13.1 path changes; §11.4 public site |

## 16. Review resolutions (G0 round 3, 2026-10-29)

| Finding | Resolution |
|---|---|
| H1 addition: blob kind vs path | the ledger kind must match `fileKind(path)` (§11.2) |
| H2 hole: licence and `LICENSE` via GitHub | Door C undoes a non-owner licence change and `LICENSE`/`CITATION.cff` edits; an owner's is accepted and regenerated (§13.6) |
| H3 not carried to the queue spec | queue-and-jobs §2.1/§2.2 amended: kind `courseop`, `enqueue_courseop`, actor from the session |
| M1 hole: Restore for co-authors; parent commit; slug reuse | Restore goes to owner/deputy, uses the parent commit, and a reused slug restores under a free one (§13.4) |
| M5 hole: Door C / Publish actions; SVG kind | §11.4 last two bullets; queue §4 amended |
| M7 hole: queue §4 unchanged | queue §4 amended to list §13.6 |
| M8 hole: write-path rule 8 | write-path rule 8 amended |
| N1 mechanics fields via a push | content fields from the file, mechanics fields from the database; Door C undoes pushed mechanics changes (§13.5, §13.6) |
| N2 §13.3 vs §13.4 | the contradictory example removed |
| N3 chapter with no study guide | tree-aware validity in `applyCourseOp` and Door C (§13.2) |
| N4 scan scope | path-shaped literals only; `access.ts` imports from the mirror (K1.17) |
