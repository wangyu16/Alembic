/**
 * The agent endpoints end to end on real Postgres (PGlite, every migration): the token and job checks, the
 * hand-in into the write queue, repeats, the question digest, proposals, appends and events (C4 step 2b).
 * The course repository is a stand-in; the committer's own checks are covered in package-ops (K1.34–K1.37).
 */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { sandboxKeyHash, sealForJob, signAgentToken, SqlQueueStore } from "@alembic/package-ops";
import { freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

vi.mock("server-only", () => ({}));
let db: PGlite;
vi.mock("@/lib/db", () => ({
  directDb: () => ({ query: async (text: string, params?: unknown[]) => ({ rows: (await db.query(text, params ?? [])).rows }) }),
}));
const files = new Map<string, string>();
vi.mock("@/lib/course-v3", () => ({
  courseRepo: async () => ({
    owner: "o", name: "r",
    repo: { head: async () => "f".repeat(40), readFile: async (_ref: string, p: string) => files.get(p) ?? null },
    client: { listTreeEntries: async () => ({ truncated: false, entries: [...files].map(([path, t]) => ({ path, mode: "100644", type: "blob", sha: "x", size: Buffer.byteLength(t) })) }), isAncestor: async (_coords: unknown, c: string) => c === "e".repeat(40), compareCommits: async () => [{ path: "study-guide/gases.md", status: "modified" }, { path: "private/sources/s1.json", status: "added" }] },
  }),
}));

const KEY = { kid: "t1", secret: new Uint8Array(32).fill(3) };
process.env["ALEMBIC_AGENT_KEYS"] = `t1:${Buffer.from(KEY.secret).toString("base64")}`;
const { agentAuth, handIn, changesetStatus, postEvent, catchUp, sandboxGatewayKey } = await import("./agent-endpoint");

const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
let owner: string, deputy: string, co: string, pkg: string;
const SESSION = "as-aaaaaaaaaaaa", JOB = "aj-aaaaaaaaaaaa";
const token = (o: Partial<{ job: string; invoker: string; key: typeof KEY }> = {}) =>
  signAgentToken({ package_id: pkg, session_id: SESSION, job_id: o.job ?? JOB, invoker_id: o.invoker ?? co }, o.key ?? KEY);
const req = (t: string | null) => new Request("https://x/api/agent/changesets", { headers: t ? { authorization: `Bearer ${t}` } : {} });
async function ctx(t = token()) {
  const a = await agentAuth(req(t));
  if (!a.ok) throw new Error(JSON.stringify(a.reply));
  return a.ctx;
}

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "owner");
  deputy = await seedUser(db, "dep");
  co = await seedUser(db, "co");
  pkg = await seedPackage(db, { owner });
  await db.query(`insert into public.course_members (package_id, user_id, role, deputy_until) values ($1, $2, 'co-author', now() + interval '30 days'), ($1, $3, 'co-author', null)`, [pkg, deputy, co]);
  await db.query(`insert into public.agent_sessions (id, package_id, state) values ($1, $2, 'running')`, [SESSION, pkg]);
  await db.query(`insert into public.agent_jobs (id, session_id, package_id, invoker_id, payer, task, status, budget_credits) values ($1, $2, $3, $4, 'invoker', 'Check chapter 6', 'running', 5)`, [JOB, SESSION, pkg, co]);
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("a sandbox acting for its running job (agent-runtime §18)", () => {
  const SB_KEY = "sbk_" + "x".repeat(40);
  const SECRET = "jsk_" + "s".repeat(40);
  const sreq = (key: string, job: string, secret = SECRET) => new Request("https://x/api/agent/file", { headers: { "x-alembic-sandbox": key, "x-alembic-job": job, "x-alembic-job-secret": secret } });
  it("[K1.42] the sandbox's key and a job running in that sandbox get in, and the AI call gets the job's own gateway key; anything else is refused", async () => {
    await db.query(`insert into public.agent_sandboxes (ref, key_hash) values ('instabox:m_test', $1) on conflict do nothing`, [sandboxKeyHash(SB_KEY)]);
    await db.query(`update public.agent_sessions set sandbox_ref = 'instabox:m_test', state = 'running' where id = $1`, [SESSION]);
    await db.query(`update public.agent_jobs set gateway_key_sealed = $2, job_secret_hash = $3 where id = $1`, [JOB, sealForJob("agk_job_key_value_0123456789abcdef", JOB, KEY), sandboxKeyHash(SECRET)]);
    const a = await agentAuth(sreq(SB_KEY, JOB));
    expect(a.ok && a.ctx.claims).toEqual({ package_id: pkg, session_id: SESSION, job_id: JOB, invoker_id: co });
    expect(await sandboxGatewayKey(sreq(SB_KEY, JOB))).toBe("agk_job_key_value_0123456789abcdef");
    expect((await agentAuth(sreq("sbk_" + "y".repeat(40), JOB))).ok).toBe(false); // another key
    expect((await agentAuth(sreq(SB_KEY, "aj-bbbbbbbbbbbb"))).ok).toBe(false); // a job that isn't running here
    // Knowing the job id is not enough: the job's own secret is needed (attack round H1).
    expect((await agentAuth(sreq(SB_KEY, JOB, "jsk_" + "t".repeat(40)))).ok).toBe(false);
    expect(await sandboxGatewayKey(sreq(SB_KEY, JOB, "jsk_" + "t".repeat(40)))).toBeNull();
    expect(await sandboxGatewayKey(sreq("sbk_" + "y".repeat(40), JOB))).toBeNull();
    await db.query(`update public.agent_sandboxes set retired_at = now() where ref = 'instabox:m_test'`);
    expect((await agentAuth(sreq(SB_KEY, JOB))).ok).toBe(false); // a retired sandbox
    await db.query(`update public.agent_sandboxes set retired_at = null where ref = 'instabox:m_test'`);
  });
});

