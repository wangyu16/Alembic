/** Workshop codes for try mode (migration 0059; C7, design §11.5). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedUser } from "./discovery-pglite";

let db: PGlite;
let op: string;
const svc = <T,>(sql: string, p: unknown[] = []) => asRole(db, "service_role", () => db.query<T>(sql, p));
async function attempt(fn: () => Promise<unknown>): Promise<string> { try { await fn(); return "ok"; } catch (e) { return (e as Error).message; } }
const h = (c: string) => c.repeat(64);
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const create = (code: string, amount: number, perBrowser = 2) =>
  svc<{ id: string }>(`select public.workshop_create($1, 'Campus workshop', $2, $3, $4::text::timestamptz, $5) as id`, [op, h(code), amount, inDays(2), perBrowser]);
const hx = (v: string) => (v.length === 64 ? v : h(v));
const start = (code: string, browser: string, network: string, estimate = 1) =>
  svc<{ j: string }>(`select public.try_start_workshop($1, $2, $3, $4) as j`, [h(code), hx(browser), h(network), estimate]);

beforeAll(async () => {
  db = await freshDatabase();
  op = await seedUser(db, "op");
  await db.query(`update public.profiles set is_admin = true where id = $1`, [op]);
}, 90_000);
afterAll(async () => { await db?.close(); });

describe("workshop codes", () => {
  it("only the operator creates, lists and ends codes; expiry is within 90 days", async () => {
    const someone = await seedUser(db, "someone");
    expect(await attempt(() => svc(`select public.workshop_create($1, 'x', $2, 10, $3::text::timestamptz)`, [someone, h("0"), inDays(1)]))).toMatch(/operator/);
    expect(await attempt(() => svc(`select public.workshop_create($1, 'x', $2, 10, $3::text::timestamptz)`, [op, h("0"), inDays(91)]))).toMatch(/90 days/);
    expect(await attempt(() => svc(`select * from public.workshop_list($1)`, [someone]))).toMatch(/operator/);
  });

  it("many browsers on one network can all run on a code (no network cap), each up to its own cap; the pool pays", async () => {
    const id = (await create("a", 100, 2)).rows[0]!.id;
    for (let b = 1; b < 25; b++) await start("a", b.toString(16).padStart(64, "0"), "1"); // 24 browsers, one network
    await start("a", "a", "1");
    expect(await attempt(() => start("a", "a", "1"))).toMatch(/^ok$/); // browser a: second run
    expect(await attempt(() => start("a", "a", "1"))).toMatch(/browser/); // third: over the cap of 2
    const { rows } = await svc<{ runs: string; remaining: string }>(`select runs, remaining from public.workshop_list($1) where id = $2`, [op, id]);
    expect(Number(rows[0]!.runs)).toBe(26);
    expect(Number(rows[0]!.remaining)).toBe(100 - 26); // held, not yet released
    // The public demo budget wasn't touched (there isn't one this month).
    expect((await svc(`select 1 from public.ledger_accounts where kind = 'demo-budget'`)).rows).toHaveLength(0);
  });

  it("a wrong, ended or expired code doesn't start anything; the credit runs out cleanly", async () => {
    expect(await attempt(() => start("f", "a", "2"))).toMatch(/isn't valid/);
    const id = (await create("b", 2)).rows[0]!.id;
    expect(await attempt(() => start("b", "a", "2", 5))).toMatch(/Not enough credit/);
    await svc(`select public.workshop_end($1, $2)`, [op, id]);
    expect(await attempt(() => start("b", "a", "2"))).toMatch(/isn't valid/);
    const id2 = (await create("c", 10)).rows[0]!.id;
    await db.query(`update public.workshop_codes set expires_at = now() - interval '1 minute' where id = $1`, [id2]);
    expect(await attempt(() => start("c", "a", "2"))).toMatch(/isn't valid/);
  });

  it("a workshop's pool pays only try mode", async () => {
    const id = (await create("d", 10)).rows[0]!.id;
    const acc = (await svc<{ a: string }>(`select account_id as a from public.workshop_codes where id = $1`, [id])).rows[0]!.a;
    const job = (await svc<{ j: string }>(`insert into public.ai_jobs (payer_account_id, kind) values ($1, 'request') returning id as j`, [acc])).rows[0]!.j;
    expect(await attempt(() => svc(`select public.ledger_hold(null, $1, 1)`, [job]))).toMatch(/only try mode/);
  });

  it("is service-role only", async () => {
    const u = await seedUser(db, "visitor");
    expect(await attempt(() => asRole(db, "anon", () => db.query(`select public.try_start_workshop($1, $2, $3, 1)`, [h("a"), h("q"), h("9")])))).not.toBe("ok");
    expect(await attempt(() => asRole(db, "authenticated", () => db.query(`select public.workshop_create($1, 'x', $2, 10, now() + interval '1 day')`, [u, h("e")]), u))).not.toBe("ok");
    expect(await attempt(() => asRole(db, "authenticated", () => db.query(`select * from public.workshop_codes`), u))).not.toBe("ok");
  });
});
