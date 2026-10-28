import { describe, expect, it, vi } from "vitest";
import { handleMessages, inspectContent, keyHash, MAX_TOKENS_CAP, refuseFields, type GatewayDeps } from "./gateway";
import { costUsd } from "./pricing";
import { chargeableUsage, StreamUsage } from "./usage";

const TOKEN = "agk_" + "a".repeat(40);
let jobSeq = 0;
function deps(over: Partial<GatewayDeps> = {}, upstreamBody?: string | ReadableStream, upstreamStatus = 200, remaining = 10) {
  const job = `job${++jobSeq}`;
  const d = {
    checkKey: vi.fn(async (h: string) => (h === keyHash(TOKEN) ? { jobId: job, models: ["claude-haiku-5-5", "claude-opus-5-5"], remaining } : null)),
    recordUsage: vi.fn(async () => true),
    capture: vi.fn(async () => undefined),
    usdPerCredit: vi.fn(async () => 0.01),
    upstream: vi.fn(async () => new Response(upstreamBody ?? JSON.stringify({ id: "msg_1", usage: { input_tokens: 1000, output_tokens: 200 } }), { status: upstreamStatus })),
    ...over,
  };
  return Object.assign(d, { job }) as typeof d & GatewayDeps & { job: string };
}
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://g/v1/messages", { method: "POST", headers: { "x-api-key": TOKEN, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const ok = { model: "claude-haiku-5-5", max_tokens: 100, messages: [{ role: "user", content: "hi" }] };

describe("pricing", () => {
  it("prices Haiku 5.5 per tier and caches per kind", () => {
    expect(costUsd("claude-haiku-5-5", { input_tokens: 100_000 })).toBeCloseTo(0.01);
    expect(costUsd("claude-haiku-5-5", { input_tokens: 150_000 })).toBeCloseTo(0.075);
    expect(costUsd("claude-sonnet-5-5", { output_tokens: 1_000_000 })).toBeCloseTo(10);
    expect(costUsd("claude-opus-5-5", { cache_read_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 1_000_000 } })).toBeCloseTo(0.2 + 5 + 8);
    expect(() => costUsd("gpt-x", {})).toThrow();
  });
});

describe("StreamUsage", () => {
  it("reads input from message_start and the last cumulative output from message_delta, across chunk splits", () => {
    const s = new StreamUsage();
    const ev = 'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_9","usage":{"input_tokens":50,"output_tokens":1}}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n' +
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":12}}\n\n';
    for (let i = 0; i < ev.length; i += 7) s.push(ev.slice(i, i + 7));
    expect(s.messageId).toBe("msg_9");
    expect(chargeableUsage(s)).toMatchObject({ input_tokens: 50, output_tokens: 12 });
  });
  it("estimates output from streamed text when the stream ends before its final usage (review M4)", () => {
    const s = new StreamUsage();
    s.push('data: {"type":"message_start","message":{"id":"m","usage":{"input_tokens":5,"output_tokens":1}}}\n\n');
    s.push(`data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"${"x".repeat(3000)}"}}\n\n`);
    expect(chargeableUsage(s).output_tokens).toBe(1000);
  });
});

describe("refuseFields (review H2)", () => {
  it("lets ordinary calls and own tools through; refuses billed extras and server tools", () => {
    expect(refuseFields({ ...ok, tools: [{ name: "t", input_schema: {} }], output_config: { effort: "low" } })).toBeNull();
    for (const k of ["speed", "service_tier", "inference_geo", "container", "mcp_servers", "fallbacks", "context_management"]) {
      expect(refuseFields({ ...ok, [k]: "x" })).toMatch(k);
    }
    expect(refuseFields({ ...ok, tools: [{ type: "web_search_20260209", name: "web_search" }] })).toMatch(/server tools/);
    expect(refuseFields({ ...ok, output_config: { task_budget: { type: "tokens", total: 1 } } })).toMatch(/effort and format/);
  });
});