describe("the agent endpoints (agent-runtime §2, §4, §14, §15)", () => {
  it("[K1.41] only the running job's own token gets in, for an asker who is still an editor", async () => {
    expect((await agentAuth(req(null))).ok).toBe(false);
    expect((await agentAuth(req("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln"))).ok).toBe(false); // a login-style token
    expect((await agentAuth(req(token({ key: { kid: "t1", secret: new Uint8Array(32).fill(4) } })))).ok).toBe(false);
    expect((await agentAuth(req(token({ invoker: owner })))).ok).toBe(false); // not this job's asker
    expect((await agentAuth(req(token({ job: "aj-bbbbbbbbbbbb" })))).ok).toBe(false); // no such job
    expect((await agentAuth(req(token()))).ok).toBe(true);
  });

  it("[K1.41] a hand-in is queued as a changeset for the asker; a repeat answers the same; another job can't reuse its id", async () => {
    const c = await ctx();
    const body = { changesetId: "cs-gases-001", files: [{ path: "study-guide/gases.md", baseVersion: sha("old"), text: "new" }] };
    expect(await handIn(c, body)).toMatchObject({ status: 202, body: { status: "queued" } });
    const q = await db.query<{ kind: string; invoker_id: string; actor_id: string | null; idem_key: string; payload: { files: unknown[] } }>(`select kind, invoker_id::text, actor_id, idem_key, payload from public.write_queue where package_id = $1`, [pkg]);
    expect(q.rows).toHaveLength(1);
    expect(q.rows[0]).toMatchObject({ kind: "changeset", invoker_id: co, actor_id: null });
    expect(await handIn(c, body)).toMatchObject({ status: 200, body: { status: "queued", repeat: true } });
    expect((await db.query(`select 1 from public.write_queue where package_id = $1`, [pkg])).rows).toHaveLength(1);
    expect(await changesetStatus(c, "cs-gases-001")).toMatchObject({ status: 200, body: { status: "queued" } });
    expect((await changesetStatus(c, "cs-unknown-01")).status).toBe(404);
  });

  it("[K1.41] the agent can't write what its asker couldn't; course operations become approve items for the leads (the licence: the owner only)", async () => {
    const c = await ctx();
    expect((await handIn(c, { changesetId: "cs-readme-01", files: [{ path: "README.md", baseVersion: sha("x"), text: "y" }] })).status).toBe(400);
    const r = await handIn(c, { changesetId: "cs-ops-0001", courseOps: [{ op: "renameChapter", slug: "gases", title: "Gas Laws" }, { op: "setLicense", license: "CC-BY-SA-4.0" }] });
    expect(r).toMatchObject({ status: 202, body: { status: "proposed" } });
    const items = await db.query<{ kind: string; addressed_to: string[]; dedupe_key: string }>(`select kind, addressed_to::text[] as addressed_to, dedupe_key from public.needs_you where package_id = $1 and dedupe_key like 'agent-op:%' order by dedupe_key`, [pkg]);
    expect(items.rows.map((i) => [i.kind, [...i.addressed_to].sort()])).toEqual([["approve", [owner, deputy].sort()], ["approve", [owner]]]);
  });

  it("[K1.41] one digest per asker: a new one replaces the unanswered questions; answers come back in catch-up", async () => {
    const c = await ctx();
    await handIn(c, { changesetId: "cs-digest-01", digest: { questions: [{ id: "q1", text: "Three significant figures?", choices: ["Yes", "No"], recommended: "Yes" }] } });
    await handIn(c, { changesetId: "cs-digest-02", digest: { questions: [{ id: "q1", text: "Define the rate-determining step as the slowest step?" }] } });
    const live = await db.query<{ dedupe_key: string; state: string; addressed_to: string[] }>(`select dedupe_key, state, addressed_to::text[] as addressed_to from public.needs_you where package_id = $1 and dedupe_key like 'digest:%' order by dedupe_key`, [pkg]);
    expect(live.rows.map((r) => [r.dedupe_key, r.state])).toEqual([["digest:cs-digest-01", "superseded"], ["digest:cs-digest-02", "waiting"]]);
    expect(live.rows[1]!.addressed_to).toEqual([co]);
    await db.query(`update public.needs_you set state = 'answered', answer = '{"q1":"Yes"}', answered_by = $2, answered_at = now() where dedupe_key = 'digest:cs-digest-02' and package_id = $1`, [pkg, co]);
    const up = await catchUp(c, "e".repeat(40));
    expect(up.body["answers"]).toEqual([expect.objectContaining({ changesetId: "cs-digest-02", answer: { q1: "Yes" } })]);
    expect(up.body["files"]).toEqual([{ path: "study-guide/gases.md", status: "modified" }]); // a source pointer is never listed
    expect((await catchUp(c, "d".repeat(40))).status).toBe(400); // not in the course's history
  });

  it("[K1.41] a log append lands on the version read; a stale one refuses the hand-in", async () => {
    const c = await ctx();
    files.set("private/coursewerk/LOG.jsonl", "{\"a\":1}\n");
    expect(await handIn(c, { changesetId: "cs-log-0001", appends: [{ path: "private/coursewerk/LOG.jsonl", baseVersion: sha("{\"a\":1}\n"), append: "{\"b\":2}" }] })).toMatchObject({ body: { status: "queued" } });
    const row = await db.query<{ payload: { files: Array<{ text: string }> } }>(`select payload from public.write_queue where idem_key = 'changeset:cs-log-0001'`);
    expect(row.rows[0]!.payload.files[0]!.text).toBe("{\"a\":1}\n{\"b\":2}\n");
    expect(await handIn(c, { changesetId: "cs-log-0002", appends: [{ path: "private/coursewerk/LOG.jsonl", baseVersion: sha("old"), append: "x" }] })).toMatchObject({ status: 409, body: { status: "refused" } });
  });

  it("[K1.41] events: no questions or approvals, at most 120 a minute; a paused session takes no hand-in", async () => {
    const c = await ctx();
    expect((await postEvent(c, { kind: "question", payload: {} })).status).toBe(400);
    expect((await postEvent(c, { kind: "progress", payload: { text: "Reading chapter 6" } })).status).toBe(201);
    await db.query(`insert into public.agent_session_events (session_id, kind) select $1, 'tool' from generate_series(1, 130)`, [SESSION]);
    expect((await postEvent(c, { kind: "progress", payload: {} })).status).toBe(429);
    await db.query(`update public.agent_sessions set state = 'paused:owner' where id = $1`, [SESSION]);
    expect(await handIn(await ctx(), { changesetId: "cs-paused-01", files: [{ path: "practice/x.md", baseVersion: null, text: "x" }] })).toMatchObject({ status: 409, body: { status: "refused" } });
  });
});

