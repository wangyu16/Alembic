/**
 * The gateway's one route, POST /v1/messages (I11):
 * 1. the caller's key (x-api-key) must belong to a running job with an open
 *    hold, and allow the requested model;
 * 2. only known request fields pass (no server tools, fast mode, regions,
 *    containers, MCP, fallbacks or betas: things billed outside the token
 *    counts); `max_tokens` is required and capped;
 * 3. the call's worst-case cost must fit what is left of the hold, and a key
 *    runs one call at a time, so a job can't spend past its hold;
 * 4. the request goes to Anthropic with the master key, the answer streams
 *    back unchanged;
 * 5. usage (Anthropic's own fields; an estimate if a stream ends early) is
 *    written durably, then charged to the job (ledger_capture by message id),
 *    also when the caller disconnects. A failed charge is retried later.
 * Prompts and answers are never logged or stored.
 */
import { createHash } from "node:crypto";
import { costUsd, knownModel, worstInputRate, worstOutputRate, type Usage } from "./pricing";
import { chargeableUsage, StreamUsage } from "./usage";

export interface GatewayDeps {
  checkKey(hash: string): Promise<{ jobId: string; models: string[]; remaining: number } | null>;
  /** Record a call's usage (numbers only) before charging; returns false if it was already recorded. */
  recordUsage(jobId: string, callId: string, model: string, usage: Usage, usd: number, credits: number): Promise<boolean>;
  /** Charge credits to the job (idempotent per call id) and mark the usage captured. */
  capture(jobId: string, callId: string, credits: number): Promise<void>;
  /** USD per credit now. */
  usdPerCredit(): Promise<number>;
  upstream(body: string, headers: Record<string, string>, signal?: AbortSignal): Promise<Response>;
  log?(m: string): void;
}

export const MAX_TOKENS_CAP = 32_000;
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

/** Request fields that pass through. Anything else (speed, service_tier, inference_geo, container, mcp_servers, fallbacks, …) is refused. */
const ALLOWED_FIELDS = new Set([
  "model", "messages", "system", "max_tokens", "stream", "metadata", "stop_sequences",
  "temperature", "top_p", "top_k", "tools", "tool_choice", "thinking", "output_config", "cache_control",
]);

export const keyHash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

const json = (status: number, message: string) =>
  new Response(JSON.stringify({ type: "error", error: { type: status === 402 ? "budget_exhausted" : "gateway_error", message } }), { status, headers: { "content-type": "application/json" } });

/** Calls in flight, per job (one gateway instance on testing; several instances would need a shared lock). */
const inFlight = new Set<string>();

/** Read a body with a size cap (stop reading past it). */
export async function readCapped(req: Request, max = MAX_BODY_BYTES): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Why a request can't pass, or null. Server tools (typed tools such as web_search) bill outside tokens. */
export function refuseFields(b: Record<string, unknown>): string | null {
  for (const k of Object.keys(b)) if (!ALLOWED_FIELDS.has(k)) return `field "${k}" is not allowed through the gateway`;
  if (Array.isArray(b["tools"])) {
    for (const t of b["tools"] as Array<Record<string, unknown>>) {
      if (typeof t !== "object" || t === null || ("type" in t && t["type"] !== "custom")) return "only your own tools are allowed (no server tools)";
    }
  }
  const oc = b["output_config"] as Record<string, unknown> | undefined;
  if (oc && Object.keys(oc).some((k) => k !== "effort" && k !== "format")) return "output_config allows effort and format only";
  return null;
}

/** Per-image ceiling (tokens): images are resized to ≤1568 px on the long edge, ≈3.3k tokens; generous. */
export const IMAGE_TOKEN_CEILING = 5000;
/** Tool definitions and structured outputs add a system prompt not in the body. */
const HIDDEN_PROMPT_TOKENS = 1000;

/**
 * Content the estimate can't bound (review r2 H2): a url or file source makes
 * Anthropic fetch something whose size we don't see, and a PDF is billed per
 * page as text plus an image. Base64 images are allowed and counted at a
 * fixed ceiling. Returns a refusal, or the number of images.
 */
export function inspectContent(b: Record<string, unknown>): { refuse: string } | { images: number; base64Bytes: number } {
  // 1. Anywhere in the request: refuse what the estimate can't bound.
  const deny = (v: unknown): string | null => {
    if (Array.isArray(v)) { for (const x of v) { const r = deny(x); if (r) return r; } return null; }
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if (o["type"] === "document") return "documents (PDF) aren't allowed through the gateway";
    if (o["type"] === "redacted_thinking") return "redacted thinking blocks aren't allowed through the gateway";
    if (o["type"] === "container_upload" || o["type"] === "search_result") return `content of type ${String(o["type"])} isn't allowed`;
    const src = o["source"] as Record<string, unknown> | undefined;
    if (o["type"] === "image" && src?.["type"] !== "base64") return "images must be inline (base64), not by url or file";
    for (const x of Object.values(o)) { const r = deny(x); if (r) return r; }
    return null;
  };
  const r = deny(b["messages"]) ?? deny(b["system"]);
  if (r) return { refuse: r };
  // 2. Only real image blocks count as images (review r3 H): a message's content list, or a tool result's.
  //    Anything shaped like an image elsewhere (e.g. inside tool_use input) stays text and is counted by its bytes.
  let images = 0;
  let base64Bytes = 0;
  const countBlocks = (content: unknown) => {
    if (!Array.isArray(content)) return;
    for (const blk of content as Array<Record<string, unknown>>) {
      if (!blk || typeof blk !== "object") continue;
      if (blk["type"] === "image") {
        const data = (blk["source"] as Record<string, unknown>)["data"];
        images++;
        base64Bytes += typeof data === "string" ? data.length : 0;
      } else if (blk["type"] === "tool_result") {
        countBlocks(blk["content"]);
      }
    }
  };
  if (Array.isArray(b["messages"])) for (const m of b["messages"] as Array<Record<string, unknown>>) if (m && typeof m === "object") countBlocks(m["content"]);
  return { images, base64Bytes };
}

