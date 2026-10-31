/** Gateway keys (migration 0050; C2). */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { mintGatewayKey } from "@alembic/package-ops";
import { asRole, freshDatabase, seedUser } from "./discovery-pglite";

let db: PGlite;
const sql = { query: <T,>(t: string, p?: unknown[]) => asRole(db, "service_role", () => db.query<T>(t, p)) };
const check = async (token: string) => (await sql.query<{ job_id: string; models: string[]; remaining: string }>(
  `select * from public.gateway_key_check($1)`, [createHash("sha256").update(token).digest("hex")])).rows[0];

beforeAll(async () => { db = await freshDatabase(); }, 90_000);
afterAll(async () => { await db?.close(); });

describe("gateway keys", () => {
  it("work while the job runs and its hold is open; stop on release, job end, revoke or expiry; only service role", async () => {
    const u = await seedUser(db, "gk");
    await sql.query(`select public.ledger_topup($1, 10, 'evt_gk')`, [u]);
    const acc = (await sql.query<{ a: string }>(`select public.ledger_user_account($1) as a`, [u])).rows[0]!.a;
    const job = async () => (await sql.query<{ id: string }>(`insert into public.ai_jobs (payer_account_id, invoker_id, kind) values ($1, $2, 'quick-ask') returning id`, [acc, u])).rows[0]!.id;
    const j1 = await job();
    const t1 = await mintGatewayKey(sql, j1, ["claude-haiku-5-5"]);
    expect(t1).toMatch(/^agk_[A-Za-z0-9_-]{40,}$/);
    expect(await check(t1)).toBeUndefined(); // no hold yet
    await sql.query(`select public.ledger_hold($1, $2, 2)`, [u, j1]);
    expect(await check(t1)).toMatchObject({ job_id: j1, models: ["claude-haiku-5-5"] });
    expect(Number((await check(t1))!.remaining)).toBeGreaterThanOrEqual(2);
    await sql.query(`select public.ledger_release($1)`, [j1]);
    expect(await check(t1)).toBeUndefined();

    const j2 = await job();
    await sql.query(`select public.ledger_hold($1, $2, 1)`, [u, j2]);
    const t2 = await mintGatewayKey(sql, j2, ["claude-haiku-5-5"]);
    expect(await check(t2)).toBeDefined();
    await sql.query(`select public.gateway_revoke_job($1)`, [j2]);
    expect(await check(t2)).toBeUndefined();
    const t3 = await mintGatewayKey(sql, j2, ["claude-haiku-5-5"]);
    await db.query(`update public.gateway_keys set expires_at = now() - interval '1 second' where key_hash = $1`, [createHash("sha256").update(t3).digest("hex")]);
    expect(await check(t3)).toBeUndefined();
    await db.query(`update public.ai_jobs set status = 'done' where id = $1`, [j2]);
    const t4 = await mintGatewayKey(sql, j2, ["claude-haiku-5-5"]);
    expect(await check(t4)).toBeUndefined();

    const asMember = async () => { try { await asRole(db, "authenticated", () => db.query(`select * from public.gateway_key_check('x')`), u); return "ok"; } catch { return "refused"; } };
    expect(await asMember()).toBe("refused");
  });
});
