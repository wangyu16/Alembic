# Write path v3 (sync, version rule, kept versions, write queue) — mini-spec

**Status:** draft for gate G0, 2026-10-27. Modules A4 (+A5 blocks adapter,
A6 outage outbox). Design source: `ALEMBIC-WORKSPACE-DESIGN.md` §7.1, §7.6,
§8.8 #37, §18.1, §18.4.

## 1. What exists and is kept

- `writeThrough` (`packages/package-ops/src/write-through.ts`): validate →
  commit → project; a failed commit changes nothing. **Kept** as the core;
  it becomes working-repo-only.
- `GitHubClient.createCommitOnBranch` / `commitOnce`
  (`packages/github-bridge/src/client.ts`): one commit with `base_tree`,
  one retry on non-fast-forward guarded by `assertPlanUnchanged`
  (overlap → `RemoteChangedError`). **Kept**; extended with a two-commit
  chain (§5).
- `baseHash` = SHA-256 of the stored text; `FileChangedSinceOpenedError`
  refuses a stale save today. **Replaced** by the version rule (§4).

## 2. Entry points

```ts
sync(input: {
  packageId: string; docPath: string;
  baseVersion: string | null;   // sha256 of the version the editor started from; null = new file
  text: string;
  actor: Actor;                 // { userId, role, door: 'A'|'D'|'F' }
  fromOpenEditor: boolean;      // true for Door A syncs (the typist-on-top rule)
}): Promise<SyncResult>

handOver(changeset: AgentChangeset): Promise<HandOverResult>   // §6, used by C4
applyOutside(change: OutsideChange): Promise<OutsideResult>      // Door C, used by B1
```

`SyncResult = { outcome: 'landed'|'combined'|'both-changed'|'refused'|'queued', version, keptVersion?, itemId?, reason? }`.

All three go through one function `applyChanges(packageId, changes,
meta)`, which holds the course's write lock (§3) and runs §4 per file.

## 3. Per-course write queue

- Every commit to a course's working repo runs inside
  `withCourseLock(packageId, fn)`: a Postgres advisory transaction lock
  keyed by the package id (`pg_advisory_xact_lock(hashtext('w:'||id))`),
  held for read-head → decide → commit → record.
- Holders: sync, handOver, applyOutside, outbox drain, Publish's tag step,
  force-push restore. Nothing else commits to the working repo.
- Lock wait timeout 20 s → `refused` with reason `busy` (client retries
  with backoff; the device keeps the text, so nothing is lost).
- Because writes are serialised, the non-fast-forward retry in
  `createCommitOnBranch` remains only as protection against Door C pushes
  landing mid-commit.

## 4. The version rule (per file)

Inputs: `base` (from the change), `current` (sha256 of the file at the
working repo head, or of the outbox head if the outbox is non-empty, §7),
`incoming` text.

1. `base === current` → **landed**.
2. `base !== current` and the file kind is course-plan
   (`concepts/*`, `assessment-support/*`) → never combined: both inputs
   are committed as kept versions, the current stays on top, and an
   **Approve** item shows the combined proposal (if `combine` succeeds) or
   both versions. Outcome `both-changed`.
3. `base !== current`, other text files:
   - `blocks = splitBlocks(kind, text)` for base, current, incoming (A5).
   - Three-way merge at block granularity: if the sets of blocks changed
     base→current and base→incoming are disjoint, build the combined text,
     `canonicalize` it, run format validation; on success → **combined**.
   - Otherwise (overlap, or validation fails) → **both-changed** (§5).
4. Binary files (assets): `base !== current` → both-changed, never combined.
5. Records under `private/coursewerk/` → only via handOver/log appender
   (FC-16 v1); `sync` and `applyOutside` refuse them (`refused`,
   `records-not-editable`).

**A5 interim:** until orz-markdown exports `splitBlocks`/`canonicalize`
(K3), every file is one block (so any concurrent change → both-changed),
except study guides, which use the existing `block-source.ts` splitter and
`prepareStudyGuideSave` canonical form.

## 5. Both changed

- **Which stays on top:** if `fromOpenEditor` is true, the incoming text is
  on top (the person is looking at it); otherwise the current version stays
  on top and the incoming is kept.
- **Commit shape:** one `commitOnce`-style operation builds **two commits**
  — first the kept (not-on-top) version as a child of head, then the top
  version as its child — and moves the branch **once** to the second. Head
  never shows the kept version. If the top version equals current (the
  incoming is kept), the second commit restores current's bytes.
- **Commit trailers** (every Alembic commit): `Alembic-Actor`,
  `Alembic-On-Behalf-Of`, `Alembic-Door`, `Alembic-Changeset`,
  `Alembic-Base`, `Alembic-Kept: true` on kept-version commits.
- **Item:** a Needs-you `both-changed` item (A10) with both versions'
  commit SHAs, addressed per design §7.6 rule 3.

## 6. Agent changesets (interface used by C4)

`AgentChangeset = { changesetId (uuid), sessionId, jobId, summary,
dependsOn?: changesetId, files: [{ path, baseVersion|null, content|null,
encoding?, movedFrom? }], logEntries: [...] }`.

- Idempotent by `changesetId` (`changesets` table; a replay returns the
  stored result).
- `dependsOn` pending → the changeset waits (stored as pending) and is
  applied after its dependency.
- Deferral (any file being edited, `typing` table, < 2 min) is decided by C4
  before calling `handOver`; `handOver` applies all files in **one commit**
  (plus kept-version commits in the same chain) or none.
- Records land only if every content file landed or was combined (design
  §4.2); otherwise the records return with the bounce.

## 7. Outage outbox (A6)

- When a commit fails with a GitHub availability error (5xx, timeout,
  401/403 on a revoked install), `applyChanges` writes the change to
  `outbox` (seq per course) and answers `queued`.
- **While a course's outbox is non-empty, every write for that course goes
  to the outbox**; the drain (a worker job holding the course lock) is the
  only committer, oldest first, one commit per entry, re-running §4 against
  the real head (a clash becomes both-changed then).
- The version rule's `current` reads the outbox head when non-empty, so
  people keep working against what they last saw.
- Bound: 14 days undrained → the course becomes read-only with an
  explanation; members can download their pending text.

## 8. Claims (bound to tests)

- **A4.1** landed: base = current → one commit, head = incoming.
- **A4.2** combined: disjoint block edits → one commit containing both,
  validated; property test over generated edit pairs.
- **A4.3** overlap → two commits, one ref move; head bytes = the top
  version; the kept version is reachable at head~1 and never was head.
- **A4.4** course-plan files never combine; an Approve item is created.
- **A4.5** concurrency: N parallel syncs to one course (fake RepoClient
  with real Postgres locks in PGlite) → commits strictly serial, no lost
  text, every outcome reported.
- **A4.6** idempotent hand-over: the same `changesetId` twice → one set of
  commits.
- **A4.7** outbox: while non-empty, a direct write is never committed ahead
  of an older queued one; drain re-checks and reports clashes.
- **A4.8** records refused from sync and applyOutside.
- **A4.9** typist-on-top: `fromOpenEditor` incoming is on top; otherwise
  current is on top.
- **A4.10** every Alembic commit carries the trailers; `doc_versions` can be
  rebuilt from them for Alembic's own commits.
- **A4.11** the public repo is never written by any entry point here (scan
  + runtime assert: the RepoClient passed in is the working repo's).
