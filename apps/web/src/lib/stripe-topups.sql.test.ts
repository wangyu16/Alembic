/** Stripe top-ups in the ledger (migration 0044; ledger-v3 §3.2, L.12). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedUser } from "./discovery-pglite";

let db: PGlite;
const svc = <T,>(sql: string, p: unknown[] = []) => asRole(db, "service_role", () => db.query<T>(sql, p));
const bal = async (u: string) => Number((await svc<{ b: string }>(`select public.ledger_balance(public.ledger_user_account($1)) as b`, [u])).rows[0]!.b);
async function attempt(fn: () => Promise<unknown>): Promise<"ok" | "refused"> { try { await fn(); return "ok"; } catch { return "refused"; } }
const paid = (s: string, e: string, pi: string, cents: number, ref: string) =>
  svc(`select public.ledger_checkout_paid($1, $2, $3, $4, $5)`, [s, e, pi, cents, ref]);
const reversed = (pi: string, e: string, total: number | null, add: number | null) =>
  svc(`select public.ledger_payment_reversed($1, $2, $3, $4)`, [pi, e, total, add]);

beforeAll(async () => {
  db = await freshDatabase();
  await db.query(`insert into public.credit_prices (usd_per_credit, valid_from) values (0.01, now() - interval '1 day')`);
}, 90_000);
afterAll(async () => { await db?.close(); });

describe("Stripe top-ups", () => {
  it("credits the user recorded at checkout once per session, at the price of that moment", async () => {
    const u = await seedUser(db, "su");
    await svc(`select public.ledger_checkout_created('cs_a', $1, 1000)`, [u]);
    await db.query(`insert into public.credit_prices (usd_per_credit, valid_from) values (0.02, now())`); // price changes later
    await paid("cs_a", "evt_a", "pi_a", 1000, u);
    await paid("cs_a", "evt_a2", "pi_a", 1000, u); // async_payment_succeeded after completed: once only
    expect(await bal(u)).toBe(1000);
  });

  it("refuses an unknown session, another user's reference, or a different amount", async () => {
    const u = await seedUser(db, "sv"); const other = await seedUser(db, "sw");
    await svc(`select public.ledger_checkout_created('cs_b', $1, 500)`, [u]);
    expect(await attempt(() => paid("cs_zz", "evt_b0", "pi_b", 500, u))).toBe("refused");
    expect(await attempt(() => paid("cs_b", "evt_b1", "pi_b", 500, other))).toBe("refused");
    expect(await attempt(() => paid("cs_b", "evt_b2", "pi_b", 100, u))).toBe("refused");
    expect(await bal(u)).toBe(0);
    expect(await bal(other)).toBe(0);
  });

  it("refunds take back only the new part of Stripe's running total; a dispute on top is capped; spent credit becomes debt", async () => {
    const u = await seedUser(db, "sx");
    await svc(`select public.ledger_checkout_created('cs_c', $1, 1000)`, [u]);
    await paid("cs_c", "evt_c", "pi_c", 1000, u);
    await reversed("pi_c", "evt_r1", 300, null);
    await reversed("pi_c", "evt_r1", 300, null); // replay
    await reversed("pi_c", "evt_r2", 300, null); // same total again, new event: nothing more
    expect(await bal(u)).toBe(350); // $10 at $0.02 = 500 credits; 30% back
    await db.query(`update public.credit_lots set remaining = 50 where source = 'top-up:evt_c'`); // 300 spent
    await reversed("pi_c", "evt_d1", null, 5000); // capped at the $7 not yet reversed = 350 credits
    expect(await bal(u)).toBe(-300);
    const c = (await svc<{ r: number }>(`select reversed_cents as r from public.stripe_checkouts where session_id = 'cs_c'`)).rows[0]!.r;
    expect(c).toBe(1000);
  });

  it("members can't call the money functions", async () => {
    const u = await seedUser(db, "sy");
    const r = await attempt(() => asRole(db, "authenticated", () => db.query(`select public.ledger_checkout_created('cs_d', $1, 100)`, [u])));
    expect(r).toBe("refused");
  });
});
