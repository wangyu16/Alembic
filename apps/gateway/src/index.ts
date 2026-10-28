/**
 * The gateway service. Env: DATABASE_URL (service SQL), ANTHROPIC_API_KEY
 * (master key, held only here), PORT (default 4100). Listens on all
 * interfaces inside its container; publish it only where callers live.
 */
import { createServer } from "node:http";
import { Readable } from "node:stream";
import postgres from "postgres";
import { handleMessages, type GatewayDeps } from "./gateway";

const db = process.env["DATABASE_URL"];
const master = process.env["ANTHROPIC_API_KEY"];
if (!db || !master) {
  console.error("[alembic-gateway] DATABASE_URL and ANTHROPIC_API_KEY are required");
  process.exit(1);
}
const sql = postgres(db, { ssl: "require", max: 4, idle_timeout: 30, prepare: false, onnotice: () => {} });

const deps: GatewayDeps = {
  async checkKey(hash) {
    const rows = await sql.unsafe(`select job_id, models, remaining from public.gateway_key_check($1)`, [hash]);
    const r = rows[0];
    return r ? { jobId: r["job_id"] as string, models: r["models"] as string[], remaining: Number(r["remaining"]) } : null;
  },
  async recordUsage(jobId, callId, model, usage, usd, credits) {
    const rows = await sql.unsafe(
      `insert into public.gateway_usage (job_id, call_id, model, usage, usd, credits) values ($1, $2, $3, $4::text::jsonb, $5, $6)
       on conflict do nothing returning 1`, [jobId, callId, model, JSON.stringify(usage), usd, credits]);
    return rows.length > 0;
  },
  async capture(jobId, callId, credits) {
    await sql.unsafe(`select public.ledger_capture($1, $2, $3)`, [jobId, callId, credits]);
    await sql.unsafe(`update public.gateway_usage set captured = true where job_id = $1 and call_id = $2`, [jobId, callId]);
  },
  async usdPerCredit() {
    const rows = await sql.unsafe(`select usd_per_credit from public.credit_prices where valid_from <= now() order by valid_from desc, version desc limit 1`);
    const v = Number(rows[0]?.["usd_per_credit"]);
    if (!(v > 0)) throw new Error("no credit price is set");
    return v;
  },
  upstream: (body, headers, signal) =>
    fetch("https://api.anthropic.com/v1/messages", { method: "POST", body, headers: { ...headers, "x-api-key": master }, ...(signal ? { signal } : {}) }),
  log: (m) => console.log(`[alembic-gateway] ${m}`),
};

const port = Number(process.env["PORT"] ?? 4100);
createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") { res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}'); return; }
    const path = (req.url ?? "").split("?")[0];
    if (req.method !== "POST" || path !== "/v1/messages") { res.writeHead(404).end(); return; }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const request = new Request("http://gateway/v1/messages", { method: "POST", headers, body: Readable.toWeb(req) as ReadableStream, duplex: "half" } as RequestInit);
    const out = await handleMessages(request, deps);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    if (!out.body) { res.end(); return; }
    const reader = out.body.getReader();
    let gone = false;
    res.on("close", () => { if (!res.writableEnded) { gone = true; void reader.cancel().catch(() => {}); } });
    for (;;) {
      const { done, value } = await reader.read();
      if (done || gone) break;
      if (!res.write(value)) await new Promise((r) => res.once("drain", r)); // backpressure
    }
    if (!gone) res.end();
  } catch (e) {
    console.error("[alembic-gateway] request failed:", (e as Error).message);
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end('{"type":"error","error":{"type":"gateway_error","message":"upstream failed"}}');
  }
}).listen(port, () => console.log(`[alembic-gateway] listening on :${port}`));