/** Read a body with a size cap and a time limit. */
async function readBody(req: Request, ms = 15_000): Promise<string | null | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((r) => { timer = setTimeout(() => r("timeout"), ms); });
  try { return await Promise.race([readCapped(req), timeout]); } finally { clearTimeout(timer); }
}

export async function handleMessages(req: Request, deps: GatewayDeps): Promise<Response> {
  const token = req.headers.get("x-api-key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!/^agk_[A-Za-z0-9_-]{30,}$/.test(token)) return json(401, "missing or malformed gateway key");
  const key = await deps.checkKey(keyHash(token));
  if (!key) return json(401, "this key is not valid now (expired, revoked, or its job ended)");
  const jobId = key.jobId;
  if (req.headers.get("anthropic-beta")) return json(400, "beta features are not available through the gateway");

  // Lock the job first, then read the body and re-check the credit under the lock (review r2 H1).
  if (inFlight.has(key.jobId)) return json(429, "this job already has a call in progress");
  inFlight.add(key.jobId);
  let released = false;
  const release = () => { if (!released) { released = true; inFlight.delete(key.jobId); } };
  let handedOff = false;
  try {
    const body = await readBody(req);
    if (body === "timeout") return json(408, "the request body took too long");
    if (body === null) return json(413, "request too large");
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(body) as Record<string, unknown>; } catch { return json(400, "body is not JSON"); }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return json(400, "body must be an object");
    const model = typeof parsed["model"] === "string" ? parsed["model"] : "";
    if (!knownModel(model) || !key.models.includes(model)) return json(403, `model ${model || "(none)"} is not allowed for this key`);
    const refused = refuseFields(parsed);
    if (refused) return json(400, refused);
    const content = inspectContent(parsed);
    if ("refuse" in content) return json(400, content.refuse);
    const maxTokens = parsed["max_tokens"];
    if (typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > MAX_TOKENS_CAP) {
      return json(400, `max_tokens is required (1–${MAX_TOKENS_CAP})`);
    }
    // What is sent is exactly what was checked (review r2 M3: no duplicate-key games).
    const outBody = JSON.stringify(parsed);
    // Worst case: every UTF-8 byte of text a token (byte-fallback tokens can't exceed bytes), each image at its ceiling,
    // the hidden tool prompt, all of max_tokens — against the credit left now, read under the lock.
    const fresh = await deps.checkKey(keyHash(token));
    if (!fresh || fresh.jobId !== key.jobId) return json(401, "this key is not valid now");
    const perCredit = await deps.usdPerCredit();
    const textBytes = Buffer.byteLength(outBody, "utf8") - content.base64Bytes;
    const inputTokens = textBytes + content.images * IMAGE_TOKEN_CEILING + HIDDEN_PROMPT_TOKENS;
    const worstCredits = (inputTokens * worstInputRate(model) + maxTokens * worstOutputRate(model)) / perCredit;
    if (worstCredits > fresh.remaining) {
      return json(402, `this call could cost up to ${worstCredits.toFixed(4)} credits; ${Math.max(0, fresh.remaining).toFixed(4)} are left for this job (lower max_tokens or shorten the request)`);
    }
    handedOff = true;
    return await forward(outBody, parsed, model, perCredit, { input_tokens: inputTokens, output_tokens: maxTokens });
  } finally {
    if (!handedOff) release();
  }

  async function forward(outBody: string, parsed: Record<string, unknown>, model: string, perCredit: number, worst: Usage): Promise<Response> {
  const charge = async (usage: Usage, callId: string) => {
    try {
      const usd = costUsd(model, usage);
      const credits = usd / perCredit;
      if (await deps.recordUsage(jobId, callId, model, usage, usd, credits)) await deps.capture(jobId, callId, credits);
    } catch (e) {
      deps.log?.(`charge pending for job ${jobId}: ${(e as Error).message}`); // the worker retries recorded, uncaptured usage
    } finally {
      release();
    }
  };
  const fallbackId = `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  let up: Response;
  try {
    up = await deps.upstream(outBody, { "content-type": "application/json", "anthropic-version": "2023-06-01" }, AbortSignal.timeout(10 * 60_000));
  } catch (e) {
    release();
    throw e;
  }
  if (!up.ok || !up.body) {
    release();
    return new Response(up.body, { status: up.status, headers: { "content-type": up.headers.get("content-type") ?? "application/json" } });
  }

  if (parsed["stream"] === true) {
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
        } catch (e) {
          deps.log?.(`upstream stream ended early: ${(e as Error).message}`);
        } finally {
          await charge(chargeableUsage(meter), meter.messageId ?? fallbackId);
          if (!clientGone) try { controller.close(); } catch { /* already closed */ }
        }
      },
      cancel() { clientGone = true; },
    });
    return new Response(out, { status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
  }

  let text: string;
  try {
    text = await up.text();
  } catch (e) {
    // The answer couldn't be read (reset, timeout): charge the conservative estimate; the lock is released (review r3 M).
    await charge(worst, fallbackId);
    throw e;
  }
  let usage: Usage = {};
  let id = fallbackId;
  try { const r = JSON.parse(text) as { id?: string; usage?: Usage }; usage = r.usage ?? {}; id = r.id ?? id; } catch { /* not JSON: nothing to charge */ }
  await charge(usage, id);
  return new Response(text, { status: up.status, headers: { "content-type": "application/json" } });
}
}
