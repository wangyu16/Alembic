# Course write queue and worker jobs (v3) — mini-spec

**Status:** draft 2 for gate G0 (round 2 and round 3 resolutions; §9), 2026-10-27. This spec
**takes precedence** over the queue passages of `write-path-v3.md` and the
run model of `publisher-v3.md` where they differ. It answers G0 round 2.

## 1. Two mechanisms, clearly separated

| Mechanism | What it serialises | Holds the course for | Implementation |
|---|---|---|---|
| **Course write queue** (`write_queue`) | every commit to the course's **working repo** | seconds per row | one consumer per course, fenced lease (§3) |
| **Worker jobs** (pg-boss) | long work: Publish runs, site builds, checks, reconcile sweeps | minutes, but never blocks writes | `singletonKey = <kind>:<packageId>` so two runs of one kind for one course never overlap |

Publish is a **job**, not a queue row (§5). Its only working-repo writes
(approval-related rows, drift bring-in) are enqueued as ordinary queue rows.

## 2. The write queue

### 2.1 Table

```sql
create table public.write_queue (
  id uuid primary key default gen_random_uuid(),
  package_id text not null references public.packages(id) on delete cascade,
  seq bigint generated always as identity,
  kind text not null check (kind in ('sync','changeset','outside','restore','system','courseop')),
  actor_id uuid,                -- null only for kind 'outside'/'system'; required for 'courseop'
  invoker_id uuid,              -- agent changesets: the person who started the job
  pusher_login text,            -- 'outside': who pushed on GitHub (from the push event)
  payload jsonb not null,
  idem_key text not null,            -- stored prefixed by kind (§2.2)
  priority smallint not null default 0, -- 1 = front of line (undo rows, §4)
  depends_on uuid references public.write_queue(id),
  status text not null default 'queued'
    check (status in ('queued','processing','retry','done','bounced','refused','failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  unique (package_id, kind, idem_key),
  check (depends_on is null or depends_on <> id)
);
-- depends_on must be a row of the same course (checked by enqueue functions).
```

### 2.2 Who may insert, and where `actor` comes from

- **Nobody inserts directly.** `revoke insert, update, delete … from anon,
  authenticated`; members may SELECT their course's rows (to see status).
- `sync`, `restore`: through definer `enqueue_write(p, kind, payload,
  client_uuid)`, which requires a UUID, stores the key as `<kind>:<uuid>`,
  sets `actor_id = auth.uid()`, checks
  `can(role, editActionForPath(path))` for every path, refuses server-only
  and harness paths, and refuses if the course is read-only.
- `courseop` (amended 2026-10-29, package-contract-v3 §13.3): through the
  definer `enqueue_courseop(p, op, args, op_uuid)`. It requires a UUID, stores
  the key as `courseop:<uuid>` and sets `actor_id = auth.uid()`. It checks
  `can(role, 'edit.course-files')`, or `license.change` for `setLicense`, and
  validates `op` against the closed list and `args` by shape. Priority 0.
  The committer re-checks the actor's right at execution and applies the
  operation to the head manifest.
- Blob-reference entries (package-contract-v3 §11.2) are accepted in `sync`
  rows only when the service-role upload route inserted them, after writing
  the `course_blobs` ledger. `enqueue_write` refuses a payload with blob
  entries, and the committer also checks the ledger.
- `changeset`: only from the agent hand-over endpoint (service role), which
  verifies the session token and sets `invoker_id` from it.
- `outside`: only from the GitHub webhook receiver / sweep (service role),
  after signature verification and re-fetch; `actor_id` null,
  `pusher_login` from the push event.
- `system`: only from Alembic itself (undo of forbidden content, Publish's
  drift bring-in, migration helper).

**Repeated keys.** A repeated insert returns the existing row only if its
kind **and** actor match; otherwise it is refused. System keys
(`public:<P>:<n>`, `undo:<head sha>`, `approve:<run>:<part>`) are generated
only by Alembic and live in the `system` kind, so no member can pre-claim
them.

### 2.3 Order and claiming

