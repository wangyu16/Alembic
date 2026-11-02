/** Try mode's demo budget and caps (migration 0051; C7). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedUser } from "./discovery-pglite";

let db: PGlite;
let op: string;
const svc = <T,>(sql: string, p: unknown[] = []) => asRole(db, "service_role", () => db.query<T>(sql, p));
async function attempt(fn: () => Promise<unknown>): Promise<string> { try { await fn(); return "ok"; } catch (e) { return (e as Error).message; } }
const h = (c: string) => c.repeat(64);
const demoBalance = async () => Number((await svc<{ b: string }>(`select public.ledger_balance(id) as b from public.ledger_accounts where kind = 'demo-budget' and month = date_trunc('month', now())::date`)).rows[0]?.b ?? 0);

beforeAll(async () => {
  db = await freshDatabase();
  op = await seedUser(db, "op");
  await db.query(`update public.profiles set is_admin = true where id = $1`, [op]);
}, 90_000);
afterAll(async () => { await db?.close(); });

describe("try mode", () => {
  it("rests without a budget; the operator funds it; runs hold and release against it", async () => {
    expect(await attempt(() => svc(`select public.try_start($1, $2, 2)`, [h("a"), h("1")]))).toMatch(/resting/);
    const someone = await seedUser(db, "nobody");
    expect(await attempt(() => svc(`select public.ledger_demo_fund($1, now()::date, 10)`, [someone]))).toMatch(/operator/);
    await svc(`select public.ledger_demo_fund($1, now()::date, 10)`, [op]);
    expect(await demoBalance()).toBe(10);
    const job = (await svc<{ j: string }>(`select public.try_start($1, $2, 2) as j`, [h("a"), h("1")])).rows[0]!.j;
    expect(await demoBalance()).toBe(8);
    await svc(`select public.ledger_capture($1, 'msg_1', 0.5)`, [job]);
    await svc(`select public.try_finish($1)`, [job]);
    expect(await demoBalance()).toBe(9.5);
    expect((await svc<{ s: string }>(`select status as s from public.ai_jobs where id = $1`, [job])).rows[0]!.s).toBe("done");
  });

  it("caps runs per browser and per network per day, and stops when the month's budget is used up", async () => {
    for (let i = 0; i < 2; i++) await svc(`select public.try_start($1, $2, 1)`, [h("a"), h("2")]); // browser a already ran once
    expect(await attempt(() => svc(`select public.try_start($1, $2, 1)`, [h("a"), h("3")]))).toMatch(/browser/);
    expect(await attempt(() => svc(`select public.try_start($1, $2, 1, 3, 2)`, [h("b"), h("2")]))).toMatch(/network/);
    expect(await attempt(() => svc(`select public.try_start($1, $2, 50)`, [h("c"), h("4")]))).toMatch(/Not enough credit/);
  });

  it("is service-role only", async () => {
    const u = await seedUser(db, "visitor");
    expect(await attempt(() => asRole(db, "anon", () => db.query(`select public.try_start($1, $2, 1)`, [h("d"), h("5")])))).not.toBe("ok");
    expect(await attempt(() => asRole(db, "authenticated", () => db.query(`select public.try_start($1, $2, 1)`, [h("d"), h("5")]), u))).not.toBe("ok");
  });
});
