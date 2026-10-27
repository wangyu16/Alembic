/** Stripe top-ups in the ledger (migration 0044; ledger-v3 §3.2, L.12). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
const svc = <T,>(sql: string, p: unknown[] = []) => asRole(db, "service_role", () => db.query<T>(sql, p));
const bal = async (u: string) => Number((await svc<{ b: string }>(`select public.ledger_balance(public.ledger_user_account($1)) as b`, [u])).rows[0]!.b);
const debt = async (u: string) => Number((await svc<{ d: string }>(`select debt as d from public.ledger_accounts where kind = 'user' and user_id = $1`, [u])).rows[0]!.d);
async function attempt(fn: () => Promise<unknown>): Promise<"ok" | "refused"> { try { await fn(); return "ok"; } catch { return "refused"; } }
const created = (s: string, u: string, cents: number) => svc(`select public.ledger_checkout_created($1, $2, $3)`, [s, u, cents]);
const paid = (s: string, e: string, pi: string, cents: number, ref: string) =>
  svc(`select public.ledger_checkout_paid($1, $2, $3, $4, $5)`, [s, e, pi, cents, ref]);
let clock = 1_000;
/** Each event is newer than the last unless `at` says otherwise. */
const refunded = (pi: string, total: number, at = ++clock) => svc(`select public.ledger_payment_refunded($1, $2, $3)`, [pi, total, at]);
const dispute = (pi: string, id: string, cents: number, withdrawn: boolean, at = ++clock) =>
  svc(`select public.ledger_payment_dispute($1, $2, $3, $4, $5)`, [pi, id, cents, withdrawn, at]);
const setPrice = (usd: number) => db.query(`insert into public.credit_prices (usd_per_credit, valid_from) values ($1, now())`, [usd]);

beforeAll(async () => {
  db = await freshDatabase();
  await db.query(`insert into public.credit_prices (usd_per_credit, valid_from) values (0.01, now() - interval '1 day')`);
}, 90_000);
afterAll(async () => { await db?.close(); });