describe("the C4 attack round's budgets and re-checks (agent-runtime §14–§15)", () => {
  it("[K1.44] at run time an agent changeset is refused on a paused or read-only course; a read-only course takes no hand-in", async () => {
    const store = new SqlQueueStore({ query: async (text: string, params?: unknown[]) => ({ rows: (await db.query(text, params ?? [])).rows as never[] }) });
    const row = { id: "x", packageId: pkg, kind: "changeset" as const, actorId: null, invokerId: co, attempts: 1, payload: { files: [] } };
    await db.query(`update public.agent_sessions set state = 'running' where id = $1`, [SESSION]);
    expect(await store.changesetBlocked(row)).toBeNull();
    await db.query(`update public.agent_sessions set state = 'paused:owner' where id = $1`, [SESSION]);
    expect(await store.changesetBlocked(row)).toBe("the assistant is paused for this course");
    await db.query(`update public.agent_sessions set state = 'running' where id = $1`, [SESSION]);
    await db.query(`update public.packages set archived_at = now() where id = $1`, [pkg]);
    expect(await store.changesetBlocked(row)).toBe("the course is read-only");
    expect(await handIn(await ctx(), { changesetId: "cs-archived-1", files: [{ path: "practice/a.md", baseVersion: null, text: "a" }] })).toMatchObject({ status: 409, body: { reason: "the course is read-only" } });
    await db.query(`update public.packages set archived_at = null where id = $1`, [pkg]);
  });

  it("[K1.44] proposals waiting for the owner are capped per job; another job's hand-ins can't be named as a dependency", async () => {
    const c = await ctx();
    const ops = (n: number) => Array.from({ length: n }, (_, k) => ({ op: "renameChapter", slug: "gases", title: `Gas ${k}` }));
    expect((await handIn(c, { changesetId: "cs-props-01", courseOps: ops(10) })).status).toBe(202);
    expect(await handIn(c, { changesetId: "cs-props-02", courseOps: ops(10) })).toMatchObject({ status: 409, body: { status: "refused" } }); // 1 + 10 + 10 > 20 open
    await db.query(`insert into public.agent_jobs (id, session_id, package_id, invoker_id, payer, task, status, budget_credits) values ('aj-otherjob0001', $1, $2, $3, 'invoker', 't', 'done', 5)`, [SESSION, pkg, co]);
    await db.query(`insert into public.agent_changesets (id, package_id, job_id, invoker_id, status) values ('cs-other-job1', $1, 'aj-otherjob0001', $2, 'done')`, [pkg, co]);
    const r = await handIn(c, { changesetId: "cs-dep-00001", dependsOn: "cs-other-job1", files: [{ path: "practice/b.md", baseVersion: null, text: "b" }] });
    expect(r.body["reason"]).toBe("hand in the change this one depends on first"); // the same answer as for an unknown id
  });

  it("[K1.44] public records stay within 1 MB in all", async () => {
    const c = await ctx();
    files.set("provenance/coursewerk/ATTRIBUTION.md", "x".repeat(900_000));
    expect(await handIn(c, { changesetId: "cs-pubrec-01", files: [{ path: "provenance/coursewerk/CHECKED.json", baseVersion: null, text: "y".repeat(200_000) }] }))
      .toMatchObject({ status: 409, body: { reason: "the public records would be larger than 1 MB in all" } });
    files.delete("provenance/coursewerk/ATTRIBUTION.md");
  });

  it("[K1.44] a sandbox with more jobs running than it may hold acts for none of them", async () => {
    const SB = "sbk_" + "z".repeat(40), SECRET = "jsk_" + "q".repeat(40);
    await db.query(`insert into public.agent_sandboxes (ref, key_hash, max_jobs) values ('instabox:m_two', $1, 1)`, [sandboxKeyHash(SB)]);
    const p2 = await seedPackage(db, { owner });
    await db.query(`insert into public.course_members (package_id, user_id, role) values ($1, $2, 'co-author')`, [p2, co]);
    await db.query(`insert into public.agent_sessions (id, package_id, state, sandbox_ref) values ('as-twotwotwotwo', $1, 'running', 'instabox:m_two')`, [p2]);
    await db.query(`insert into public.agent_jobs (id, session_id, package_id, invoker_id, payer, task, status, budget_credits, job_secret_hash) values ('aj-twotwotwo001', 'as-twotwotwotwo', $1, $2, 'invoker', 't', 'running', 5, $3)`, [p2, co, sandboxKeyHash(SECRET)]);
    const sreq = new Request("https://x/api/agent/file", { headers: { "x-alembic-sandbox": SB, "x-alembic-job": "aj-twotwotwo001", "x-alembic-job-secret": SECRET } });
    expect((await agentAuth(sreq)).ok).toBe(true);
    const p3 = await seedPackage(db, { owner });
    await db.query(`insert into public.agent_sessions (id, package_id, state, sandbox_ref) values ('as-threethreeth', $1, 'running', 'instabox:m_two')`, [p3]);
    await db.query(`insert into public.agent_jobs (id, session_id, package_id, invoker_id, payer, task, status, budget_credits) values ('aj-threethree01', 'as-threethreeth', $1, $2, 'invoker', 't', 'running', 5)`, [p3, owner]);
    expect((await agentAuth(sreq)).ok).toBe(false);
  });
});

