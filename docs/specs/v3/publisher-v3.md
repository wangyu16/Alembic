# Publisher v3 (units, pinning, projection, checks) — mini-spec

**Status:** draft 2 for gate G0 (run model superseded by `queue-and-jobs-v3.md` §5: Publish is a worker job, site build a separate job), 2026-10-27 (draft 1 reviewed; resolutions in §6). Modules A11 (+A12 orz-site on the
worker). Design source: `ALEMBIC-WORKSPACE-DESIGN.md` §4.1, §4.3, §6.5,
§9.4, §18.6; rulings R18, R19, R27.

## 1. What exists

- Site build: `buildCourseSite` (`packages/renderer`) and `pushCourseSite` /
  `publishToBranch` (`apps/web/src/lib/site-publish.ts`), run in-process on
  Vercel, pushing a single root commit to `gh-pages` (atomic for readers).
- Leak scan: `scanPublicRepoForLeaks` (reconcile actions).
- Repos created from templates (`generateFromTemplate`).

## 2. Units

| Unit | Files (from the pinned working-repo tree) |
|---|---|
| **chapter `<slug>`** | the five slot files plus every file under `<space>/chapters/<slug>/` |
| **course** | `alembic.json` (public form, generated), `orz-site.json`, `README.md`, `LICENSE`, `CITATION.cff`, `concepts/course.md`, every file under the `current/` and `metadata/` **directories**, and course-scope files of other public spaces except `assets/` |
| **asset** | each file directly under `assets/` (not chapter-scoped): one unit per file |
| **removed chapter `<slug>`** | a chapter that has published files but is no longer in the manifest at W: its public files are deleted when this unit passes (it passes unless the course map at W still links to it) |

Not units (never projected; Publish writes them itself): `.github/`,
`.alembic/` (regenerated from public items), `.gitignore`,
`provenance/coursewerk/` (publish profile). The chapter slug `course` is
reserved (contract §7). A renamed chapter is a removed chapter plus a new
one. Every projectable path belongs to exactly one unit (P.1).

## 3. A Publish run

Publish is a **queue row** (`kind = 'publish'`) processed by the course
committer on the worker (write-path spec §3), so it is serialised with
writes and with other Publish runs for the course (no two runs overlap), and
it is not bound by Vercel's function time.

```
publish({ packageId, by, choices: { publishAnyway: slug[], approveAndPublish: partPath[], snapshotName?: string } })
```

1. **Authorise** at queue time and again at execution:
   `can(role, isFirstPublish ? 'publish.first' : 'publish.later')`;
   `publish.anyway` for each chosen chapter.
2. **Sync first** (client, before queueing): the publisher's open documents
   are synced; the row is queued after their sync rows, so it sees them.
3. **Write queue ahead of it is empty for this course** (it is processed in
   order), and no row is in `retry` (GitHub unavailable) — else the run
   waits.
4. **Pin** `W` = the working repo head SHA. If `listTree(W)` is truncated →
   refuse ("course too large to publish safely", fail closed). Any symlink
   or submodule entry → refuse (contract §2 rule 6).