- **Strict per-course order.** The consumer always takes the course's
  non-terminal row first by `priority desc`, then by `seq`. If that row is `retry` with
  `next_attempt_at` in the future, the course waits (no overtaking). Head
  of line blocking is per course only.
- A row whose `depends_on` is not yet `done` is skipped **only** while its
  dependency is non-terminal; if the dependency ends `bounced`, `refused` or
  `failed`, the dependent ends `bounced` ("depends on a change that didn't
  land").

### 2.4 Statuses and errors

| Error | Handling |
|---|---|
| GitHub unavailable (5xx, timeouts, rate-limit 403/429) | `retry`, backoff 1 min → 15 min, no attempt limit; course bound §2.6 |
| Access revoked (401, 403 not rate-limit, 404 on the repo) | `retry` with "Reconnect GitHub" raised to the owner once; course bound §2.6 |
| Compare-and-swap lost (head moved) | re-decide immediately, up to 5 times per attempt, then `retry` |
| Deterministic refusal (validation, permission at execution, 422 other than CAS, too large) | `refused` (terminal) with a reason; the client keeps its text and shows it |
| Unexpected exception | `retry`; after **8 attempts** → `failed` (terminal), operator alerted, owner told, the row's text downloadable |

Terminal statuses: `done`, `bounced`, `refused`, `failed`. A terminal row
never blocks the course.

### 2.5 Re-check at execution

The consumer re-reads the actor's role (or the invoker's, for changesets)
when it processes a row and re-checks **every path** with that current role
(`canWritePath`); removed or banned, or a path no longer allowed (e.g. a
deputy term ended) → `refused`. `outside` and
`system` rows are not permission-checked (the push already happened or the
platform is acting), but **are** subject to §4.

### 2.6 The 14-day bound

If the course's oldest non-terminal row is older than 14 days: every
non-terminal row → `failed` with its text kept for download, the course
becomes read-only, and any waiting Publish job is cancelled with that reason.
Reconnecting reopens the course (failed rows stay failed; their text is
offered back to their authors).

## 3. The consumer and its lease

- `course_committer(package_id, holder, fence bigint, lease_until)`. A
  worker takes or renews the lease with a short transaction: `lease_until =
  now() + 60 s`, renewed every 10 s. Taking it over increments `fence`.
- **Per-row deadline 45 s**, with a GitHub retry budget of 10 s per call. A
  row not finished in time is abandoned and its attempt counted (`retry`).
- All database writes for a row are conditional on the holder's `fence`.
- **Before every compare-and-swap ref move**, and on taking over a lease,
  the consumer scans the **last 50 commits** of the working repo head for an
  `Alembic-Write: <row id>` trailer. Found → the row already landed; record
  the result from that commit, never commit again. (This closes the
  stale-holder double-commit: the second holder sees the first holder's
  commit before moving the ref.)

## 4. Forbidden content arriving through GitHub (Door C)

When the consumer (or the sweep) sees, at the working repo head `H`, any of:
- a symlink or submodule entry,
- a change under `.alembic/`, `.gitignore`, `private/sources/`,
  `private/coursewerk/`,
- an unclassifiable path,
- (amended 2026-10-29, package-contract-v3 §13.6) a pushed `alembic.json`
  that fails validity (schema, licence list, tree-aware rule), a change to
  its mechanics fields, or a licence change by a pusher who isn't the owner;
  edits to `LICENSE`, `CITATION.cff` or `private/README.md`; removals of a
  listed chapter's part files; an unsafe SVG or a blob whose bytes don't
  match its kind (§11.4),

it enqueues **one** `system` row with key `undo:<H>` and `priority = 1`
(processed before any other non-terminal row), which writes a forward commit
restoring those paths to their last Alembic-written state (deleting
additions). For `alembic.json` that is the last state that passed validity,
and the undo touches only the offending fields when the rest is valid. An
owner's valid licence change is kept, and `LICENSE`/`CITATION.cff` are
regenerated. An Edited elsewhere item names the pusher.

- **Never re-enqueued for the same head:** if the `undo:<H>` row ends other
  than `done`, Alembic raises an urgent owner/operator item instead of
  trying again, and Publish refuses with that reason (it does not wait).
