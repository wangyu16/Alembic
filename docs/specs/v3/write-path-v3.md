# Write path v3 (sync, version rule, kept versions, per-course queue) — mini-spec

**Status:** draft 2 for gate G0 (queue details superseded by `queue-and-jobs-v3.md`), 2026-10-27 (draft 1 reviewed; findings
W-1…W-10, H-1…H-6, F-1…F-3 resolved here, see §10). Modules A4 (+A5 blocks
adapter, A6 outage handling). Design source: `ALEMBIC-WORKSPACE-DESIGN.md`
§7.1, §7.6, §8.8 #37, §18.1, §18.4.

## 1. What exists and is kept

- `writeThrough` (`packages/package-ops/src/write-through.ts`):
  validate → commit → project; a failed commit changes nothing. **Kept** as
  the per-change core, called only by the course committer (§3).
- `GitHubClient` (`packages/github-bridge/src/client.ts`): Git Data API
  commits with `base_tree`, a non-force ref PATCH, a bounded HTTP retry.
  **Extended** with `commitChain` (§5) and an expected-head check (§3.4).
- The web app reaches Postgres only through supabase-js (each `.rpc()` is its
  own transaction), so **no database lock is held across GitHub calls from
  Vercel**. Committing moves to the worker.

## 2. Entry points (Vercel, fast, no GitHub calls)

```ts
sync(input: { packageId; docPath; baseVersion: string | null; text; actor; fromOpenEditor: boolean; syncId: uuid })
  → { writeId, status: 'queued' }            // result arrives via Realtime / poll
handOver(changeset: AgentChangeset)          // C4; same queue, kind 'changeset'
applyOutside(change: OutsideChange)          // B1; same queue, kind 'outside'
```

**Amended 2026-10-29 (package-contract-v3 §11, §13):**
- `upload(file)` is the one entry point that calls GitHub. It creates the
  blob after its checks, records it in `course_blobs`, then queues a
  blob-reference row. It is online only.
- `courseOp(op)` queues kind `courseop`: an operation and its arguments,
  applied at the head by the committer.
- File entries may be text, a blob reference, a delete or a move
  (package-contract-v3 §11.2).

