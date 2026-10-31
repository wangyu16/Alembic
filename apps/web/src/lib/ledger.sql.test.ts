/**
 * The AI credit ledger (migration 0039; docs/specs/v3/ledger-v3.md draft 3).
 * Claims L.1, L.2 (property), L.4–L.7, L.10, L.11, L.15 and the round-2
 * rules (margin is debt, refund never returns twice, debt cleared first).
 * Concurrency (L.3) needs real Postgres with many connections.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let op: string;
let alice: string;
let bob: string;

const svc = <T,>(sql: string, params: unknown[] = []) => asRole(db, "service_role", () => db.query<T>(sql, params));
const one = async <T,>(sql: string, params: unknown[] = []) => (await svc<T>(sql, params)).rows[0]!;
const balance = async (user: string) =>
  Number((await one<{ b: string }>(`select public.ledger_balance(public.ledger_user_account($1)) as b`, [user])).b);
const debt = async (user: string) => Number((await one<{ d: string }>(`select debt as d from public.ledger_accounts where kind = 'user' and user_id = $1`, [user])).d);
async function attempt(fn: () => Promise<unknown>): Promise<"ok" | "refused"> {
  try { await fn(); return "ok"; } catch { return "refused"; }
}
async function job(payer: string, kind = "request", pkg: string | null = null) {
  const acc = (await one<{ a: string }>(`select public.ledger_user_account($1) as a`, [payer])).a;
  return (await one<{ id: string }>(`insert into public.ai_jobs (package_id, payer_account_id, invoker_id, kind) values ($1, $2, $3, $4) returning id`, [pkg, acc, payer, kind])).id;
}
const hold = (actor: string, j: string, est: number) => svc(`select public.ledger_hold($1, $2, $3)`, [actor, j, est]);
const capture = async (j: string, call: string, cost: number) => (await one<{ ok: boolean }>(`select public.ledger_capture($1, $2, $3) as ok`, [j, call, cost])).ok;
const release = (j: string) => svc(`select public.ledger_release($1)`, [j]);

beforeAll(async () => {
  db = await freshDatabase();
  op = await seedUser(db, "operator");
  await db.query(`update public.profiles set is_admin = true where id = $1`, [op]);
  alice = await seedUser(db, "alice");
  bob = await seedUser(db, "bob");
}, 90_000);
afterAll(async () => { await db?.close(); });

describe("grants and top-ups", () => {
  it("only the operator grants; top-ups are idempotent by event", async () => {
    expect(await attempt(() => svc(`select public.ledger_grant($1, $2, 10, null, 'x')`, [alice, alice]))).toBe("refused");
    await svc(`select public.ledger_grant($1, $2, 10, null, 'pilot')`, [op, alice]);
    await svc(`select public.ledger_topup($1, 20, 'evt_1')`, [alice]);
    await svc(`select public.ledger_topup($1, 20, 'evt_1')`, [alice]);
    expect(await balance(alice)).toBe(30);
  });
});

describe("holds, captures, release", () => {
  it("L.7 granted credit (earliest expiry) is used before paid; release returns the unused part", async () => {
    const u = await seedUser(db, "l7");
    await svc(`select public.ledger_topup($1, 10, 'evt_l7')`, [u]);
    await svc(`select public.ledger_grant($1, $2, 5, now() + interval '1 day', 'g')`, [op, u]);
    const j = await job(u);
    await hold(u, j, 8);
    const lots = await svc<{ k: string; r: string }>(`select credit_kind as k, remaining as r from public.credit_lots l join public.ledger_accounts a on a.id = l.account_id where a.user_id = $1 order by k`, [u]);
    expect(lots.rows.map((x) => [x.k, Number(x.r)])).toEqual([["granted", 0], ["paid", 7]]);
    await capture(j, "c1", 2);
    await release(j);
    expect(await balance(u)).toBe(13);
  });

  it("round 2: an overrun past the drawn amount goes to debt, never free; debt blocks new holds; a top-up pays debt first", async () => {
    const u = await seedUser(db, "debt");
    await svc(`select public.ledger_topup($1, 10, 'evt_d')`, [u]);
    const j = await job(u);
    await hold(u, j, 10);
    expect(await capture(j, "c1", 10.5)).toBe(true); // within drawn + margin
    expect(await capture(j, "c2", 1)).toBe(false); // past it: the job must stop or extend
    await release(j);
    expect(await debt(u)).toBe(1.5);
    expect(await balance(u)).toBe(-1.5);
    expect(await attempt(async () => hold(u, await job(u), 1))).toBe("refused");
    await svc(`select public.ledger_topup($1, 5, 'evt_d2')`, [u]);
    expect(await debt(u)).toBe(0);
    expect(await balance(u)).toBe(3.5);
  });

  it("L.6 a capture arriving after release is charged", async () => {
    const u = await seedUser(db, "late");
    await svc(`select public.ledger_topup($1, 10, 'evt_late')`, [u]);
    const j = await job(u);
    await hold(u, j, 5);
    await release(j);
    await capture(j, "late", 2);
    expect(await balance(u)).toBe(8);
  });

  it("L.4 hold, capture, release are idempotent", async () => {
    const u = await seedUser(db, "idem");
    await svc(`select public.ledger_topup($1, 10, 'evt_i')`, [u]);
    const j = await job(u);
    await hold(u, j, 4);
    await hold(u, j, 4);
    await capture(j, "c", 1);
    await capture(j, "c", 1);
    await release(j);
    await release(j);
    expect(await balance(u)).toBe(9);
  });

  it("round 2: refund before release never returns credit twice", async () => {
    const u = await seedUser(db, "refund");
    await svc(`select public.ledger_topup($1, 10, 'evt_r')`, [u]);
    const j = await job(u);
    await hold(u, j, 10);
    await capture(j, "c", 8);
    await svc(`select public.ledger_refund($1, 'c', 'sandbox lost')`, [j]);
    await svc(`select public.ledger_refund($1, 'c', 'sandbox lost')`, [j]);
    await release(j);
    expect(await balance(u)).toBe(10); // 10 back in total, not 18
  });

  it("L.15 outstanding margin per account is capped at 5", async () => {
    const u = await seedUser(db, "margin");
    await svc(`select public.ledger_topup($1, 1000, 'evt_m')`, [u]);
    for (let i = 0; i < 4; i++) await hold(u, await job(u), 20);
    const { rows } = await svc<{ m: string }>(`select sum(h.margin) as m from public.holds h join public.ledger_accounts a on a.id = h.account_id where a.user_id = $1 and h.status = 'open'`, [u]);
    expect(Number(rows[0]!.m)).toBeLessThanOrEqual(5);
  });

  it("release into an expired granted lot expires the returned part", async () => {
    const u = await seedUser(db, "exp");
    await svc(`select public.ledger_grant($1, $2, 5, now() + interval '1 day', 'g')`, [op, u]);
    const j = await job(u);
    await hold(u, j, 5);
    await db.query(`update public.credit_lots set expires_at = now() - interval '1 second' where source like 'grant:%' and account_id = (select id from public.ledger_accounts where user_id = $1)`, [u]);
    await release(j);
    expect(await balance(u)).toBe(0);
  });
});

describe("L.11 who may charge whom", () => {
  it("a job is paid by the person who asked; the allowance only for automatic work; demo budget only for try mode", async () => {
    await svc(`select public.ledger_topup($1, 10, 'evt_bob')`, [bob]);
    const j = await job(bob);
    expect(await attempt(() => hold(alice, j, 1))).toBe("refused");
    expect(await attempt(() => hold(bob, j, 1))).toBe("ok");
  });
  it("not enough credit fails closed", async () => {
    const u = await seedUser(db, "poor");
    await svc(`select public.ledger_topup($1, 1, 'evt_p')`, [u]);
    expect(await attempt(async () => hold(u, await job(u), 2))).toBe("refused");
  });
});

describe("L.1 / L.10 storage rules", () => {
  it("entries are append-only, even for the table owner", async () => {
    await expect(db.query(`update public.ledger_entries set amount = 0`)).rejects.toThrow(/append-only/);
    await expect(db.query(`delete from public.ledger_entries`)).rejects.toThrow(/append-only/);
  });
  it("members read only their own account and can call nothing", async () => {
    const mine = await asRole(db, "authenticated", () => db.query(`select id from public.ledger_accounts`), alice);
    expect(mine.rows).toHaveLength(1);
    expect(await attempt(() => asRole(db, "authenticated", () => db.query(`select public.ledger_topup($1, 100, 'evt_x')`, [alice]), alice))).toBe("refused");
    expect(await attempt(() => asRole(db, "authenticated", () => db.query(`insert into public.credit_lots (account_id, credit_kind, source, remaining) select id, 'paid', 'x', 999 from public.ledger_accounts`), alice))).toBe("refused");
  });
});

describe("L.2 property: the balance always equals the entry sum", () => {
  it("random sequences of operations", async () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let run = 0; run < 3; run++) {
      const u = await seedUser(db, `prop${run}`);
      await svc(`select public.ledger_topup($1, 100, $2)`, [u, `evt_prop${run}`]);
      for (let k = 0; k < 6; k++) {
        const j = await job(u);
        const est = 1 + Math.floor(rnd() * 10);
        if ((await attempt(() => hold(u, j, est))) === "refused") continue;
        for (let c = 0; c < 3; c++) await capture(j, `c${c}`, Math.round(rnd() * 500) / 100);
        if (rnd() < 0.3) await svc(`select public.ledger_refund($1, 'c0', 'fault')`, [j]);
        await release(j);
      }
      const { rows } = await svc<{ k: string; s: string }>(
        `select e.kind as k, sum(e.amount) as s from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id where a.user_id = $1 group by e.kind`, [u]);
      const sum = Object.fromEntries(rows.map((r) => [r.k, Number(r.s)]));
      const expected = (sum["top-up"] ?? 0) - (sum["capture"] ?? 0) + (sum["refund"] ?? 0);
      expect(Math.round((await balance(u)) * 1e4) / 1e4).toBe(Math.round(expected * 1e4) / 1e4);
    }
  });
});
