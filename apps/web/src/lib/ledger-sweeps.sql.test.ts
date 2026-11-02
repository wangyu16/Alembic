/** Ledger sweeps (migration 0045; ledger-v3 L.14, §9.7). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let op: string;
const svc = <T,>(sql: string, p: unknown[] = []) => asRole(db, "service_role", () => db.query<T>(sql, p));
const one = async <T,>(sql: string, p: unknown[] = []) => (await svc<T>(sql, p)).rows[0]!;
const bal = async (u: string) => Number((await one<{ b: string }>(`select public.ledger_balance(public.ledger_user_account($1)) as b`, [u])).b);
async function attempt(fn: () => Promise<unknown>): Promise<"ok" | "refused"> { try { await fn(); return "ok"; } catch { return "refused"; } }
async function job(payerAccount: string, invoker: string, kind: string, pkg: string | null) {
  return (await one<{ id: string }>(`insert into public.ai_jobs (package_id, payer_account_id, invoker_id, kind) values ($1, $2, $3, $4) returning id`, [pkg, payerAccount, invoker, kind])).id;
}
const userAcc = async (u: string) => (await one<{ a: string }>(`select public.ledger_user_account($1) as a`, [u])).a;
const holdStatus = async (j: string) => (await one<{ s: string }>(`select status as s from public.holds where job_id = $1`, [j])).s;
/** Move an allowance one month back, as if a month had passed. */
const ageAllowance = (pkg: string) =>
  db.query(`update public.ledger_accounts set month = (month - interval '1 month')::date where kind = 'course-allowance' and package_id = $1`, [pkg]);

beforeAll(async () => {
  db = await freshDatabase();
  op = await seedUser(db, "op");
  await db.query(`update public.profiles set is_admin = true where id = $1`, [op]);
}, 90_000);
afterAll(async () => { await db?.close(); });

describe("orphan sweep", () => {
  it("releases holds of ended jobs and of idle running jobs (cancelling them); paused and active jobs keep theirs", async () => {
    const u = await seedUser(db, "ou");
    await svc(`select public.ledger_grant($1, $2, 100, null, 'g')`, [op, u]);
    const acc = await userAcc(u);
    const ended = await job(acc, u, "request", null);
    const idle = await job(acc, u, "request", null);
    const paused = await job(acc, u, "request", null);
    const active = await job(acc, u, "request", null);
    for (const j of [ended, idle, paused, active]) await svc(`select public.ledger_hold($1, $2, 10)`, [u, j]);
    expect(await bal(u)).toBe(60);
    await db.query(`update public.ai_jobs set status = 'done' where id = $1`, [ended]);
    await db.query(`update public.ai_jobs set status = 'paused', created_at = now() - interval '3 hours' where id = $1`, [paused]);
    await db.query(`update public.ai_jobs set created_at = now() - interval '3 hours' where id in ($1, $2)`, [idle, paused]);
    // Back-date their entries (the append-only trigger is bypassed for this test setup only).
    await db.query(`alter table public.ledger_entries disable trigger ledger_entries_no_update`);
    await db.query(`update public.ledger_entries set created_at = now() - interval '2 hours' where job_id in ($1, $2)`, [idle, paused]);
    await db.query(`alter table public.ledger_entries enable trigger ledger_entries_no_update`);
    const n = (await one<{ n: number }>(`select public.ledger_sweep_orphans() as n`)).n;
    expect(n).toBe(2);
    expect(await holdStatus(ended)).toBe("released");
    expect(await holdStatus(idle)).toBe("released");
    expect(await holdStatus(paused)).toBe("open");
    expect(await holdStatus(active)).toBe("open");
    expect((await one<{ s: string }>(`select status as s from public.ai_jobs where id = $1`, [idle])).s).toBe("cancelled");
    expect(await bal(u)).toBe(80);
    expect((await one<{ n: number }>(`select public.ledger_sweep_orphans() as n`)).n).toBe(0); // idempotent
    // Usage the gateway reports later is still charged in full (L-3), as debt.
    await svc(`select public.ledger_capture($1, 'c1', 1)`, [idle]);
    expect(await bal(u)).toBe(79);
  });
});

describe("month end", () => {
  it("returns an ended month's allowance once; late credit on it goes to the owner; it can't be held or funded", async () => {
    const owner = await seedUser(db, "mo");
    const pkg = await seedPackage(db, { owner });
    await svc(`select public.ledger_topup($1, 100, 'evt_m1')`, [owner]);
    await svc(`select public.ledger_fund_allowance($1, $2, date_trunc('month', now())::date, 40, 'm1')`, [owner, pkg]);
    const allowance = (await one<{ id: string }>(`select id from public.ledger_accounts where kind = 'course-allowance' and package_id = $1`, [pkg])).id;
    const j = await job(allowance, owner, "automatic", pkg);
    await svc(`select public.ledger_hold($1, $2, 15)`, [owner, j]); // 15 drawn from the allowance
    expect(await bal(owner)).toBe(60);
    await ageAllowance(pkg);
    expect((await one<{ n: number }>(`select public.ledger_month_end() as n`)).n).toBe(1);
    expect(await bal(owner)).toBe(85); // the 25 not held came back
    expect((await one<{ n: number }>(`select public.ledger_month_end() as n`)).n).toBe(0);
    // The held 15 is released after the month ended: it lands on the old allowance, then goes to the owner.
    await svc(`select public.ledger_release($1)`, [j]);
    expect((await one<{ n: number }>(`select public.ledger_month_end() as n`)).n).toBe(1);
    expect(await bal(owner)).toBe(100);
    expect((await one<{ n: number }>(`select public.ledger_month_end() as n`)).n).toBe(0);
    // An ended month can't be held against or funded.
    const j2 = await job(allowance, owner, "automatic", pkg);
    expect(await attempt(() => svc(`select public.ledger_hold($1, $2, 1)`, [owner, j2]))).toBe("refused");
    expect(await attempt(() => svc(`select public.ledger_fund_allowance($1, $2, (date_trunc('month', now()) - interval '1 month')::date, 1, 'm2')`, [owner, pkg]))).toBe("refused");
  });
});

describe("expiry by date", () => {
  it("records granted credit that expired as an expiry entry, once; paid credit never expires", async () => {
    const u = await seedUser(db, "exu");
    await svc(`select public.ledger_grant($1, $2, 12, now() + interval '1 day', 'g')`, [op, u]);
    await svc(`select public.ledger_topup($1, 5, 'evt_ex1')`, [u]);
    await db.query(`update public.credit_lots set expires_at = now() - interval '1 minute' where credit_kind = 'granted' and account_id = public.ledger_user_account($1)`, [u]);
    expect(await bal(u)).toBe(5);
    expect((await one<{ n: number }>(`select public.ledger_expire_lots() as n`)).n).toBe(1);
    expect((await one<{ n: number }>(`select public.ledger_expire_lots() as n`)).n).toBe(0);
    const e = await one<{ s: string }>(`select coalesce(sum(amount), 0) as s from public.ledger_entries where kind = 'expiry' and account_id = public.ledger_user_account($1)`, [u]);
    expect(Number(e.s)).toBe(12);
    expect(await bal(u)).toBe(5);
  });
});
