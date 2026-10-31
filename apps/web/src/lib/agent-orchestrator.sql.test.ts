/**
 * The agent orchestrator (C4 step 3b) on real Postgres (PGlite, every migration: the ledger, holds, gateway keys)
 * with a stand-in sandbox that records the scripts it is asked to run.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { courseUser, openForJob, orchestratorPass, type SandboxExec, type SqlClient } from "@alembic/package-ops";
import { freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let sql: SqlClient;
let owner: string, co: string, poor: string, pkg: string, pkg2: string;
const KEY = { kid: "a1", secret: new Uint8Array(32).fill(5) };
const ran: string[] = [];
const outcome = new Map<string, string>(); // job → what the sandbox reports for it
const sandbox: SandboxExec = {
  ref: "instabox:m_test",
  async exec({ cmd }) {
    ran.push(cmd);
    const look = /\/jobs\/(aj-[a-z0-9]{12})\/exit\.code/.exec(cmd);
    if (look) return { exitCode: 0, stdout: outcome.get(look[1]!) ?? "running\n---\n\n---\n", stderr: "" };
    return { exitCode: 0, stdout: cmd.includes("echo started") ? "started\n" : "ok\n", stderr: "" };
  },
};
const cfg = () => ({ sql, sandbox, keys: [KEY], host: "https://alembic-test.orz.how", models: ["claude-sonnet-5"], maxMinutes: 30 });
const job = (id: string, p: string, invoker: string, budget = 50) =>
  db.query(`insert into public.agent_jobs (id, session_id, package_id, invoker_id, payer, task, status, budget_credits)
            values ($1, (select id from public.agent_sessions where package_id = $2), $2, $3, 'invoker', 'Check chapter 6', 'starting', $4)`, [id, p, invoker, budget]);
const row = async (id: string) => (await db.query<Record<string, unknown>>(`select * from public.agent_jobs where id = $1`, [id])).rows[0]!;

beforeAll(async () => {
  db = await freshDatabase();
  sql = { query: async (text: string, params?: unknown[]) => ({ rows: (await db.query(text, params ?? [])).rows as never[] }) };
  owner = await seedUser(db, "owner");
  co = await seedUser(db, "co");
  poor = await seedUser(db, "poor");
  pkg = await seedPackage(db, { owner });
  pkg2 = await seedPackage(db, { owner });
  await db.query(`update public.profiles set is_admin = true where id = $1`, [owner]);
  await db.query(`insert into public.course_members (package_id, user_id, role) values ($1, $2, 'co-author'), ($1, $3, 'co-author'), ($4, $2, 'co-author')`, [pkg, co, poor, pkg2]);
  await db.query(`select public.ledger_grant($1, $2, 200, null, 'test')`, [owner, co]);
  await db.query(`insert into public.agent_sandboxes (ref, key_hash, max_jobs) values ('instabox:m_test', repeat('a', 64), 1)`);
  await db.query(`insert into public.agent_sessions (id, package_id) values ('as-aaaaaaaaaaaa', $1), ('as-bbbbbbbbbbbb', $2)`, [pkg, pkg2]);
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("the agent orchestrator (agent-runtime §16–§18)", () => {
  it("[K1.43] a waiting job starts: its hold, a gateway key sealed for the server, the course's own user, the harness launched", async () => {
    await job("aj-000000000001", pkg, co);
    const r = await orchestratorPass(cfg());
    expect(r.started).toBe("aj-000000000001");
    const j = await row("aj-000000000001");
    expect(j["status"]).toBe("running");
    expect(j["course_user"]).toBe(courseUser(pkg));
    const sealed = String(j["gateway_key_sealed"]);
    expect(sealed).not.toContain("agk_");
    expect(openForJob(sealed, "aj-000000000001", [KEY])).toMatch(/^agk_/);
    const hold = (await db.query<{ drawn: string; status: string }>(`select drawn, status from public.holds where job_id = $1`, [j["ai_job_id"]])).rows[0]!;
    expect([Number(hold.drawn), hold.status]).toEqual([50, "open"]);
    expect(ran.some((c) => c.includes(`useradd -m -s /bin/bash ${courseUser(pkg)}`) && c.includes("meta skuid $U counter drop"))).toBe(true);
    expect(ran.some((c) => c.includes("setsid nohup") && c.includes("aj-000000000001"))).toBe(true);
    expect(ran.join("\n")).not.toMatch(/agk_[A-Za-z0-9_-]{20}/); // the key never reaches the sandbox
  });

  it("[K1.43] the testing sandbox runs one job at a time: the next waits", async () => {
    await job("aj-000000000002", pkg2, co);
    expect((await orchestratorPass(cfg())).started).toBeNull();
    expect((await row("aj-000000000002"))["status"]).toBe("starting");
  });

  it("[K1.43] a finished job: its result is the hand-over note, the key is revoked, the hold released; the next job starts", async () => {
    outcome.set("aj-000000000001", `0\n---\n${JSON.stringify({ result: "Added one sentence to Atoms.", is_error: false, num_turns: 9 })}\n---\n`);
    const r = await orchestratorPass(cfg());
    expect(r.finished).toBe(1);
    const j = await row("aj-000000000001");
    expect([j["status"], j["summary"], j["gateway_key_sealed"]]).toEqual(["done", "Added one sentence to Atoms.", null]);
    const ai = String(j["ai_job_id"]);
    expect((await db.query<{ status: string }>(`select status from public.holds where job_id = $1`, [ai])).rows[0]!.status).toBe("released");
    expect((await db.query(`select 1 from public.gateway_keys where job_id = $1 and revoked_at is null`, [ai])).rows).toHaveLength(0);
    const note = (await db.query<{ payload: { result: string } }>(`select payload from public.agent_session_events where job_id = $1 and kind = 'handover-note'`, ["aj-000000000001"])).rows[0]!;
    expect(note.payload.result).toBe("Added one sentence to Atoms.");
    expect(r.started).toBe("aj-000000000002");
  });

  it("[K1.43] a job past its time limit is stopped and failed", async () => {
    await db.query(`update public.agent_jobs set started_at = now() - interval '2 hours' where id = 'aj-000000000002'`);
    await orchestratorPass(cfg());
    expect((await row("aj-000000000002"))["status"]).toBe("failed");
    expect(ran.some((c) => c.includes(`pkill -u ${courseUser(pkg2)}`))).toBe(true);
  });

  it("[K1.43] without enough credit a job fails to start, holding nothing; the session is free again", async () => {
    await job("aj-000000000003", pkg, poor);
    await orchestratorPass(cfg());
    const j = await row("aj-000000000003");
    expect([j["status"], j["summary"]]).toEqual(["failed", "Not enough credit for this job."]);
    expect((await db.query<{ state: string }>(`select state from public.agent_sessions where package_id = $1`, [pkg])).rows[0]!.state).toBe("idle");
  });

  it("[K1.43] a job a person stopped: its process is ended, its key revoked and its hold released", async () => {
    await job("aj-000000000004", pkg, co);
    await orchestratorPass(cfg());
    expect((await row("aj-000000000004"))["status"]).toBe("running");
    await db.query(`update public.agent_jobs set status = 'cancelled', summary = 'Stopped by a person.' where id = 'aj-000000000004'`);
    await orchestratorPass(cfg());
    const j = await row("aj-000000000004");
    expect([j["status"], j["gateway_key_sealed"], j["ended_at"] !== null]).toEqual(["cancelled", null, true]);
    expect((await db.query<{ status: string }>(`select status from public.holds where job_id = $1`, [j["ai_job_id"]])).rows[0]!.status).toBe("released");
    expect(ran.some((c) => c.includes(`pkill -u ${courseUser(pkg)}`))).toBe(true);
  });
});
