/** Ledger: cohorts, course allowance, top-up reversals (migration 0043; ledger-v3 §3.1–3.3, §9.4, §9.7). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let op: string;
const svc = <T,>(sql: string, p: unknown[] = []) => asRole(db, "service_role", () => db.query<T>(sql, p));
const bal = async (u: string) => Number((await svc<{ b: string }>(`select public.ledger_balance(public.ledger_user_account($1)) as b`, [u])).rows[0]!.b);
async function attempt(fn: () => Promise<unknown>): Promise<"ok" | "refused"> { try { await fn(); return "ok"; } catch { return "refused"; } }

beforeAll(async () => {
  db = await freshDatabase();
  op = await seedUser(db, "op");
  await db.query(`update public.profiles set is_admin = true where id = $1`, [op]);
}, 90_000);
afterAll(async () => { await db?.close(); });

describe("cohorts", () => {
  it("a per-member grant reaches members added before and after; once per person; none after the grant ends", async () => {
    const a = await seedUser(db, "ca"); const b = await seedUser(db, "cb"); const c = await seedUser(db, "cc");
    const cohort = (await svc<{ id: string }>(`insert into public.cohorts (name, created_by) values ('Workshop', $1) returning id`, [op])).rows[0]!.id;
    await svc(`select public.ledger_cohort_add($1, $2, $3)`, [op, cohort, a]);
    const g = (await svc<{ g: string }>(`select public.ledger_cohort_grant($1, $2, 10, null, 'workshop') as g`, [op, cohort])).rows[0]!.g;
    await svc(`select public.ledger_cohort_add($1, $2, $3)`, [op, cohort, b]);
    await svc(`delete from public.cohort_members where user_id = $1`, [b]);
    await svc(`select public.ledger_cohort_add($1, $2, $3)`, [op, cohort, b]); // rejoin: nothing more
    expect(await bal(a)).toBe(10);
    expect(await bal(b)).toBe(10);
    await svc(`select public.ledger_end_grant($1, $2)`, [op, g]);
    expect(await bal(a)).toBe(0);
    await svc(`select public.ledger_cohort_add($1, $2, $3)`, [op, cohort, c]);
    expect(await bal(c)).toBe(0);
    expect(await attempt(() => svc(`select public.ledger_cohort_add($1, $2, $3)`, [a, cohort, a]))).toBe("refused");
  });
});

describe("course allowance", () => {
  it("only the owner funds it, from paid credit only; unused credit returns at month end, once", async () => {
    const owner = await seedUser(db, "aown"); const co = await seedUser(db, "aco");
    const pkg = await seedPackage(db, { owner });
    await svc(`select public.ledger_grant($1, $2, 50, null, 'g')`, [op, owner]);
    await svc(`select public.ledger_topup($1, 20, 'evt_a1')`, [owner]);
    expect(await attempt(() => svc(`select public.ledger_fund_allowance($1, $2, date_trunc('month', now())::date, 30, 'f1')`, [owner, pkg]))).toBe("refused"); // only 20 paid
    expect(await attempt(() => svc(`select public.ledger_fund_allowance($1, $2, date_trunc('month', now())::date, 10, 'f0')`, [co, pkg]))).toBe("refused");
    await svc(`select public.ledger_fund_allowance($1, $2, date_trunc('month', now())::date, 15, 'f2')`, [owner, pkg]);
    await svc(`select public.ledger_fund_allowance($1, $2, date_trunc('month', now())::date, 15, 'f2')`, [owner, pkg]); // idempotent
    expect(await bal(owner)).toBe(55);
    await svc(`select public.ledger_allowance_return($1, date_trunc('month', now())::date)`, [pkg]);
    await svc(`select public.ledger_allowance_return($1, date_trunc('month', now())::date)`, [pkg]);
    expect(await bal(owner)).toBe(70);
  });

  it("a disputed top-up is taken back from the allowance it funded, then from the owner, then to debt; the allowance pauses", async () => {
    const owner = await seedUser(db, "down");
    const pkg = await seedPackage(db, { owner });
    await svc(`select public.ledger_topup($1, 100, 'evt_d1')`, [owner]);
    await svc(`select public.ledger_fund_allowance($1, $2, date_trunc('month', now())::date, 100, 'fd')`, [owner, pkg]);
    await svc(`select public.ledger_topup_reversed('evt_d1', 100, 'dispute_1')`);
    await svc(`select public.ledger_topup_reversed('evt_d1', 100, 'dispute_1')`); // idempotent
    const allowance = (await svc<{ r: string }>(`select coalesce(sum(l.remaining),0) as r from public.credit_lots l join public.ledger_accounts a on a.id = l.account_id where a.kind = 'course-allowance' and a.package_id = $1`, [pkg])).rows[0]!.r;
    expect(Number(allowance)).toBe(0);
    expect(await bal(owner)).toBe(0);
    // Both still hold credit: the allowance it funded goes first, then the top-up itself.
    const owner3 = await seedUser(db, "down3");
    const pkg3 = await seedPackage(db, { owner: owner3 });
    await svc(`select public.ledger_topup($1, 100, 'evt_d5')`, [owner3]);
    await svc(`select public.ledger_fund_allowance($1, $2, date_trunc('month', now())::date, 30, 'fd5')`, [owner3, pkg3]);
    await svc(`select public.ledger_topup_reversed('evt_d5', 50, 'dispute_5')`);
    const left3 = (await svc<{ r: string }>(`select coalesce(sum(remaining),0) as r from public.credit_lots where source = 'transfer:fd5'`)).rows[0]!.r;
    expect(Number(left3)).toBe(0);
    expect(await bal(owner3)).toBe(50);
    // If the allowance had already been spent, the rest is debt and the allowance pauses.
    const owner2 = await seedUser(db, "down2");
    const pkg2 = await seedPackage(db, { owner: owner2 });
    await svc(`select public.ledger_topup($1, 50, 'evt_d2')`, [owner2]);
    await svc(`select public.ledger_fund_allowance($1, $2, date_trunc('month', now())::date, 50, 'fd2')`, [owner2, pkg2]);
    await db.query(`update public.credit_lots set remaining = 0 where source = 'transfer:fd2'`); // spent by automatic work
    await svc(`select public.ledger_topup_reversed('evt_d2', 50, 'dispute_2')`);
    const debt = Number((await svc<{ d: string }>(`select debt as d from public.ledger_accounts where kind = 'user' and user_id = $1`, [owner2])).rows[0]!.d);
    expect(debt).toBe(50);
    await svc(`select public.ledger_topup($1, 10, 'evt_d3')`, [owner2]); // pays debt first
    expect(await bal(owner2)).toBe(-40);
    // Automatic work on that course can't be held against the allowance while the owner owes.
    expect(await attempt(() => svc(`select public.ledger_fund_allowance($1, $2, date_trunc('month', now())::date, 1, 'fd3')`, [owner2, pkg2]))).toBe("refused");
    const acc = (await svc<{ id: string }>(`select id from public.ledger_accounts where kind = 'course-allowance' and package_id = $1`, [pkg2])).rows[0]!.id;
    await db.query(`update public.credit_lots set remaining = 5 where source = 'transfer:fd2'`);
    const j = (await svc<{ id: string }>(`insert into public.ai_jobs (package_id, payer_account_id, invoker_id, kind) values ($1, $2, $3, 'automatic') returning id`, [pkg2, acc, owner2])).rows[0]!.id;
    expect(await attempt(() => svc(`select public.ledger_hold($1, $2, 1)`, [owner2, j]))).toBe("refused");
    await svc(`select public.ledger_topup($1, 40, 'evt_d4')`, [owner2]); // debt cleared
    expect(await attempt(() => svc(`select public.ledger_hold($1, $2, 1)`, [owner2, j]))).toBe("ok");
  });
});

describe("grants with a past expiry (security review 2026-10-27)", () => {
  it("are refused, for a person and for a group", async () => {
    const u = await seedUser(db, "pexp");
    expect(await attempt(() => svc(`select public.ledger_grant($1, $2, 5, now() - interval '1 day', 'old')`, [op, u]))).toBe("refused");
    const cohort = (await svc<{ id: string }>(`insert into public.cohorts (name, created_by) values ('Past', $1) returning id`, [op])).rows[0]!.id;
    expect(await attempt(() => svc(`select public.ledger_cohort_grant($1, $2, 5, now() - interval '1 day', 'old')`, [op, cohort]))).toBe("refused");
  });
});
