# Publisher v3 (units, pinning, projection, checks) — mini-spec

**Status:** draft for gate G0, 2026-10-27. Modules A11 (+A12 orz-site on the
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
| **chapter `<slug>`** | the five slot files (`concepts/<slug>.md`, `assessment-support/<slug>.md`, `study-guide/<slug>.md`, `slides/<slug>.slides.md`, `practice/<slug>.md`) plus every file under `<space>/chapters/<slug>/` |
| **course** | `alembic.json`, `orz-site.json`, `README.md`, `LICENSE`, `CITATION.cff`, `concepts/course.md`, every file under `current/`, `metadata/` and course-scope files of other public spaces |
| **asset** | each file under `assets/` that is not chapter-scoped (one unit per file) |

Every projectable path (contract v3 `isProjectable`) belongs to exactly one
unit (claim P.1).

## 3. A Publish run

```
publish({ packageId, by, choices: { publishAnyway: chapterSlug[], approveAndPublish: partPath[] } })
```

1. **Authorise:** `can(role, isFirstPublish ? 'publish.first' : 'publish.later')`;
   `publish.anyway` per chosen chapter.
2. **Sync first:** the publisher's open documents are synced (client step
   before the call; the server refuses if the publisher's device reports
   unsynced documents for this course, with "sync first").
3. **Outbox empty**, else refuse ("changes still waiting for GitHub").
4. **Pin:** read the working repo head SHA `W` under the course lock;
   release the lock (Publish reads only from `W`).
5. **Public drift:** if the public repo head ≠ last recorded `public_sha`,
   bring the changed public files into the working repo as Edited elsewhere
   (Door C path) and stop with "public copy changed on GitHub — run Publish
   again".
6. **Check each unit at `W`** with the check plug-ins (§4). Each check
   returns findings `{ unit, path, kind, severity: 'always'|'default'|'never', message }`.
7. **Decide per unit:**
   - any `always` finding → **kept** (not published this run);
   - chapter with unapproved plan parts at `W` → kept, unless listed in
     `approveAndPublish` (approval rows are written first, then it proceeds);
   - any `default` finding → kept, unless the chapter is in `publishAnyway`
     (recorded);
   - otherwise → **passes**.
   - Draft-mode chapters → kept, always.
8. **Assemble the public tree:**
   - passing units: their files at `W`;
   - kept units: their files at their `published_files` version (absent if
     never published);
   - assets: passing asset units at `W`; a kept asset keeps its last
     published version; an asset deleted at `W` but referenced by a kept
     chapter stays at its last published version;
   - `alembic.json` (public form: no working-repo name; chapters = published
     chapters), course map as written;
   - `provenance/coursewerk/` from Coursewerk's publish profile (empty until
     FC-16 v1).
9. **Link check on the assembled tree:** a link from a passing chapter to a
   path absent from the assembled tree → a `default` finding on that
   chapter; if it changes the decision, go back to step 7 once (a second
   change keeps the chapter).
10. **Write:** every path through `assertPathAllowedInPublicRepo`
    (fail closed), then **one commit** to the public repo (created at the
    first Publish, quiet settings), tag if a snapshot is being published.
11. **Build and push the site** with orz-site (A12; on the worker, falling
    back to in-process for small courses until the worker queue is proven),
    `publishToBranch` to `gh-pages`.
12. **Record** `publish_runs` (W, public SHA, per-unit results, choices) and
    `published_files`; Activity line; Needs-you items for kept units.

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
