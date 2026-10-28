/**
 * Ledger claim L.2, full form (ledger-v3 §7): over random sequences of every
 * operation, each account's balance equals its entries —
 *   grant + top-up + transfer-in + release + refund
 *   − hold − overrun − transfer-out − expiry − reversal.
 * (`capture` and `debt-paid` are informational: a capture is inside what the
 * hold already took, and paying debt moves nothing out of the balance.)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
const svc = <T,>(sql: string, p: unknown[] = []) => asRole(db, "service_role", () => db.query<T>(sql, p));
const one = async <T,>(sql: string, p: unknown[] = []) => (await svc<T>(sql, p)).rows[0]!;
async function tryIt(fn: () => Promise<unknown>) { try { await fn(); return true; } catch { return false; } }

const PLUS = ["grant", "top-up", "transfer-in", "release", "refund"];
const MINUS = ["hold", "overrun", "transfer-out", "expiry", "reversal"];

async function checkAll(context: string) {
  const { rows } = await svc<{ id: string; bal: string; plus: string; minus: string }>(`
    select a.id, public.ledger_balance(a.id) as bal,
           coalesce(sum(e.amount) filter (where e.kind = any ($1)), 0) as plus,
           coalesce(sum(e.amount) filter (where e.kind = any ($2)), 0) as minus
      from public.ledger_accounts a left join public.ledger_entries e on e.account_id = a.id
     group by a.id`, [PLUS, MINUS]);
  for (const r of rows) {
    const want = Math.round((Number(r.plus) - Number(r.minus)) * 1e4) / 1e4;
    const got = Math.round(Number(r.bal) * 1e4) / 1e4;
    if (got !== want) throw new Error(`${context}: account ${r.id} balance ${got} but entries say ${want}`);
  }
}

beforeAll(async () => { db = await freshDatabase(); }, 90_000);
afterAll(async () => { await db?.close(); });

describe("L.2 (full): every account's balance equals its entries, whatever happens", () => {
  it("random sequences over grants, top-ups, allowances, tasks, refunds, reversals, ended grants and month end", async () => {
    let seed = 20261027;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;
    for (let run = 0; run < 3; run++) {
      const op = await seedUser(db, `pop${run}`);
      await db.query(`update public.profiles set is_admin = true where id = $1`, [op]);
      const owner = await seedUser(db, `pown${run}`);
      const co = await seedUser(db, `pco${run}`);
      const pkg = await seedPackage(db, { owner });
      await db.query(`insert into public.course_members (package_id, user_id, role) values ($1, $2, 'co-author')`, [pkg, co]);
      const topups: string[] = [];
      const grants: string[] = [];
      let n = 0;
      const ownerAcc = (await one<{ a: string }>(`select public.ledger_user_account($1) as a`, [owner])).a;
      for (let step = 0; step < 40; step++) {
        const k = ++n;
        const what = pick(["grant", "grant", "topup", "topup", "fund", "task", "task", "alltask", "reverse", "endgrant", "monthend", "expire"]);
        switch (what) {
          case "grant": {
            const expires = rnd() < 0.5 ? null : new Date(Date.now() + 86_400_000).toISOString();
            const g = await one<{ g: string }>(`select public.ledger_grant($1, $2, $3, $4, 'p') as g`, [op, owner, 1 + Math.floor(rnd() * 30), expires]);
            if (g.g) grants.push(g.g);
            break;
          }
          case "topup": {
            const evt = `evt_${run}_${k}`;
            await svc(`select public.ledger_topup($1, $2, $3)`, [owner, 5 + Math.floor(rnd() * 50), evt]);
            topups.push(evt);
            break;
          }
          case "fund":
            await tryIt(() => svc(`select public.ledger_fund_allowance($1, $2, date_trunc('month', now())::date, $3, $4)`, [owner, pkg, 1 + Math.floor(rnd() * 20), `f${run}_${k}`]));
            break;
          case "task":
          case "alltask": {
            const acc = what === "task" ? ownerAcc
              : (await svc<{ id: string }>(`select id from public.ledger_accounts where kind = 'course-allowance' and package_id = $1 and month = date_trunc('month', now())::date`, [pkg])).rows[0]?.id;
            if (!acc) break;
            const actor = what === "task" ? owner : co;
            const j = (await one<{ id: string }>(`insert into public.ai_jobs (package_id, payer_account_id, invoker_id, kind) values ($1, $2, $3, $4) returning id`,
              [pkg, acc, actor, what === "task" ? "request" : "automatic"])).id;
            if (!(await tryIt(() => svc(`select public.ledger_hold($1, $2, $3)`, [actor, j, 1 + Math.floor(rnd() * 8)])))) break;
            for (let c = 0; c < 1 + Math.floor(rnd() * 3); c++) await svc(`select public.ledger_capture($1, $2, $3)`, [j, `c${c}`, Math.round(rnd() * 600) / 100]);
            if (rnd() < 0.3) await svc(`select public.ledger_refund($1, 'c0', 'fault')`, [j]);
            if (rnd() < 0.8) await svc(`select public.ledger_release($1)`, [j]);
            if (rnd() < 0.2) await svc(`select public.ledger_capture($1, 'late', 0.5)`, [j]); // late usage after release
            break;
          }
          case "reverse":
            if (topups.length) await svc(`select public.ledger_topup_reversed($1, $2, $3)`, [pick(topups), 1 + Math.floor(rnd() * 30), `rev_${run}_${k}`]);
            break;
          case "endgrant":
            if (grants.length) await svc(`select public.ledger_end_grant($1, $2)`, [op, grants.splice(Math.floor(rnd() * grants.length), 1)[0]]);
            break;
          case "expire":
            // Time passes for one dated grant; the hourly sweep records it.
            await db.query(`update public.credit_lots set expires_at = now() - interval '1 second'
                             where id = (select id from public.credit_lots where expires_at > now() and account_id = $1 limit 1)`, [ownerAcc]);
            await svc(`select public.ledger_expire_lots()`);
            break;
          case "monthend":
            // A month passes for this course's allowance, then the sweep runs.
            await db.query(`update public.ledger_accounts set month = (month - interval '1 month')::date where kind = 'course-allowance' and package_id = $1`, [pkg]);
            await svc(`select public.ledger_sweep_orphans()`);
            await svc(`select public.ledger_month_end()`);
            break;
        }
        await checkAll(`run ${run} step ${step} (${what})`);
      }
    }
    expect(true).toBe(true);
  }, 300_000);
});