5. **Public drift:** read the public head `P`.
   - If `P` = the last recorded `public_sha`, continue.
   - If `P`'s commit carries `Alembic-Publish-Run: <id>` of a run recorded
     `pending` (a crash after the commit), complete that run's record from
     its stored intent and continue.
   - Otherwise (a genuine edit on GitHub): compute the changed paths between
     `public_sha` and `P`; for each changed **projectable unit file** (never
     `alembic.json`, `.alembic/`, `.github/`, `provenance/coursewerk/`),
     queue an outside-change row into the working repo with base = the
     `published_files` version; record `P` as the acknowledged public head
     (so the next run doesn't stop again); stop with "the public copy was
     changed on GitHub — those changes were brought in; run Publish again".
6. **Check each unit at W** with the check plug-ins (§4); findings carry
   `severity: 'always' | 'default' | 'never'`.
7. **Decide per unit:** any `always` → kept; Draft-mode chapter → kept;
   unapproved plan parts at W → kept unless listed in `approveAndPublish`
   (approval rows written now, each **bound to the part's content hash at
   W**); any `default` → kept unless the chapter is in `publishAnyway`
   (recorded); else passes.
8. **Assemble the public tree:**
   - passing units at W; kept units at their `published_files` version (by
     existing blob SHA: tree entries may reference existing public blobs);
     never-published kept units absent;
   - assets: passing at W; kept at last published; deleted-at-W but used by
     a kept chapter stays at last published;
   - public `alembic.json` (`PublicManifestV3`): chapters present in the
     assembled tree, titles and order from W;
   - `.alembic/` regenerated from public items; `provenance/coursewerk/`
     from the publish profile (empty until FC-16 v1).
9. **Link check to a fixpoint:** a link from a passing chapter to a path
   absent from the assembled tree, or to an asset kept at an older version
   than the chapter's W reference, is a `default` finding on that chapter;
   re-decide; repeat until no decision changes (decisions only move from
   passes to kept, so at most one round per chapter).
10. **Commit, recorded first:** insert `publish_runs(id, W, intended tree
    sha, choices, status 'pending')`; then **one commit** to the public repo
    on parent `P` (compare-and-swap on `P`), every path through
    `assertPathAllowedInPublicRepo` and `isProjectable` (fail closed), with
    trailer `Alembic-Publish-Run: <id>`; tag if `snapshotName`; first
    Publish creates the public repo first (quiet settings).
11. **Record immediately:** `publish_runs.status = 'committed'`,
    `public_sha`, per-unit results; `published_files`.
12. **Build the site from the assembled public tree** (never from W, so
    kept and draft chapters never reach the site) with orz-site on the
    worker; `publishToBranch` to `gh-pages` (one ref move). A build failure
    leaves the previous site live and marks the run `committed, site
    failed` with a retry action; the public repo is already correct.
13. Activity line; Needs-you items for kept units.

## 4. Check plug-ins (interface I8)

```ts
interface Check { id: string; run(unit: UnitFiles, ctx: CheckContext): Promise<Finding[]> }
```

| Check | Severity | Release |
|---|---|---|
| private path in the unit (should be impossible) | always | A |
| format validity (FC-18 header, parse) | default | A |
| accessibility basics (existing a11y checks) | default | A |
| link check (§3.9) | default | A |
| answer-key overlap vs `private/instructor/` (any 12-word run, R27) | always | B |
| copying vs source fingerprints (50-word quotation cap etc., R27) | always | B |
| Coursewerk gate (findings from FC-16 state; maturity, rights) | always / default / never per finding | D |

## 5. Claims (bound to tests)

- **P.1** every projectable path belongs to exactly one unit (property test
  over generated trees).
- **P.2** nothing outside `isProjectable` reaches the public tree; the
  public commit is refused if any path fails the public-repo check
  (adversarial trees with `private/…` under every disguise).
- **P.3** a kept chapter's public files are byte-identical to its last
  published version.
- **P.4** the pinned version is honoured: a sync landing during the run is
  not in this publish (test with a sync injected between steps 4 and 10).
- **P.5** public drift stops the run and brings the change in.
- **P.6** the public `alembic.json` never names the working repo and lists
  exactly the published chapters.
- **P.7** "always" findings can't be overridden by any choice.
- **P.8** first Publish requires the owner; later Publish allows a deputy.
- **P.9** the site branch moves once per run (atomic for readers); a failed
  build leaves the previous site live.
- **P.10** `published_files` and `publish_runs` describe exactly the public
  commit (rebuildable check).
- **P.11** crash after the public commit (step 10) → the next run completes
  the record from the trailer and does not treat its own commit as drift.
- **P.12** genuine drift → brought in (never `alembic.json` or
  `provenance/coursewerk/`), acknowledged; the following run proceeds.
- **P.13** two Publish requests for one course → processed one after the
  other; records consistent.
- **P.14** the site is built from the assembled tree: a kept or draft
  chapter's W content never appears on the site.
- **P.15** truncated tree, symlink, submodule → refused.
- **P.16** `approveAndPublish` approvals are bound to the content hash at W.
- **P.17** the link check reaches a fixpoint (generated chains of links).
- **P.18** `.github/`, `.alembic/` from the working repo never reach the
  public repo.

## 6. Review resolutions (G0 round 1)

| Finding | Resolution |
|---|---|
| H-7 crash after commit loops | §3 steps 5, 10, 11 (pending row, trailer, record before build) |
| H-8 drift loops; drift damages manifest | §3 step 5 (acknowledge; projectable unit files only) |
| H-9 concurrent runs | §3 Publish is a queue row |
| H-10 approvals not bound | §3 step 7 |
| H-11 kept assets and links; blob reuse | §3 steps 8, 9 |
| H-12 truncated tree | §3 step 4 |
| P-1 unit holes, reserved slug, removed chapters | §2 |
| P-2 link-check fixpoint | §3 step 9 |
| P-3 site source, snapshot input | §3 steps 12, `snapshotName` |
| P-4 public manifest chapters | §3 step 8 |
| F-4 Vercel time | §3 runs on the worker |
| contract 3.4/3.5 symlinks, `.github/` | §2, §3 step 4 |
