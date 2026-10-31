/**
 * C4 step 3a spike (TESTING ONLY): open an agent job by hand, as the orchestrator will, and hand its gateway key and
 * agent token to instabox as Secrets scoped to the testing host (stdin only: never printed, never on disk).
 *
 *   set -a; . ~/alembic-testing.env; set +a
 *   ALEMBIC_AGENT_KEYS=… npx tsx apps/web/scripts/c4-spike-start.ts <packageId> <invoker uuid> "<task>" [--grant-from <operator uuid>]
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { mintGatewayKey, signAgentToken, type SqlClient } from "@alembic/package-ops";

const [pkg, invoker, task] = process.argv.slice(2);
const grantFrom = process.argv.includes("--grant-from") ? process.argv[process.argv.indexOf("--grant-from") + 1] : undefined;
if (!pkg || !invoker || !task) { console.error("usage: c4-spike-start.ts <packageId> <invoker> <task> [--grant-from <operator>]"); process.exit(2); }
const url = process.env["DATABASE_URL_POOLER"] ?? "";
if (!url.includes("whbhiqnzknxnaxlulqga")) throw new Error("not the testing project");
const keys = (process.env["ALEMBIC_AGENT_KEYS"] ?? "").split(",")[0] ?? "";
const at = keys.indexOf(":");
if (at <= 0) throw new Error("ALEMBIC_AGENT_KEYS is not set");
const key = { kid: keys.slice(0, at), secret: new Uint8Array(Buffer.from(keys.slice(at + 1), "base64")) };
const HOST = "alembic-test.orz.how";
const id = (p: string) => `${p}-${randomBytes(9).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "0").slice(0, 12)}`;

function secret(name: string, value: string): void {
  const r = spawnSync("instabox", ["secrets", "set", name, "--host", HOST], { input: value, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`instabox secrets set ${name}: ${r.stderr.slice(0, 300)}`);
}

async function main(): Promise<void> {
  const sql = postgres(url, { ssl: "require", max: 1, prepare: false, onnotice: () => {} });
  const db: SqlClient = { query: async <T>(text: string, params: unknown[] = []) => ({ rows: (await sql.unsafe(text, params as never[])) as unknown as T[] }) };
  try {
    if (grantFrom) await db.query(`select public.ledger_grant($1, $2, 150, now() + interval '7 days', 'C4 spike (testing)')`, [grantFrom, invoker]);
    const acct = (await db.query<{ a: string }>(`select public.ledger_user_account($1)::text as a`, [invoker])).rows[0]!.a;
    let session = (await db.query<{ id: string }>(`select id from public.agent_sessions where package_id = $1`, [pkg])).rows[0]?.id;
    if (!session) {
      session = id("as");
      await db.query(`insert into public.agent_sessions (id, package_id, state, harness) values ($1, $2, 'running', 'claude-code')`, [session, pkg]);
    } else {
      await db.query(`update public.agent_sessions set state = 'running', updated_at = now() where id = $1`, [session]);
    }
    await db.query(`update public.agent_jobs set status = 'cancelled', ended_at = now() where session_id = $1 and status in ('starting','running')`, [session]);
    const aiJob = (await db.query<{ id: string }>(
      `insert into public.ai_jobs (package_id, payer_account_id, invoker_id, kind) values ($1, $2, $3, 'request') returning id::text`, [pkg, acct, invoker])).rows[0]!.id;
    await db.query(`select public.ledger_hold($1, $2, 120)`, [invoker, aiJob]);
    const job = id("aj");
    await db.query(
      `insert into public.agent_jobs (id, session_id, package_id, invoker_id, payer, task, status, budget_credits, ai_job_id, signing_kid)
       values ($1, $2, $3, $4, 'invoker', $5, 'running', 120, $6, $7)`, [job, session, pkg, invoker, task, aiJob, key.kid]);
    const gw = await mintGatewayKey(db, aiJob, ["claude-sonnet-5", "claude-haiku-4-5"], 60);
    secret("ALEMBIC_GW_KEY", gw);
    secret("ALEMBIC_AGENT_TOKEN", signAgentToken({ package_id: pkg, session_id: session, job_id: job, invoker_id: invoker }, key));
    console.log(JSON.stringify({ session, job, aiJob, secrets: ["ALEMBIC_GW_KEY", "ALEMBIC_AGENT_TOKEN"], host: HOST }));
  } finally {
    await sql.end();
  }
}
void main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
