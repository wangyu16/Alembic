# Discovery index — projection, search, ranking (Phase 5 Track A)

Status: **A.1 built** (2026-10-23, branch `phase5/trackA-core`, migration
`0022_trackA_discovery.sql` not yet applied anywhere). Binding inputs:
[goal.md](../goal.md) §6 (portal: search facets, quality "gates prominence,
not censorship", the portal consumes the same standard metadata) and §9
(adaptation entry points); [Roadmap.md](../Roadmap.md) rule 3 (one metadata
source); [document-model.md](document-model.md) §4 (two scopes, per-file
"share this"); [permalinks-and-registration.md](permalinks-and-registration.md)
§2 and §6; [package-contract-v2.md](package-contract-v2.md) §3, §5, §8, §10;
[collections-framework.md](collections-framework.md) §4;
[portal-governance.md](portal-governance.md).

## 1. The projection (A.1)

Two tables, both a **rebuildable projection** — never a second metadata
store. No app code writes them; they are derived in the database by
`discovery_refresh_package(packageId)` from:

| Source | What it gives |
|---|---|
| `portal_registrations` | the Tier-3 **List publicly** consent (row existence) and when it was given |
| `packages.manifest` (the manifest read cache) | title, description, keywords, discipline, `courseContext` (level and public identity fields), licence, accessibility status, chapters, public repo, `adaptedFrom` — exactly `DISCOVERY_MANIFEST_FIELDS` in package-contract |
| `documents` (the registry) | shared files: kind, space, path, description, alt text, tags, per-file licence, lineage (`adapted_from`), content hash |
| `sandbox_files` (public `concepts/course.md`, legacy `metadata/course.md`) | concept-map headings → **topics** |

`discovery_courses` — one row per **listed course**: title, description,
keywords, chapter titles, topics, discipline and level (trimmed,
lower-cased; null when not stated), public course identity
(`courseName`, `level`, `institutionType`, `instructor`, `courseNumber`,
`department`), licence, accessibility status, chapter and element counts,
lineage (adapted from: package id, title, URL, attribution; adaptation
count), site and source URLs, `listed_at`, `updated_at`, completeness, and
the search columns.

`discovery_elements` — one row per **shared element**: kind, space
(artifact type), permalink class, path, display title (description, else
alt text, else file name), description, alt text, tags, licence (the file's,
else the package's), package title, discipline, level, whether its course is
also listed, lineage (adapted from doc, adaptation count), "described"
(has a description or alt text), `listed_at`, `updated_at`, completeness,
and the search columns.

### 1.1 What may be listed (one predicate each)

- **Course:** a `portal_registrations` row **and** a published package
  (`storage = 'github'`) **and** not archived **and** an open licence **and**
  a public repo in the manifest (`discovery_course_listable`).
- **Element:** `discoverable` ("share this") **and** not tombstoned **and**
  `repo = 'public'` **and** space not `private`/`current` **and** a published,
  non-archived package (`discovery_element_listable`). Per-file consent: it
  does not need the course to be listed (document-model.md §4).

Never: private files, `current` files, trial (unpublished) packages,
archived packages, unlisted courses, unshared files, tombstoned files.

The same predicate is enforced four times: by the projector (rows are
deleted the moment a package stops qualifying), by the **search functions**
(which join the live `packages`/`documents`/`portal_registrations` rows, so
even a stale projection row cannot be returned), by the **public read
policy** (RLS re-checks the predicate per row), and by **CHECK
constraints** (`discovery_elements` cannot hold a `private`-repo,
`private`-space or `current`-space row). The app re-checks returned rows
once more against the contract (`parseCourseRows` / `parseElementRows`,
fail-closed).

### 1.2 Freshness

Triggers re-project the touched package on every change the projection
depends on:

| Change | Trigger |
|---|---|
| list / unlist (incl. an operator deleting the registration row — takedown) | `portal_registrations` |
| any manifest write (course details, rename, accessibility check, chapters, licence), publishing (`storage → github`), archive / restore | `packages` (row) |
| share / unshare, asset metadata, delete (tombstone), rename / move, content saves | `documents` (statement-level: a bulk registry write re-projects each package once) |
| course concept-map save | `sandbox_files`, filtered to the two concept-map paths |
| a fork (`manifest.adaptedFrom`) or an element copy (`adapted_from`) | the **source** package is re-projected (its adaptation count) |

**Best-effort:** every trigger goes through `discovery_refresh_safe`, which
turns a projector error into a `WARNING`; the educator's write always
succeeds, and the next change or a rebuild catches up.

**`updated_at`** is when the listing last changed what it says (an md5
fingerprint of the projected listing fields) or when a public file of the
course was saved (a registry content-hash change outside `private` /
`current`). A new row starts at its listing (or registration) time. This is
the one projected value that is not re-derivable: a rebuild of an emptied
table starts each row at its listing time again. Accepted — it only weakens
the recency signal (§3) until the next change.

**Rebuild:** `select public.discovery_rebuild();` (service role / SQL
editor) deletes every row that no longer qualifies and re-projects every
candidate package. The migration ends with it, so applying `0022`
back-fills the index. Tests prove a rebuild from empty reproduces every
derived column.

### 1.3 Access

- `discovery_courses`, `discovery_elements`: `select` for `anon` and
  `authenticated` through the listability policy; no insert/update/delete
  for either (revoked, and no policy).
- `documents` stays owner-only. The Elements list no longer needs the
  service role (A.4).
- The projector functions are revoked from `anon`/`authenticated`
  (Supabase grants new functions to them by default); `discovery_rebuild` is
  granted to `service_role`.

### 1.4 Forward seams

- **A.5 embeddings (owner decision Q1, later):** add an embedding column of
  the public listing text to each table and fill it from the projector; the
  row identity, predicates and triggers do not change.
- **A.8 format-1 header fields** (title, `uid`, theme) join the element row
  when documents carry them (Track C).
- **Citations** as a ranking signal: no citation data exists yet; the
  ranking (§3) leaves room for it.

## 2. Search (A.2)

*Added with A.2.*

## 3. Ranking (A.3)

*Added with A.3.*
