/**
 * The agent orchestrator (C4 step 3b, hardened by the C4 attack round) on real Postgres (PGlite, every migration: the
 * ledger, holds, gateway keys) with a stand-in sandbox that records the scripts it is asked to run.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { courseUser, openForJob, orchestratorPass, sandboxKeyHash, type SandboxExec, type SqlClient } from "@alembic/package-ops";
import { freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let sql: SqlClient;
let owner: string, co: string, poor: string, gone: string, pkg: string, pkg2: string;
const KEY = { kid: "a1", secret: new Uint8Array(32).fill(5) };
const ran: string[] = [];
const outcome = new Map<string, string>(); // job → what the sandbox reports for it
const report = (code: string, result = "", err = "") => `BEGIN\n${code}\n---\n${result}\n---\n${err}\nEND\n`;
let failLaunch = false;
const stdins: string[] = [];
const throwFor = new Set<string>(); // jobs whose check makes the sandbox call throw
const sandbox: SandboxExec = {
  ref: "instabox:m_test",
  async exec({ cmd, stdin }) {
    ran.push(cmd);
    if (stdin !== undefined) stdins.push(stdin);
    const look = /\/jobs\/(aj-[a-z0-9]{12})\/exit\.code/.exec(cmd);
    if (look && throwFor.has(look[1]!)) throw new Error("instabox exec: 504 timeout");
    if (look) return { exitCode: 0, stdout: outcome.get(look[1]!) ?? report("running"), stderr: "" };
    if (cmd.includes("echo started") && failLaunch) return { exitCode: 1, stdout: "", stderr: "nft: something technical" };
    return { exitCode: 0, stdout: cmd.includes("echo started") ? "started\n" : "ok\n", stderr: "" };
  },
};
const cfg = (holder = "w1") => ({ sql, sandbox, keys: [KEY], host: "https://alembic-test.orz.how", models: ["claude-sonnet-5"], maxMinutes: 30, holder });
const job = (id: string, p: string, invoker: string, budget = 50) =>
  db.query(`insert into public.agent_jobs (id, session_id, package_id, invoker_id, payer, task, status, budget_credits)
            values ($1, (select id from public.agent_sessions where package_id = $2), $2, $3, 'invoker', '- check chapter 6', 'starting', $4)`, [id, p, invoker, budget]);
const row = async (id: string) => (await db.query<Record<string, unknown>>(`select * from public.agent_jobs where id = $1`, [id])).rows[0]!;
const hold = async (ai: unknown) => (await db.query<{ status: string; drawn: string }>(`select status, drawn from public.holds where job_id = $1`, [ai])).rows[0]!;
const age = (id: string, minutes: number) => db.query(`update public.agent_jobs set ended_at = now() - make_interval(mins => $2) where id = $1`, [id, minutes]);

beforeAll(async () => {
  db = await freshDatabase();
  sql = { query: async (text: string, params?: unknown[]) => ({ rows: (await db.query(text, params ?? [])).rows as never[] }) };
  owner = await seedUser(db, "owner");
  co = await seedUser(db, "co");
  poor = await seedUser(db, "poor");
  gone = await seedUser(db, "gone");
  pkg = await seedPackage(db, { owner });
  pkg2 = await seedPackage(db, { owner });
  await db.query(`update public.profiles set is_admin = true where id = $1`, [owner]);
  await db.query(`insert into public.course_members (package_id, user_id, role) values ($1, $2, 'co-author'), ($1, $3, 'co-author'), ($4, $2, 'co-author'), ($1, $5, 'co-author')`, [pkg, co, poor, pkg2, gone]);
  await db.query(`select public.ledger_grant($1, $2, 900, null, 'test')`, [owner, co]);
  await db.query(`select public.ledger_grant($1, $2, 900, null, 'test')`, [owner, gone]);
  await db.query(`insert into public.agent_sandboxes (ref, key_hash, max_jobs) values ('instabox:m_test', repeat('a', 64), 1)`);
  await db.query(`insert into public.agent_sessions (id, package_id) values ('as-aaaaaaaaaaaa', $1), ('as-bbbbbbbbbbbb', $2)`, [pkg, pkg2]);
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("the agent orchestrator (agent-runtime §16–§18, C4 attack round)", () => {
  it("[K1.43] a waiting job starts: its hold, a gateway key sealed for the server, the course's own user, the harness launched", async () => {
    await job("aj-000000000001", pkg, co);
    await db.query(`update public.agent_jobs set started_at = now() - interval '2 hours' where id = 'aj-000000000001'`); // it waited
    const r = await orchestratorPass(cfg());
    expect(r.started).toBe("aj-000000000001");
    const j = await row("aj-000000000001");
    expect(j["status"]).toBe("running");
    expect(j["course_user"]).toBe(courseUser(pkg));
    expect(Date.now() - new Date(String(j["started_at"])).getTime()).toBeLessThan(60_000); // the clock starts now (M1)
    const sealed = String(j["gateway_key_sealed"]);
    expect(sealed).not.toContain("agk_");
    expect(openForJob(sealed, "aj-000000000001", [KEY])).toMatch(/^agk_/);
    expect(String(j["job_secret_hash"])).toMatch(/^[0-9a-f]{64}$/);
    expect([Number((await hold(j["ai_job_id"])).drawn), (await hold(j["ai_job_id"])).status]).toEqual([50, "open"]);
    const launch = ran.find((c) => c.includes("echo started"))!;
    expect(launch).toContain(`sudo find /home/${courseUser(pkg)} -mindepth 1 -delete`); // a fresh home: nothing of an earlier job runs (round 2 H2), never through the user's links (H2)
    expect(launch).not.toMatch(/ALEMBIC_JOB_SECRET_VALUE=['"A-Za-z0-9]/); // the secret never in a command (round 2 H1)
    expect(stdins.at(-1)!.split("\n")[0]).toMatch(/^[A-Za-z0-9_-]{40,}$/); // it arrives on stdin, before the task
    expect(stdins.at(-1)).toContain("check chapter 6");
    expect(launch).toContain("cat > /home/" + courseUser(pkg) + "/.alembic-curl"); // the helper's headers from a 600 file
    expect(ran.some((c) => c.includes("hidepid=2"))).toBe(true); // users can't see each other's processes
    expect(launch).toContain(`sudo -u ${courseUser(pkg)} -H tee /home/${courseUser(pkg)}/jobs/aj-000000000001/task.txt`); // written as the user
    expect(launch).not.toContain("chown -R");
    expect(launch).toContain("< task.txt"); // the task on stdin, never a command line (H1, M2)
    expect(launch).not.toContain("check chapter 6");
    expect(ran.some((c) => c.includes("meta skuid $U counter drop") && c.includes("ip daddr { $NS } udp dport 53"))).toBe(true); // DNS only to the resolvers (M3)
    expect(ran.join("\n")).not.toMatch(/agk_[A-Za-z0-9_-]{20}/); // the gateway key never reaches the sandbox
  });

  it("[K1.43] the testing sandbox runs one job at a time, and one worker acts on it at a time", async () => {
    await job("aj-000000000002", pkg2, co);
    expect((await orchestratorPass(cfg())).started).toBeNull();
    expect((await row("aj-000000000002"))["status"]).toBe("starting");
    expect(await orchestratorPass(cfg("w2"))).toEqual({ started: null, finished: 0 }); // the lease is w1's (L1)
  });

  it("[K1.43] a check that didn't come back whole ends nothing", async () => {
    outcome.set("aj-000000000001", "0\n---\n");
    await orchestratorPass(cfg());
    expect((await row("aj-000000000001"))["status"]).toBe("running");
  });

  it("[K1.43] a finished job: its result is the hand-over note, the course user's processes end, the key is revoked; the hold settles after any call in flight", async () => {
    outcome.set("aj-000000000001", report("0", JSON.stringify({ result: "Added one sentence to Atoms.", is_error: false, num_turns: 9 })));
    const before = ran.length;
    const r = await orchestratorPass(cfg());
    expect(r.finished).toBe(1);
    const j = await row("aj-000000000001");
    expect([j["status"], j["summary"], j["gateway_key_sealed"], j["job_secret_hash"]]).toEqual(["done", "Added one sentence to Atoms.", null, null]);
    expect(ran.slice(before).some((c) => c.includes(`sudo -u ${courseUser(pkg)} /bin/bash -c 'kill -9 -1'`) && c.includes(`crontab -r -u ${courseUser(pkg)}`) && c.includes(`sudo find /home/${courseUser(pkg)} -mindepth 1 -delete`))).toBe(true); // H1
    const ai = String(j["ai_job_id"]);
    expect((await db.query(`select 1 from public.gateway_keys where job_id = $1 and revoked_at is null`, [ai])).rows).toHaveLength(0);
    expect((await hold(ai)).status).toBe("open"); // a call in flight may still be charged (M4)
    const note = (await db.query<{ payload: { result: string } }>(`select payload from public.agent_session_events where job_id = $1 and kind = 'handover-note'`, ["aj-000000000001"])).rows[0]!;
    expect(note.payload.result).toBe("Added one sentence to Atoms.");
    expect(r.started).toBe("aj-000000000002");
    await age("aj-000000000001", 12);
    await orchestratorPass(cfg());
    expect((await hold(ai)).status).toBe("released");
    expect((await row("aj-000000000001"))["settled_at"]).not.toBeNull();
  });

  it("[K1.43] a job past its time limit is stopped and failed, in plain words", async () => {
    await db.query(`update public.agent_jobs set started_at = now() - interval '2 hours' where id = 'aj-000000000002'`);
    await orchestratorPass(cfg());
    expect([(await row("aj-000000000002"))["status"], (await row("aj-000000000002"))["summary"]]).toEqual(["failed", "Stopped: the job ran past its time limit."]);
    expect(ran.some((c) => c.includes(`sudo -u ${courseUser(pkg2)} /bin/bash -c 'kill -9 -1'`))).toBe(true);
  });

  it("[K1.43] without enough credit a job fails to start, holding nothing; a start that fails says so plainly", async () => {
    await job("aj-000000000003", pkg, poor);
    await orchestratorPass(cfg());
    expect([(await row("aj-000000000003"))["status"], (await row("aj-000000000003"))["summary"]]).toEqual(["failed", "Not enough credit for this job."]);
    expect((await db.query<{ state: string }>(`select state from public.agent_sessions where package_id = $1`, [pkg])).rows[0]!.state).toBe("idle");
    failLaunch = true;
    await job("aj-000000000005", pkg, co);
    await orchestratorPass(cfg());
    failLaunch = false;
    const j = await row("aj-000000000005");
    expect(j["status"]).toBe("failed");
    expect(String(j["summary"])).not.toMatch(/nft|stderr|prepare|launch/); // no technical text for the teacher (L5)
  });

  it("[K1.43] a job a person stopped: its process is ended and its key revoked; its credit settles later", async () => {
    await job("aj-000000000004", pkg, co);
    await orchestratorPass(cfg());
    expect((await row("aj-000000000004"))["status"]).toBe("running");
    await db.query(`update public.agent_jobs set status = 'cancelled' where id = 'aj-000000000004'`);
    await orchestratorPass(cfg());
    const j = await row("aj-000000000004");
    expect([j["status"], j["summary"], j["gateway_key_sealed"], j["ended_at"] !== null]).toEqual(["cancelled", "Stopped by a person.", null, true]);
    await age("aj-000000000004", 12);
    await orchestratorPass(cfg());
    expect((await hold(j["ai_job_id"])).status).toBe("released");
  });

  it("[K1.43] a claim that never got started (a crash mid-start) is failed after five minutes and frees the sandbox", async () => {
    await job("aj-000000000006", pkg, co);
    await db.query(`update public.agent_jobs set status = 'running', started_at = now() - interval '6 minutes' where id = 'aj-000000000006'`);
    await db.query(`update public.agent_sessions set sandbox_ref = 'instabox:m_test' where package_id = $1`, [pkg]);
    await job("aj-000000000007", pkg2, co);
    const r = await orchestratorPass(cfg());
    expect((await row("aj-000000000006"))["status"]).toBe("failed");
    expect(r.started).toBe("aj-000000000007");
    outcome.set("aj-000000000007", report("0", JSON.stringify({ result: "ok", is_error: false })));
    await orchestratorPass(cfg());
  });

  it("[K1.43] the job of someone who is no longer an editor ends", async () => {
    await job("aj-000000000008", pkg, gone);
    await orchestratorPass(cfg());
    expect((await row("aj-000000000008"))["status"]).toBe("running");
    await db.query(`delete from public.course_members where package_id = $1 and user_id = $2`, [pkg, gone]);
    await orchestratorPass(cfg());
    expect([(await row("aj-000000000008"))["status"], (await row("aj-000000000008"))["summary"]]).toEqual(["cancelled", "Stopped: the person who asked can no longer edit this course."]);
  });

  it("[K1.42] the job's secret is stored only as a hash", async () => {
    const hashes = (await db.query<{ h: string | null }>(`select job_secret_hash as h from public.agent_jobs`)).rows.map((r) => r.h).filter(Boolean);
    for (const h of hashes) expect(ran.join("\n")).not.toContain(String(h));
    expect(sandboxKeyHash("x")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("[K1.43] a job whose files never read still ends at its time limit; one job's sandbox error doesn't stop the pass", async () => {
    await job("aj-000000000009", pkg, co);
    await orchestratorPass(cfg());
    expect((await row("aj-000000000009"))["status"]).toBe("running");
    throwFor.add("aj-000000000009");
    await orchestratorPass(cfg()); // the check throws: nothing else breaks
    expect((await row("aj-000000000009"))["status"]).toBe("running");
    await db.query(`update public.agent_jobs set started_at = now() - interval '2 hours' where id = 'aj-000000000009'`);
    await orchestratorPass(cfg());
    expect((await row("aj-000000000009"))["status"]).toBe("failed");
    throwFor.clear();
  });

  it("[K1.43] a claim whose session never got its sandbox is recovered; a paused course is never claimed", async () => {
    const p3 = await seedPackage(db, { owner });
    await db.query(`insert into public.course_members (package_id, user_id, role) values ($1, $2, 'co-author')`, [p3, co]);
    await db.query(`insert into public.agent_sessions (id, package_id) values ('as-cccccccccccc', $1)`, [p3]);
    await job("aj-00000000000a", p3, co);
    await db.query(`update public.agent_jobs set status = 'running', started_at = now() - interval '6 minutes' where id = 'aj-00000000000a'`);
    await orchestratorPass(cfg());
    expect((await row("aj-00000000000a"))["status"]).toBe("failed");
    await db.query(`update public.agent_sessions set state = 'paused:owner' where package_id = $1`, [p3]);
    await job("aj-00000000000b", p3, co);
    expect((await orchestratorPass(cfg())).started).toBeNull();
    expect((await row("aj-00000000000b"))["status"]).toBe("starting");
    expect((await db.query<{ state: string }>(`select state from public.agent_sessions where package_id = $1`, [p3])).rows[0]!.state).toBe("paused:owner");
  });

  it("[K1.43] the orchestrator needs this worker's own name for its lease", async () => {
    await expect(orchestratorPass({ ...cfg(), holder: undefined } as never)).rejects.toThrow(/holder/);
  });
});