Each call validates its input (path rules, `can()`, size) and inserts **one
row** into `write_queue(package_id, seq, kind, payload, idem_key, status,
result, created_at)` in a single fast transaction. `idem_key` (`syncId`,
`changesetId`, or the push's head SHA) is unique per course; a repeat
returns the existing row (H-1, H-2: idempotency is decided *before* any
commit).

The client keeps its text on the device ("Saved") and shows "Synced" when
the row's result arrives. It adopts the returned `version` as its new base
(W-6).

## 3. The course committer (worker)

### 3.1 One consumer per course

The worker (Fly in production; the VPS in testing) has a direct Postgres
connection. It takes the course's lowest non-terminal row in strict order
(`queue-and-jobs-v3.md` §2.3) inside a **per-course claim**: a row in `course_committer(package_id,
holder, fence, lease_until)` taken with a short transaction and renewed
every 10 s. A worker only processes courses it holds the lease for, and
every database write it makes is conditional on its `fence` (a stale holder
can't record anything after losing the lease).

### 3.2 Processing one queue row

1. Read the working repo head `H` (commit SHA and tree) **from GitHub**.
2. For each file, `current` = the blob at `H` (W-2), compared as sha256 of
   its bytes. A `sha256 → git blob sha` cache avoids repeated blob reads
   (F-2).
3. Apply the version rule (§4) and build the commit(s) on parent `H`.
4. Move the branch with a compare-and-swap: GraphQL `createCommitOnBranch`
   with `expectedHeadOid = H`, or a non-force PATCH preceded by an
   `H`-still-head check (H-4). On mismatch (Door C push, force-push), go
   back to step 1 for this row — at most 3 times, then mark the row
   `retry` with backoff. `RemoteChangedError` never reaches a caller (H-3).
5. Record the result on the row, `doc_versions`, items (fenced).
   **Crash between 4 and 5:** on restart the committer finds rows
   `processing`, scans the recent head history for the row's
   `Alembic-Write` trailer, and records the found result instead of
   committing again (H-1, H-2).

### 3.3 Waiting and latency

A row is normally committed within a few seconds (one worker loop + one
GitHub commit). Sync cadence (design §7.1) keeps the volume low.

### 3.4 Publishing

Publish is a worker **job** (one per course at a time), not a queue row; its
working-repo writes are ordinary queue rows (`queue-and-jobs-v3.md` §5).

## 4. The version rule (per file)

0. `sha(incoming) === current` → **landed**, no commit for that file
   (H-1: a replay or a duplicate is harmless).
1. `base === current` → **landed**.
2. **Base text unavailable** (no blob for `base` in the recent history or
   the cache) → **both-changed** (W-1).
3. **Delete or move** (W-3):
   - delete with `base === current` → landed delete;
   - delete with `base !== current` (someone edited it) → refused as a
     delete; a Both changed item "X deleted this, Y changed it" with the
     current file kept;
   - edit against a file deleted since `base` → the edit is committed back
     as a kept version, and an Edited elsewhere item offers to restore it;
   - move: treated as delete-old + create-new under the same rules; a
     create on a path that now exists → both-changed.
4. **Course-plan files** (`concepts/*`, `assessment-support/*`) → never
   combined. The incoming version is committed as a kept version; current
   stays on top regardless of `fromOpenEditor` (the plan's approved text
   must not change by a race); an Approve item shows both and a combined
   proposal if one exists (W-4).
5. **Other text files:** `splitBlocks` base/current/incoming (A5).
   Three-way merge at block level, defined as:
   - a block is identified by its FC-02 id, else by its position among
     unchanged neighbours (anchor = the previous unchanged block);
   - changes are disjoint if no block is changed, deleted or has an insert
     at the same anchor in both sides;
   - reorders count as changes to every moved block;
   - the FC-18 header is one block; the preamble before the first block is
     one block (W-8).
   Disjoint → combined text, `canonicalize`, format-validate → **combined**.
   Otherwise → **both-changed**.
6. **Binary files** → base ≠ current → both-changed.
7. **Records** under `private/coursewerk/` → only from `changeset` rows of
   the harness; refused elsewhere.
8. **`alembic.json`** → not writable through `sync`; only the course
   operations (package-contract-v3 §13: `courseop` rows applied at the head;
   amended 2026-10-29, replacing `updateManifest`) (W-10).

## 5. Both changed

- **On top:**
  - a `sync` from an open editor (`fromOpenEditor`) puts the incoming text
    on top, **unless** the document already has an open Both changed item
    involving another person (H-5): then current stays on top and that
    person's autosync for the document pauses until the item is resolved;
  - everything else (Replace, offline sync, agent, outside, and any row
    processed after an outage) keeps current on top.
- **Commits:** if current stays on top, one commit whose tree = H's tree
  plus the incoming file is the **kept** commit, followed by a commit
  restoring current's bytes; both built with `commitChain(H, [treeKept,
  treeH])` and one ref move (F-3). If incoming goes on top, current is
  already in history (it is `H`): a single ordinary commit, with the item
  pointing at `H` as the kept version (W-5).
- **Several both-changed files in one row:** one kept commit containing all
  their incoming versions, then one top commit.
- **Trailers** on every Alembic commit: `Alembic-Write: <row id>`,
  `Alembic-Actor`, `Alembic-On-Behalf-Of`, `Alembic-Door`, `Alembic-Base`,
  and `Alembic-Kept: true` on kept commits.

## 6. Agent changesets

- **All or nothing** means: one row, one commit chain; per-file outcomes
  are reported, and a file that is both-changed is still committed (as kept
  or on top per §5). Nothing in a changeset is half-applied.
- **Records** in the changeset are committed only if every content file
  landed or was combined; otherwise the row's result is `bounced` with the
  records returned. The agent resubmits them in a **new** changeset (new
  `changesetId`) after catching up (W-7).
- **`dependsOn`:** the committer processes a row only when its dependency
  row is `done`. If the dependency was bounced or refused, the dependent is
  bounced too ("depends on a bounced change"). An unknown id or a cycle
  → refused at insert (W-7).

## 7. GitHub unavailable (A6)

- **Outage** (5xx, timeouts): rows stay `queued` / `retry` with exponential
  backoff (1 min → 15 min). The queue *is* the outbox; nothing else is
  needed. Clients show "Synced to Alembic — waiting for GitHub".
- **Revoked access** (401/403 from the installation): not an outage. The
  owner gets "Reconnect GitHub" at once; rows wait (H-6).
- **Agent:** pauses when the course's oldest row is older than 10 min.
- **Bound:** 14 days undrained → the course becomes read-only with an
  explanation; members can download their queued text.
- At drain time `fromOpenEditor` is ignored (current stays on top), because
  the editor may be long gone (H-6).

## 8. Interfaces this adds

- `RepoClient.commitChain(coords, parent, trees[], messages[], expectedHead)`
  in `@alembic/github-bridge`.
- `write_queue`, `course_committer` tables; `doc_versions` as before.
- Worker loop `courseCommitter` in `apps/worker`.

## 9. Claims (bound to tests)

| Claim | Test |
|---|---|
| A4.1 landed / A4.0 no-op on identical text | fake GitHub with ref CAS |
| A4.2 combined: disjoint block edits merge; property test over generated edit pairs | pure |
| A4.3 current-on-top: two commits, one ref move, head bytes = current, the kept commit is head~1; incoming-on-top: one commit | fake GitHub |
| A4.4 course-plan never combined, current always on top, Approve item | pure + fake |
| A4.5 concurrency: N writers, several worker processes, **real Postgres** (Docker or Supabase local; not PGlite); commits strictly serial per course; no lost text | integration |
| A4.6 idempotency: same `syncId`/`changesetId` twice → one result, one commit; crash after the ref move → trailer scan records it, no second commit | fake GitHub with injected crash |
| A4.7 Door C push between head read and ref move → re-decided, no overwrite, no error leaks | fake GitHub |
| A4.8 force-push between head read and ref move → refused by CAS, re-read | fake GitHub |
| A4.9 lease lost mid-row → fenced recording rejected, row reconciled by trailer | real Postgres |
| A4.10 delete vs edit, move vs edit, base unavailable | pure + fake |
| A4.11 two open editors → no ping-pong (second party paused) | fake |
| A4.12 dependsOn: bounced dependency, unknown id, cycle | pure + fake |
| A4.13 records refused outside harness changesets; records bounce with content | fake |
| A4.14 every Alembic commit has the trailers; `doc_versions` rebuilds from them | fake |
| A4.15 no write-queue entry point writes the public repo; only the Publish job and the site-build job do (scan + runtime assert) | scan |

## 10. Review resolutions (G0 round 1)

| Finding | Resolution |
|---|---|
| F-1 lock across GitHub calls impossible from Vercel | §2–§3: queue rows + one worker consumer per course with a fenced lease; GitHub CAS for correctness |
| W-1 base text, W-2 current source, W-3 delete/move | §4 rules 2, 3; current read from the head's blob |
| W-4 course-plan vs typist | §4 rule 4 |
| W-5 A4.3, chain shape | §5 |
| W-6 canonical form | §2 client adopts returned version |
| W-7 dependsOn, records resubmission | §6 |
| W-8 block semantics | §4 rule 5 |
| W-9 lock holders | §3.4 |
| W-10 manifest | §4 rule 8 |
| H-1, H-2 idempotency and crash | §2 idem key at insert; §3.2 step 5 trailer scan |
| H-3, H-4 Door C and force-push mid-commit | §3.2 step 4 |
| H-5 ping-pong | §5 |
| H-6 revoked install, drain staleness | §7 |
| F-2 version identity | §3.2 step 2 |
| F-3 chain commits | §5, §8 |
| A4.5 untestable on PGlite | §9: real Postgres |
