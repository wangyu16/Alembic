# Package contract v3 (FC-15 v3) — mini-spec

**Status:** draft 2 for gate G0, 2026-10-27 (draft 1 reviewed; resolutions in §10). Module K1 of the build plan
(orz-family `docs/ALEMBIC-BUILD-PLAN.md`). Design source: orz-family
`docs/ALEMBIC-WORKSPACE-DESIGN.md` §4, §13, §18.2 (owner rulings R18, R20,
R24, R27, R31). Replaces v1 (`layers.ts`) and v2 (`spaces.ts`) as the only
contract once the cut-over happens (R31: no backward compatibility).

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