- **403/404 on an undo row is deterministic** (`refused`), not an outage.
- **`.github/` is not undone.** The working repo is created with Actions
  disabled (quiet repos, design §12.3), so a workflow pushed there cannot
  run; `.github/` is never projectable, so it can never reach the public
  repo. A change there raises an informational item only. (This keeps the
  App without the Workflows permission.)
- **Force-pushes** on the working repo (branch protection is not available
  on free private repos): detected by the sweep when a recorded Alembic
  commit is no longer reachable from the head; a `system` row
  (`undo:<H>`) writes the last recorded tree forward again, and the pusher
  is named.

## 5. Publish as a job

`publish` job (pg-boss, `singletonKey = publish:<packageId>`):

1. **Authorise:** `publish.first` / `publish.later`, `publish.anyway` per
   chosen chapter, and **`approve.plan` for any `approveAndPublish` part**.
2. **Wait** until the course's write queue has no non-terminal row created
   before the job (the publisher's own syncs land first). If the course is
   read-only → cancel.
3. **Pin** W, check the tree (regular files, not truncated).
4. **Public drift:** read public head P.
   - P = recorded `public_sha` → continue.
   - Else scan up to 50 commits from P back to `public_sha` for an
     `Alembic-Publish-Run` trailer of a `pending` run; found → complete that
     run's record and treat the commits after it as the drift (if none,
     continue).
   - Drift remains → enqueue **one** `system` row (idem key
     `public:<P>:<n>`, `n` = attempt number for this P) bringing in all changed projectable unit files (never
     `alembic.json`, `.alembic/`, `.github/`, `.gitignore`,
     `provenance/coursewerk/`), each with base = its `published_files`
     version. Wait for that row to be terminal; then record P as
     acknowledged and stop with "the public copy was changed on GitHub —
     those changes were brought in; run Publish again".
   - If the row did not land (refused / failed): P is not acknowledged; the
     owner gets an item with two actions: **try again** (a new row,
     `n + 1`) or **discard the public changes** (they are offered for
     download, and P is acknowledged). Publish never loops silently.
5. Checks, decisions, assembly, link-check fixpoint: as `publisher-v3.md`
   §3 steps 6–9. **Orphan files** (slot paths or `chapters/<slug>/` for a
   slug not in the manifest at W and never published) belong to no unit and
   are never published.