describe("handleMessages", () => {
  it("refuses bad keys, other models, betas, missing or huge max_tokens — without calling Anthropic", async () => {
    const d = deps();
    expect((await handleMessages(req(ok, { "x-api-key": "nope" }), d)).status).toBe(401);
    expect((await handleMessages(req({ ...ok, model: "claude-sonnet-5-5" }), d)).status).toBe(403);
    expect((await handleMessages(req(ok, { "anthropic-beta": "files-api-2025-04-14" }), d)).status).toBe(400);
    expect((await handleMessages(req({ ...ok, max_tokens: undefined }), d)).status).toBe(400);
    expect((await handleMessages(req({ ...ok, max_tokens: MAX_TOKENS_CAP + 1 }), d)).status).toBe(400);
    expect((await handleMessages(req({ ...ok, speed: "fast" }), d)).status).toBe(400);
    expect(d.upstream).not.toHaveBeenCalled();
  });

  it("refuses a call whose worst case exceeds what is left of the hold (review H1)", async () => {
    const d = deps({}, undefined, 200, 0.5);
    // Opus 5.5: 32k output tokens could cost 32_000 × $20/M = $0.64 = 64 credits
    const r = await handleMessages(req({ ...ok, model: "claude-opus-5-5", max_tokens: 32_000 }), d);
    expect(r.status).toBe(402);
    expect(d.upstream).not.toHaveBeenCalled();
    expect((await handleMessages(req({ ...ok, max_tokens: 50 }), d)).status).toBe(200); // a small Haiku call fits
  });

  it("runs one call at a time per job (review H1)", async () => {
    let release!: () => void;
    let calls = 0;
    const answer = () => new Response(JSON.stringify({ id: `msg_${calls}`, usage: { input_tokens: 1, output_tokens: 1 } }));
    const d = deps({ upstream: vi.fn(() => (++calls === 1 ? new Promise<Response>((r) => { release = () => r(answer()); }) : Promise.resolve(answer()))) });
    const first = handleMessages(req(ok), d);
    await new Promise((r) => setTimeout(r, 5));
    expect((await handleMessages(req(ok), d)).status).toBe(429);
    release();
    expect((await first).status).toBe(200);
    expect((await handleMessages(req(ok), d)).status).toBe(200); // free again
  });

  it("records usage before charging, charges by message id, and keeps the record if the charge fails (review M3)", async () => {
    const d = deps();
    const r = await handleMessages(req(ok), d);
    expect(r.status).toBe(200);
    expect(d.recordUsage).toHaveBeenCalledWith(d.job, "msg_1", "claude-haiku-5-5", expect.objectContaining({ input_tokens: 1000 }), expect.closeTo(0.0002, 8), expect.closeTo(0.02, 6));
    expect(d.capture).toHaveBeenCalledWith(d.job, "msg_1", expect.closeTo(0.02, 6));
    const failing = deps({ capture: vi.fn(async () => { throw new Error("db down"); }) });
    expect((await handleMessages(req(ok), failing)).status).toBe(200);
    expect(failing.recordUsage).toHaveBeenCalled(); // left uncaptured for the worker to retry
  });

  it("streams unchanged and charges the final usage", async () => {
    const sse = 'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_s","usage":{"input_tokens":2000}}}\n\nevent: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":400}}\n\n';
    const d = deps({}, new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }));
    const r = await handleMessages(req({ ...ok, stream: true }), d);
    expect(await r.text()).toBe(sse);
    await new Promise((res) => setTimeout(res, 10));
    expect(d.capture).toHaveBeenCalledWith(d.job, "msg_s", expect.closeTo((2000 * 0.1 + 400 * 0.5) / 1e6 / 0.01, 6));
  });

  it("returns Anthropic's error as is and charges nothing; refuses an oversized body", async () => {
    const d = deps({}, JSON.stringify({ type: "error", error: { type: "overloaded_error" } }), 529);
    expect((await handleMessages(req(ok), d)).status).toBe(529);
    expect(d.capture).not.toHaveBeenCalled();
    const big = deps();
    expect((await handleMessages(req({ ...ok, messages: [{ role: "user", content: "x".repeat(9 * 1024 * 1024) }] }), big)).status).toBe(413);
  });
});