describe("Stripe top-ups", () => {
  it("credits the user recorded at checkout once per session, at the price of that moment", async () => {
    const u = await seedUser(db, "su");
    await created("cs_a", u, 1000);
    await setPrice(0.02); // the price changes after the checkout was made
    await paid("cs_a", "evt_a", "pi_a", 1000, u);
    await paid("cs_a", "evt_a2", "pi_a", 1000, u); // async_payment_succeeded after completed: once only
    expect(await bal(u)).toBe(1000);
    await setPrice(0.01);
  });

  it("refuses an unknown session, another user's reference, or a different amount", async () => {
    const u = await seedUser(db, "sv"); const other = await seedUser(db, "sw");
    await created("cs_b", u, 500);
    expect(await attempt(() => paid("cs_zz", "evt_b0", "pi_b", 500, u))).toBe("refused");
    expect(await attempt(() => paid("cs_b", "evt_b1", "pi_b", 500, other))).toBe("refused");
    expect(await attempt(() => paid("cs_b", "evt_b2", "pi_b", 100, u))).toBe("refused");
    expect(await bal(u)).toBe(0);
    expect(await bal(other)).toBe(0);
  });

  it("refunds follow Stripe's running total in any order; spent credit becomes debt", async () => {
    const u = await seedUser(db, "sx");
    await created("cs_c", u, 1000);
    await paid("cs_c", "evt_c", "pi_c", 1000, u);
    await refunded("pi_c", 200, 500);
    await refunded("pi_c", 300, 600);
    await refunded("pi_c", 300, 600); // replay
    await refunded("pi_c", 200, 500); // an older total delivered late: no effect
    expect(await bal(u)).toBe(700);
    await db.query(`update public.credit_lots set remaining = 100 where source = 'top-up:evt_c'`); // 600 spent
    await refunded("pi_c", 1000);
    expect(await bal(u)).toBe(-600);
  });

  it("a refund and a dispute on one payment both count (review H1)", async () => {
    const u = await seedUser(db, "sd");
    await created("cs_h1", u, 1000);
    await paid("cs_h1", "evt_h1", "pi_h1", 1000, u);
    await dispute("pi_h1", "dp_h1", 500, true);
    await refunded("pi_h1", 300);
    expect(await bal(u)).toBe(200);
  });

  it("a refund that failed (Stripe's total goes down) gives the credit back (round 2, L1)", async () => {
    const u = await seedUser(db, "sfail");
    await created("cs_l1", u, 1000);
    await paid("cs_l1", "evt_l1", "pi_l1", 1000, u);
    await refunded("pi_l1", 500);
    expect(await bal(u)).toBe(500);
    await refunded("pi_l1", 0);
    expect(await bal(u)).toBe(1000);
  });

  it("a refund that arrives before the payment is recorded is applied when it is (review H2)", async () => {
    const u = await seedUser(db, "se");
    await created("cs_h2", u, 1000);
    await refunded("pi_h2", 1000);
    await paid("cs_h2", "evt_h2", "pi_h2", 1000, u);
    expect(await bal(u)).toBe(0);
    expect(await debt(u)).toBe(0);
  });

  it("a won dispute gives the credit back, paying any debt first (review H3)", async () => {
    const u = await seedUser(db, "sf");
    await created("cs_h3", u, 1000);
    await paid("cs_h3", "evt_h3", "pi_h3", 1000, u);
    await db.query(`update public.credit_lots set remaining = 400 where source = 'top-up:evt_h3'`); // 600 spent
    await dispute("pi_h3", "dp_h3", 1000, true);
    expect(await debt(u)).toBe(600);
    await dispute("pi_h3", "dp_h3", 1000, true); // replay
    expect(await debt(u)).toBe(600);
    await dispute("pi_h3", "dp_h3", 1000, false); // won: funds reinstated
    expect(await debt(u)).toBe(0);
    expect(await bal(u)).toBe(400);
    // A late resend of the older "withdrawn" event changes nothing (round 2, M1).
    await dispute("pi_h3", "dp_h3", 1000, true, 1);
    expect(await bal(u)).toBe(400);
  });

  it("partial refunds at an awkward price leave no dust debt (review M1)", async () => {
    const u = await seedUser(db, "sg");
    await setPrice(0.07);
    await created("cs_m1", u, 500);
    await setPrice(0.01);
    await paid("cs_m1", "evt_m1", "pi_m1", 500, u);
    for (let t = 70; t < 500; t += 70) await refunded("pi_m1", t);
    await refunded("pi_m1", 500);
    expect(await bal(u)).toBe(0);
    expect(await debt(u)).toBe(0);
  });

  it("partial reversals take from an allowance only what that payment funded (review M2)", async () => {
    const owner = await seedUser(db, "sh");
    const pkg = await seedPackage(db, { owner });
    await created("cs_ma", owner, 3000); await paid("cs_ma", "evt_ma", "pi_ma", 3000, owner);
    await svc(`select public.ledger_fund_allowance($1, $2, date_trunc('month', now())::date, 3000, 'ma')`, [owner, pkg]);
    await created("cs_mb", owner, 7000); await paid("cs_mb", "evt_mb", "pi_mb", 7000, owner);
    await svc(`select public.ledger_fund_allowance($1, $2, date_trunc('month', now())::date, 7000, 'mb')`, [owner, pkg]);
    const allowance = async () => Number((await svc<{ r: string }>(`select coalesce(sum(l.remaining),0) as r from public.credit_lots l join public.ledger_accounts a on a.id = l.account_id where a.kind = 'course-allowance' and a.package_id = $1`, [pkg])).rows[0]!.r);
    expect(await allowance()).toBe(10000);
    await refunded("pi_ma", 2000);
    await refunded("pi_ma", 3000);
    expect(await allowance()).toBe(7000); // only A's 3000 came out
    expect(await debt(owner)).toBe(0);
    const entries = Number((await svc<{ n: string }>(`select count(*) as n from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id where a.kind = 'course-allowance' and a.package_id = $1 and e.kind = 'refund'`, [pkg])).rows[0]!.n);
    expect(entries).toBe(2); // the allowance's own entries record each reduction
  });

  it("members can't call the money functions; problems are kept", async () => {
    const u = await seedUser(db, "sy");
    const r = await attempt(() => asRole(db, "authenticated", () => db.query(`select public.ledger_checkout_created('cs_d', $1, 100)`, [u])));
    expect(r).toBe("refused");
    await svc(`select public.ledger_stripe_problem('evt_p', 'paid amount differs from the checkout')`);
    expect((await svc<{ n: string }>(`select count(*) as n from public.stripe_problems`)).rows[0]!.n).toBe(1);
  });
});
