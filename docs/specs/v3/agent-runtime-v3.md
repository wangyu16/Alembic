# Agent runtime (sessions, hand-over, catch-up, deferral) — mini-spec

**Status:** draft for gate G7, 2026-10-27. Module C4 (with C3 sandbox
provider, C5 harness adapter). Design source: `ALEMBIC-WORKSPACE-DESIGN.md`
§5; FC-16 v1 draft Part A; write-path and queue specs (the hand-over is a
`changeset` queue row).

## 1. Pieces

| Piece | Where | What |
|---|---|---|
| **Session** | `agent_sessions(id, package_id, state, sandbox_ref, harness_version, created_at, last_event_seq)` | one per course; state reasons as a set (§4) |
| **Event log** | `session_events(session_id, seq, kind, payload, at)`, unique `(session_id, seq)` | messages, tool actions, hand-overs, questions; 90-day retention |
| **Job** | `jobs` (ledger spec §3) | one running session job at a time; quick asks beside it |
| **Sandbox** | SandboxProvider (C3): instabox in testing, Fly Machines in production | holds the working copy; egress only to the gateway and fetch proxy |
| **Harness** | C5 adapter | runs the official agent with the Coursewerk harness; minimal scripted harness for tests |

## 2. Authentication

- The sandbox gets a **session token**: a server-signed JWT with
  `{package_id, session_id, job_id, invoker_id, exp ≤ 1 h}`, renewed by the
  orchestrator. Every agent endpoint verifies it. The role used for checks
  is the invoker's, read at execution (permissions §3, `canAgent`).
- The AI key is a per-job gateway key, delivered as an instabox Secret
  (testing) or through the sandbox's sidecar (production, O13). The agent
  sees only a placeholder.

## 3. Endpoints (Vercel; service role behind token checks)

`POST /api/agent/changesets` (FC-16 A.3):
- Body: `{changesetId, summary, dependsOn?, files[], logEntries[]}`.
- Steps:
  1. Validate the token, then each path with
     `canWritePath('agent', path, {invoker})` (harness records allowed).
  2. If any file is being edited (`typing` < 2 min), store the changeset in
     `pending_changes` and answer `deferred`.
  3. Otherwise `queue_insert(kind 'changeset', idem = changesetId, invoker,
     depends_on)` and answer `queued`.
- The final per-file outcomes arrive at the next catch-up, or through
  `GET /api/agent/changesets/:id`.

`GET /api/agent/changes?since=<path→version>`: returns the changed files
(working repo head plus non-terminal queue rows), including
`private/coursewerk/` and the current log head, each with actor and door.

`POST /api/agent/events`: appends events (with the token's session);
questions become Needs-you items (A10).

## 4. Deferral and pending changes

- **Periodic job:** every 30 s, the orchestrator re-offers pending
  changesets whose files are no longer being edited, in creation order.
- **Ordering:** a changeset with `dependsOn` on a pending one stays pending
  until its dependency is queued.
- **Time bound:** after 30 minutes pending, a changeset is queued anyway.
  The typist's text stays on top where both changed the same paragraph:
  the row is processed with `fromOpenEditor = false`, and the person's
  later sync from their open editor puts their text on top.
- **Sandbox loss:** pending changesets live in the database, so they
  survive the sandbox; the rebuilt sandbox's catch-up returns them as
  "pending", part of the agent's base.

## 5. Session state

`state` is a set of reasons, not a single value. Possible reasons:
- `working` (a job is running);
- `waiting` (an open question);
- `paused:owner`;
- `paused:handout`;
- `paused:github` (the course's oldest queue row is older than 10 min);
- `unavailable` (the provider or gateway is down).

`resting` is the empty set. The UI shows the most important reason first.

## 6. Claims

| Claim | What |
|---|---|
| R.1 | a request without a valid session token, or with a token for another course, is refused |
| R.2 | the agent can't write any path its invoker couldn't (A2.9, end to end through the endpoint) |
| R.3 | hand-over is idempotent by changesetId (replay → same row) |
| R.4 | a changeset touching a file being edited is deferred, stored in the database, re-offered after the editor goes idle, and queued after 30 min at the latest |
| R.5 | dependsOn order holds across deferral |
| R.6 | catch-up returns the queue's non-terminal rows and the records, so the agent never builds on a change it believes landed |
| R.7 | a sandbox that can reach anything other than the gateway and the fetch proxy fails the egress test (C3, run against the provider) |
| R.8 | removing the invoker cancels their jobs and refuses their queued changesets (A2.8) |
