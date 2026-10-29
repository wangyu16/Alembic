# Package contract v3 (FC-15 v3) — mini-spec

**Status:** draft 3, 2026-10-29: the FD-09 ownership split (§0) and three new mechanics sections (§11–§13) for gate G0 round 2. Draft 2 (2026-10-27) passed round 1 (resolutions in §10). Module K1 of the build plan
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
| Path hygiene, the two repositories, projection, regular files only | **Alembic** | §1, §2 rules 1–6 |
| Roles and who may change which path class | **Alembic** | permissions-v3.md; §12.2, §13.3 |
| Storage: files that aren't text, size and type safety, serving | **Alembic** | §11 |
| Source pointers and the source store | **Alembic** | §5 |
| How course settings change: one checked operation, compare-and-swap, history | **Alembic** | §13 |
| Manifest mechanics fields: `packageId`, `repos`, `createdAt`, `coursewerk` version pin, `upstream` | **Alembic** | §6 |

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

**11.2 How they enter.** The server receives the bytes, creates the GitHub
blob first (the bridge's blob call), and only then queues the change. A queued
file entry is either text or a blob reference, never bytes:

```
{ path, baseVersion, text }                 text file (existing)
{ path, baseBlob, blob: { sha, size } }     non-text file; baseBlob = the blob id it replaces, null if new
{ path, baseVersion | baseBlob, delete: true }
{ path, movedFrom, baseVersion | baseBlob }  a move: delete + create in one commit
```

The bytes never pass through the database. The committer places the blob in
the tree by its id; GitHub keeps an unreferenced blob harmlessly if the row is
refused.

**11.3 Limits (Alembic's, for hosting).**
- At most **4 MB per file** through the web app (the host refuses larger
  request bodies). Larger media wait for staged uploads (later); the message
  says so plainly.
- A course's files total: a warning at 500 MB and a refusal at 1 GB.
- At most 50 files in one change (as for sync).

**11.4 Type safety (Alembic).** Which kinds of figure are allowed is
Coursewerk's (interim: PNG, JPEG, GIF, WebP, SVG). Alembic checks mechanically:
- the bytes match the declared kind (magic bytes; SVG must parse as XML with
  an `svg` root);
- every course file Alembic serves carries `X-Content-Type-Options: nosniff`
  and `Content-Security-Policy: sandbox`, so an SVG opened on its own can't
  run as Alembic;
- a file is text exactly when the path's kind is a text kind (FC-17 registry)
  **and** the bytes are valid UTF-8 with no NUL; text kinds never take a blob
  entry.

**11.5 The version rule for non-text files.**
- `baseBlob` equals the current blob → landed.
- They differ → **both changed**. The incoming file is committed as a kept
  version, and the top follows the write-path §5 rules. Nothing is lost.
- They are never combined.

**11.6 Deletes and moves.**
- Each path is checked by role and space, and a move checks both paths.
- Course-plan files and the manifest can't be deleted or moved through these
  entries (§13 does that).
- A delete whose base doesn't match the current version is **both changed**,
  and the current version stays.

## 12. Instructor-only documents

**12.1 Where (Coursewerk's, interim).** `private/instructor/<name>.md`, where
`<name>` is lowercase and hyphen-joined (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), at most
60 characters. Folders under `instructor/` follow the same rule.
`private/README.md` (from the template) is a server-generated note: it is not a
document, isn't listed, and can't be written. It joins `isServerGenerated` with
`.github/` and `.alembic/`.

**12.2 Who (Alembic's).**
- **Read:** every member. **Create and edit:** `edit.private` (owner, deputy,
  co-author, agent). **Delete:** owner and deputy.
- A new document is a sync with `baseVersion: null`, through the usual write
  path.
- Never projectable (§2 rule 4 already holds).

## 13. Course operations

**13.1 The operations.** The course settings (`alembic.json`) change only
through these named operations, each one system row applied by
compare-and-swap on the manifest's version (write-path rule 8):

| Operation | Effect on the manifest | Effect on files, in the same commit |
|---|---|---|
| `addChapters(titles[], startParts)` | appended as drafts; slugs from titles, never colliding | the study guide, or all five parts, created from the starter structures (Coursewerk's; interim in `chapter-parts.ts`) |
| `renameChapter(slug, title)` | title only; the slug is the chapter's path identity and doesn't change | none |
| `moveChapter(slug, toIndex)` | reorders | none |
| `removeChapter(slug)` | removed | its five part files deleted; history keeps them (A9 restore) |
| `setChapterMode(slug, draft\|package)` | mode | none |
| `setCourseFields({title?, license?, description?, audience?, level?})` | those fields | none |

A slug change (renaming files and their links) is not an operation. It is
raised with Coursewerk.

**13.2 Validity (Coursewerk's, interim).** The resulting manifest must pass
the content rules: today `WorkingManifestV3Schema` and the licence list
(D-126: Coursewerk's public-OER profile allows only open licences). An
operation whose result fails is refused, and nothing is written.

**13.3 Mechanics (Alembic's).**
- **Who:** owner and deputy (`edit.course-files`). A co-author can't run an
  operation; the agent may propose one inside its hand-over (C4) and it is
  approved as usual.
- **Concurrency:** each row carries the manifest version it was made from. Of
  two operations made from the same version, one lands and the other is
  refused with "the course settings changed meanwhile; try again", and the
  workspace re-applies it on the new version once, automatically. No change
  is ever silently lost.
- **Idempotency:** the key is `system:courseop:<op>:<uuid>`; a repeated
  request is the same row.
- **Publish:** a Publish waits while any course operation is open. This
  generalises today's `system:mode:%` guard to `system:courseop:%`.
- **History:** every operation's commit message names it (e.g. `Removed
  chapter “Gases”`) with the actor trailer, so history lists it in plain
  words.

## 14. New claims (draft 3)

- **K1.10** A non-text file reaches the course only as a blob the server
  created. Its bytes never enter the database; over 4 MB it is refused with a
  plain message.
- **K1.11** Every course file Alembic serves carries `nosniff` and a sandbox
  CSP. A file whose bytes don't match its declared kind is refused.
- **K1.12** For a non-text file whose base isn't current: both changed, a
  kept version, nothing lost; never combined.
- **K1.13** Deletes and moves check every path by role and space in one
  commit. The manifest and course-plan files can't be deleted or moved
  through them.
- **K1.14** `private/instructor/<name>.md` can be created and edited by
  `edit.private` roles and is never projectable. `private/README.md` is
  neither listed nor writable.
- **K1.15** Each course operation is one compare-and-swap row. Of two made
  from the same version, one lands and the other is refused and re-applied
  once; Publish waits for open operations.
- **K1.16** `removeChapter` removes the chapter and its part files in one
  commit, and they are restorable from history.
- **K1.17** Co-authors can't run course operations. Every content-validity
  rule used is labelled as Coursewerk's (mirror or interim), and the code
  holds no Alembic-only content rule (a scan test).
