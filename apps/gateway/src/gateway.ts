/**
 * The gateway's one route, POST /v1/messages (I11):
 * 1. the caller's key (x-api-key) must belong to a running job with an open
 *    hold that still has credit, and allow the requested model;
 * 2. the request goes to Anthropic with the master key, the answer streams
 *    back unchanged;
 * 3. usage is read from Anthropic's own usage fields and charged to the job
 *    (ledger_capture), also when the caller disconnects mid-stream.
 * Prompts and answers are never logged or stored.
 */
import { createHash } from "node:crypto";
import { costUsd, knownModel, type Usage } from "./pricing";
import { StreamUsage } from "./usage";

export interface GatewayDeps {
  checkKey(hash: string): Promise<{ jobId: string; models: string[]; remaining: number } | null>;
  /** Charge credits to the job (idempotent per call id). */
  capture(jobId: string, callId: string, credits: number): Promise<void>;
  /** USD per credit now. */
  usdPerCredit(): Promise<number>;
  upstream(body: string, headers: Record<string, string>, signal?: AbortSignal): Promise<Response>;
  log?(m: string): void;
}

export const keyHash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

const json = (status: number, message: string) =>
  new Response(JSON.stringify({ type: "error", error: { type: status === 402 ? "budget_exhausted" : "gateway_error", message } }), { status, headers: { "content-type": "application/json" } });

export async function handleMessages(req: Request, deps: GatewayDeps): Promise<Response> {
  const token = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!/^agk_[A-Za-z0-9_-]{30,}$/.test(token)) return json(401, "missing or malformed gateway key");
  const key = await deps.checkKey(keyHash(token));
  if (!key) return json(401, "this key is not valid now (expired, revoked, or its job ended)");
  if (key.remaining <= 0) return json(402, "the credit set aside for this job is used up");

  const body = await req.text();
  if (body.length > 20_000_000) return json(413, "request too large");
  let parsed: { model?: unknown; stream?: unknown };
  try { parsed = JSON.parse(body); } catch { return json(400, "body is not JSON"); }
  const model = typeof parsed.model === "string" ? parsed.model : "";
  if (!knownModel(model) || !key.models.includes(model)) return json(403, `model ${model || "(none)"} is not allowed for this key`);

  const headers: Record<string, string> = { "content-type": "application/json", "anthropic-version": req.headers.get("anthropic-version") ?? "2023-06-01" };
  const beta = req.headers.get("anthropic-beta");
  if (beta) headers["anthropic-beta"] = beta;
  const up = await deps.upstream(body, headers);
  const charge = async (usage: Usage, callId: string) => {
    try {
      const usd = costUsd(model, usage);
      if (usd > 0) await deps.capture(key.jobId, callId, usd / (await deps.usdPerCredit()));
    } catch (e) {
      deps.log?.(`capture failed for job ${key.jobId}: ${(e as Error).message}`); // ledger sweep/nightly reconcile catches it
    }
  };
  const fallbackId = `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  if (!up.ok || !up.body) {
    return new Response(up.body, { status: up.status, headers: { "content-type": up.headers.get("content-type") ?? "application/json" } });
  }

  if (parsed.stream === true) {
    const reader = up.body.getReader();
    const meter = new StreamUsage();
    const dec = new TextDecoder();
    let clientGone = false;
    const out = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            meter.push(dec.decode(value, { stream: true }));
            if (!clientGone) {
              try { controller.enqueue(value); } catch { clientGone = true; } // keep reading upstream to learn the final usage
            }
          }
        } finally {
          await charge(meter.usage, meter.messageId ?? fallbackId);
          if (!clientGone) try { controller.close(); } catch { /* already closed */ }
        }
      },
      cancel() { clientGone = true; },
    });
    return new Response(out, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
  }

  const text = await up.text();
  let usage: Usage = {};
  let id = fallbackId;
  try { const r = JSON.parse(text) as { id?: string; usage?: Usage }; usage = r.usage ?? {}; id = r.id ?? id; } catch { /* not JSON: nothing to charge */ }
  await charge(usage, id);
  return new Response(text, { status: up.status, headers: { "content-type": "application/json" } });
}
