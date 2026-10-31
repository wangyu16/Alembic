/** The agent runtime's records (migration 0069, agent-runtime-v3 §1, §15): server-only writes, members read, one live job. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let owner: string;
let stranger: string;
let pkg: string;
const svc = <T,>(sql: string, p: unknown[] = []) => asRole(db, "service_role", () => db.query<T>(sql, p));
async function attempt(fn: () => Promise<unknown>): Promise<"ok" | "refused"> { try { await fn(); return "ok"; } catch { return "refused"; } }
const job = (id: string, o: { status?: string; automatic?: boolean; payer?: string; cap?: string | null } = {}) =>
  svc(`insert into public.agent_jobs (id, session_id, package_id, invoker_id, automatic, payer, rights_cap, task, status, budget_credits)
       values ($1, 'as-aaaaaaaaaaaa', $2, $3, $4, $5, $6, 'Check chapter 6', $7, 5)`,
    [id, pkg, owner, o.automatic ?? false, o.payer ?? "invoker", o.cap ?? null, o.status ?? "running"]);

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "owner");
  stranger = await seedUser(db, "stranger");
  pkg = await seedPackage(db, { owner });
  await svc(`insert into public.agent_sessions (id, package_id) values ('as-aaaaaaaaaaaa', $1)`, [pkg]);
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("agent runtime records (0069)", () => {
  it("[K1.38] one session per course, at most one live job per session; automatic jobs are paid by the course and capped at co-author", async () => {
    expect(await attempt(() => svc(`insert into public.agent_sessions (id, package_id) values ('as-bbbbbbbbbbbb', $1)`, [pkg]))).toBe("refused");
    expect(await attempt(() => job("aj-000000000001"))).toBe("ok");
    expect(await attempt(() => job("aj-000000000002", { status: "starting" }))).toBe("refused");
    await svc(`update public.agent_jobs set status = 'done' where id = 'aj-000000000001'`);
    expect(await attempt(() => job("aj-000000000003", { automatic: true, payer: "invoker", cap: "co-author" }))).toBe("refused");
    expect(await attempt(() => job("aj-000000000004", { automatic: true, payer: "course", cap: null }))).toBe("refused");
    expect(await attempt(() => job("aj-000000000005", { automatic: true, payer: "course", cap: "co-author" }))).toBe("ok");
  });

  it("[K1.38] event kinds are a closed list and a payload is at most 64 KiB", async () => {
    expect(await attempt(() => svc(`insert into public.agent_session_events (session_id, kind, payload) values ('as-aaaaaaaaaaaa', 'approve', '{}')`))).toBe("refused");
    expect(await attempt(() => svc(`insert into public.agent_session_events (session_id, kind, payload) values ('as-aaaaaaaaaaaa', 'progress', jsonb_build_object('t', repeat('x', 70000)))`))).toBe("refused");
    expect(await attempt(() => svc(`insert into public.agent_session_events (session_id, kind, payload) values ('as-aaaaaaaaaaaa', 'progress', '{"t":"reading chapter 6"}')`))).toBe("ok");
  });

  it("[K1.38] members read their course's agent records; others read nothing; no API role writes", async () => {
    await svc(`insert into public.agent_changesets (id, package_id, job_id, invoker_id, status) values ('cs-00000001', $1, 'aj-000000000005', $2, 'queued')`, [pkg, owner]);
    for (const t of ["agent_sessions", "agent_jobs", "agent_session_events", "agent_changesets"]) {
      const mine = await asRole(db, "authenticated", () => db.query(`select 1 from public.${t}`), owner);
      const theirs = await asRole(db, "authenticated", () => db.query(`select 1 from public.${t}`), stranger);
      expect(mine.rows.length, t).toBeGreaterThan(0);
      expect(theirs.rows.length, t).toBe(0);
    }
    expect(await attempt(() => asRole(db, "authenticated", () => db.query(`insert into public.agent_session_events (session_id, kind) values ('as-aaaaaaaaaaaa', 'message')`), owner))).toBe("refused");
    expect(await attempt(() => asRole(db, "authenticated", () => db.query(`update public.agent_changesets set status = 'done'`), owner))).toBe("refused");
    expect(await attempt(() => asRole(db, "authenticated", () => db.query(`update public.agent_jobs set budget_credits = 1000`), owner))).toBe("refused");
    expect(await attempt(() => asRole(db, "anon", () => db.query(`select 1 from public.agent_jobs`)))).toBe("refused");
  });
});
