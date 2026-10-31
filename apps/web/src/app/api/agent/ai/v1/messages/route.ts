/**
 * The sandbox's way to the AI gateway (agent-runtime-v3 §2; C4 step 3): one public host for everything the
 * assistant reaches. This route only passes the call through to the gateway inside the VM; the gateway does every
 * check (the per-job key, the hold, the allowed fields and models) and the charging. Nothing is logged or stored.
 */
export const dynamic = "force-dynamic";

const PASS = ["x-api-key", "anthropic-version", "anthropic-beta", "content-type", "accept"];
const MAX = 8 * 1024 * 1024;

export async function POST(req: Request) {
  const gateway = process.env["TRY_GATEWAY_URL"];
  if (!gateway) return Response.json({ type: "error", error: { type: "gateway_error", message: "the assistant isn't available here" } }, { status: 503 });
  if (Number(req.headers.get("content-length") ?? "0") > MAX) return Response.json({ type: "error", error: { type: "gateway_error", message: "too large" } }, { status: 413 });
  const headers: Record<string, string> = {};
  for (const h of PASS) { const v = req.headers.get(h); if (v) headers[h] = v; }
  const up = await fetch(`${gateway.replace(/\/$/, "")}/v1/messages`, { method: "POST", headers, body: req.body, duplex: "half", signal: req.signal } as RequestInit);
  const out = new Headers({ "cache-control": "no-store" });
  for (const h of ["content-type", "request-id"]) { const v = up.headers.get(h); if (v) out.set(h, v); }
  return new Response(up.body, { status: up.status, headers: out });
}
