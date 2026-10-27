# Package contract v3 (FC-15 v3) — mini-spec

**Status:** draft for gate G0, 2026-10-27. Module K1 of the build plan
(orz-family `docs/ALEMBIC-BUILD-PLAN.md`). Design source: orz-family
`docs/ALEMBIC-WORKSPACE-DESIGN.md` §4, §13, §18.2 (owner rulings R18, R20,
R24, R27, R31). Replaces v1 (`layers.ts`) and v2 (`spaces.ts`) as the only
contract once the cut-over happens (R31: no backward compatibility).

## 1. The two repositories

| Repo | Name | Holds | Written by |
|---|---|---|---|
| **working** (private) | `<slug>-private` | the whole course tree, every space | the write path only (and the owner on GitHub) |
| **public** | `<slug>-oer` | the projection: public spaces of published units | Publish only |

`RepoKind` keeps its two values; `"private"` now means the working repo.

## 2. Spaces and paths

The v2 space list is kept, unchanged in name and directory:

```
study-guide  slides  practice  concepts  assessment-support
assets  current  metadata  provenance  private
```

Rules:

1. **Classification** (`spaceForPath`) is unchanged: the first path segment
   decides the space; an unknown directory or root file throws
   `PathLayerError` (fail closed); `..` throws.
2. **Root files:** `alembic.json`, `README.md`, `LICENSE`, `CITATION.cff`,
   `.gitignore`, and new **`orz-site.json`**. Root directories: `.alembic`,
   `.github`. They classify as space `metadata` as before.
3. **Working repo accepts every classifiable path**
   (`assertPathAllowedInWorkingRepo(path)`: throws only if `spaceForPath`
   throws).
4. **Public repo accepts only public spaces**
   (`assertPathAllowedInPublicRepo(path)`): any path in space `private`
   throws `SpaceBoundaryViolation`; root files allowed. No override
   parameter, by design (unchanged invariant).
5. **Projectable** (`isProjectable(path)`): true for every path the public
   repo accepts, **except** paths under `provenance/coursewerk/`, which are
   written only by the publish profile (they are produced at Publish, never
   copied from the working repo).

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

## 6. Manifest (`alembic.json`) schemaVersion 3

Adds to v2: `unitTerm` (exists), `level`, `audience`, `coursewerk`
(`{version}` or absent), `upstream` (`{packageId, version}` or absent),
`chapters[].mode` (`"draft"|"package"`, default `"package"`).
Removes: any field naming the working repo from the **public** copy
(Publish writes the public manifest; the working copy may keep `repos`).
`SUPPORTED_SCHEMA_VERSIONS` becomes `[3]` at the cut-over (R31).

## 7. Functions (package-contract, pure)

| Function | Behaviour |
|---|---|
| `spaceForPath(path)` | unchanged, plus `orz-site.json` root file |
| `assertPathAllowedInWorkingRepo(path)` | §2.3 |
| `assertPathAllowedInPublicRepo(path)` | §2.4 (= today's `assertPathAllowedInRepoV2(path, "public")`) |
| `isProjectable(path)` | §2.5 |
| `assertPrivatePath(path)` | §3 |
| `SourcePointerSchema` | §5 |
| `PackageManifestSchemaV3` | §6 |
| `slotPath` / `slotForPath` | §4 |

Removed at the cut-over: `layerForPath`, `assertPathAllowedInRepo` (v1),
`LAYER_*`, `spaceForV1Layer` (kept only in the migration helper script).

## 8. Claims (bound to tests)

- **K1.1** every path the public repo accepts is classifiable; no `private/…`
  path is ever accepted by the public repo (property test over generated
  paths, including `private`, `Private`, `./private`, `private/../x`,
  backslashes, leading slashes, URL-encoded segments).
- **K1.2** the working repo accepts every classifiable path and rejects every
  unclassifiable one.
- **K1.3** `provenance/coursewerk/…` is never projectable; every other
  public-repo-accepted path is.
- **K1.4** `assertPrivatePath` accepts exactly the four subfolders.
- **K1.5** slot bijection holds with `.slides.md`.
- **K1.6** source pointer and manifest v3 schemas reject unknown fields and
  a public manifest naming the working repo.

## 9. Coordination

Coursewerk fetches the newest contract from Alembic's public `main`
(Coursewerk D37). v3 lands on `main` only at the cut-over, after Coursewerk
has seen this draft (sent 2026-10-27 through AgentPortal).