describe("review round 2", () => {
  it("refuses url/file images and documents; counts inline images (H2)", () => {
    const img = (source: unknown) => ({ ...ok, messages: [{ role: "user", content: [{ type: "image", source }] }] });
    expect(inspectContent(img({ type: "url", url: "https://x/y.png" }))).toEqual({ refuse: expect.stringMatching(/inline/) });
    expect(inspectContent(img({ type: "file", file_id: "file_1" }))).toEqual({ refuse: expect.stringMatching(/inline/) });
    expect(inspectContent({ ...ok, messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", data: "x" } }] }] })).toEqual({ refuse: expect.stringMatching(/PDF/) });
    expect(inspectContent(img({ type: "base64", media_type: "image/png", data: "AAAA" }))).toEqual({ images: 1, base64Bytes: 4 });
  });

  it("re-checks the credit after the body arrives, under the job's lock (H1)", async () => {
    let remaining = 10;
    const d = deps({ checkKey: vi.fn(async () => ({ jobId: "jobR", models: ["claude-haiku-5-5"], remaining })) });
    // The credit is spent while this request's body is still arriving.
    const slow = new ReadableStream<Uint8Array>({ async start(c) { remaining = 0; c.enqueue(new TextEncoder().encode(JSON.stringify(ok))); c.close(); } });
    const r = await handleMessages(new Request("http://g/v1/messages", { method: "POST", headers: { "x-api-key": TOKEN }, body: slow, duplex: "half" } as RequestInit), d);
    expect(r.status).toBe(402);
    expect(d.upstream).not.toHaveBeenCalled();
  });

  it("forwards exactly what it checked: duplicate keys collapse to the checked value (M3)", async () => {
    const d = deps();
    const raw = `{"model":"claude-opus-5-5","model":"claude-haiku-5-5","max_tokens":20,"messages":[{"role":"user","content":"hi"}]}`;
    const r = await handleMessages(new Request("http://g/v1/messages", { method: "POST", headers: { "x-api-key": TOKEN }, body: raw }), d);
    expect(r.status).toBe(200);
    const sent = (d.upstream as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0] as string;
    expect(sent.match(/"model"/g)).toHaveLength(1);
    expect(JSON.parse(sent).model).toBe("claude-haiku-5-5");
  });
});

describe("review round 3", () => {
  it("an image-shaped object inside tool_use input is text, not an image (H)", () => {
    const fake = { type: "image", source: { type: "base64", data: "A".repeat(1000) } };
    const b = { ...ok, messages: [{ role: "assistant", content: [{ type: "tool_use", id: "t", name: "x", input: fake }] }] };
    expect(inspectContent(b)).toEqual({ images: 0, base64Bytes: 0 });
    const real = { ...ok, messages: [{ role: "user", content: [fake, { type: "tool_result", tool_use_id: "t", content: [fake] }] }] };
    expect(inspectContent(real)).toEqual({ images: 2, base64Bytes: 2000 });
    expect(inspectContent({ ...ok, messages: [{ role: "assistant", content: [{ type: "redacted_thinking", data: "x" }] }] })).toEqual({ refuse: expect.stringMatching(/redacted/) });
  });

  it("a failed answer read releases the lock and charges the estimate (M)", async () => {
    let n = 0;
    const broken = () => new Response(new ReadableStream({ start(c) { c.error(new Error("reset")); } }));
    const d = deps({ upstream: vi.fn(async () => (++n === 1 ? broken() : new Response(JSON.stringify({ id: "msg_ok", usage: { input_tokens: 1, output_tokens: 1 } })))) });
    await expect(handleMessages(req(ok), d)).rejects.toThrow();
    expect(d.recordUsage).toHaveBeenCalledWith(d.job, expect.stringMatching(/^call_/), "claude-haiku-5-5", expect.objectContaining({ output_tokens: 100 }), expect.any(Number), expect.any(Number));
    expect((await handleMessages(req(ok), d)).status).toBe(200); // not stuck at 429
  });
});