6. `approveAndPublish` approvals are written as `system` queue rows (key
   `approve:<run>:<part>`, bound to the part's content hash at W). Publish
   **waits until they are terminal**; a part whose approval row is not
   `done` keeps its chapter kept (not published).
7. **Commit:** insert `publish_runs(…, status 'pending', intended tree)`;
   one commit to the public repo on parent P with compare-and-swap; every
   file through `assertPublishWritable(path, 'unit' | 'generated')`
   (package contract §7: the public-repo boundary AND, for unit files,
   `isProjectable`; for generated files, only `alembic.json`, `.alembic/`,
   `.gitignore`, `provenance/coursewerk/`, `.github/` — implemented and
   tested in `contract-v3.ts`);
   trailer `Alembic-Publish-Run: <id>`. CAS lost → back to step 4 (at most
   3 times, then the job fails with "the public copy keeps changing").
8. Record `committed`, `public_sha`, `published_files`.
9. Enqueue a **`site-build` job** for the course (pg-boss with a
   singleton key that keeps **one queued** job besides the running one).
   The job builds **the latest committed run of the course, read when the
   job starts** (never a fixed run id, never W), and just before moving
   `gh-pages` checks that no newer run was committed meanwhile; if one was,
   it builds that instead (bounded to 3 rounds). So a dropped duplicate job
   never leaves the site stale. A failed build leaves the previous site live
   and marks the run `site failed` with a retry action.
10. **A second Publish request** while one is queued or running is answered
    "Publish is already running" (never silently dropped). The Publish job's
    expiry is longer than its longest wait (2 h); waits re-check every 10 s.

## 6. Repositories and installations

- `packages.repo_installation_id`: the GitHub App installation on the
  account that **owns the repositories**. `clientForCourse` uses it.
- **Course creation** (working repo) and **first Publish** (public repo):
  repository creation uses that installation's token **without** repo scoping
  (creation needs it), only inside those two operations, then the new repo
  is recorded and every later token is scoped to the course's repos.
- **Transfer:** the design's resumable transfer moves the repos on GitHub
  first; `repo_installation_id` changes to the receiving account's
  installation only when both repos have moved; `transfer_owner` (member
  roles) happens in the same step. Until then the course is read-only.

## 7. Grants and RLS for the new tables

| Table | anon | authenticated (members of the course) | service role |
|---|---|---|---|
| `write_queue` | — | SELECT own course | all |
| `course_committer` | — | — | all |
| `publish_runs` | — | SELECT own course | all |
| `published_files` | — | SELECT own course | all |
| `sources` | — | SELECT own course, **excluding** `storage_key` (column grant) | all |
| `source_fingerprints` | — | — | all |
| `course_invitations` | — | — (only through definers) | all |
| `course_members` | — | SELECT own course | all |
| `typing` | — | INSERT/UPDATE own rows for own courses; SELECT own course | all |
| `approvals` | — | SELECT own course | all |
| `agent_sessions`, `session_events`, `agent_changesets`, `jobs` | — | SELECT own course (events: own course) | all |
| ledger tables (`ledger_accounts`, `credit_lots`, `holds`, `hold_lots`, `ledger_entries`, `credit_grants`, `cohort_members`) | — | SELECT own user account and its lots/entries; owner: the course allowance | all (through definers; entries append-only) |

## 8. Claims (bound to tests)

| Claim | What |
|---|---|
| Q.1 | members can't insert/update/delete `write_queue`; `enqueue_write` sets `actor_id = auth.uid()` and refuses forbidden paths |
| Q.2 | strict order: a `retry` row is never overtaken; terminal rows never block |
| Q.3 | deterministic errors end `refused`; unexpected ones `failed` after 8 attempts; outages retry |
| Q.4 | stale holder after takeover: the trailer scan prevents a second commit (real Postgres + fake GitHub with CAS) |
| Q.5 | forbidden content pushed on GitHub is undone by a front-of-line `system` row; Publish then proceeds |
| Q.6 | drift: one row keyed `public:<P>`; P acknowledged only after it lands; a pending run behind newer public commits is completed |
| Q.7 | `site-build` never moves `gh-pages` for a run that is no longer the latest |
| Q.8 | orphan chapter files are never published |
| Q.9 | `approveAndPublish` requires `approve.plan` |
| Q.10 | the 14-day bound fails rows with text kept, makes the course read-only, cancels Publish |
| Q.11 | repo creation tokens are used only in creation; all other tokens are repo-scoped |
| Q.12 | the column `sources.storage_key` is not readable by `authenticated` |

## 9. Review resolutions (G0 round 3)

| Finding | Resolution |
|---|---|
| H1 a refused drift row blocks Publish forever | §5 step 4: attempt-numbered key; owner chooses try again / discard (download) |
| H2 members can pre-claim idempotency keys | §2.1 unique `(package, kind, key)`; §2.2 prefixed UUID keys for members, system keys only in the `system` kind; repeats returned only to the same kind and actor |
| H3 undo row fails or loops; 'front of line' unbuildable | §2.1 `priority`; §4 one row per head, never re-enqueued, 403/404 deterministic, `.github/` ignored (Actions off) |
| H4 site builds dropped | §5 step 9 build the latest run at start; keep one queued |
| H5 publish guard undefined; approval rows | §5 steps 6–7; `assertPublishWritable` exists in `contract-v3.ts` with tests |
| L depends_on cross-course; job expiry; force-push | §2.1 check; §5 step 10; §4 force-push restore |

**Stop rule:** round 3 found only targeted HIGHs in one new spec, each with a
mechanical fix. These fixes are verified by the G2 closed loop (claims Q.1–Q.12
bound to tests) rather than a fourth spec round.
