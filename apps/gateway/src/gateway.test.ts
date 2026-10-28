import { describe, expect, it, vi } from "vitest";
import { handleMessages, keyHash, type GatewayDeps } from "./gateway";
import { costUsd } from "./pricing";
import { StreamUsage } from "./usage";

const TOKEN = "agk_" + "a".repeat(40);
function deps(over: Partial<GatewayDeps> = {}, upstreamBody?: string | ReadableStream, upstreamStatus = 200) {
  const d = {
    checkKey: vi.fn(async (h: string) => (h === keyHash(TOKEN) ? { jobId: "job1", models: ["claude-haiku-5-5"], remaining: 10 } : null)),
    capture: vi.fn(async () => undefined),
    usdPerCredit: vi.fn(async () => 0.01),
    upstream: vi.fn(async () => new Response(upstreamBody ?? JSON.stringify({ id: "msg_1", usage: { input_tokens: 1000, output_tokens: 200 } }), { status: upstreamStatus })),
    ...over,
  };
  return d as typeof d & GatewayDeps;
}
const req = (body: unknown, key = TOKEN) => new Request("http://g/v1/messages", { method: "POST", headers: { "x-api-key": key, "content-type": "application/json" }, body: JSON.stringify(body) });

describe("pricing", () => {
  it("prices Haiku 5.5 per tier and caches per kind", () => {
    expect(costUsd("claude-haiku-5-5", { input_tokens: 100_000 })).toBeCloseTo(0.01); // exactly 100k: the lower tier ($0.10/MTok)
    expect(costUsd("claude-haiku-5-5", { input_tokens: 150_000 })).toBeCloseTo(0.075); // over 100k: $0.50/MTok
    expect(costUsd("claude-sonnet-5-5", { input_tokens: 0, output_tokens: 1_000_000 })).toBeCloseTo(10);
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
    expect(s.usage).toMatchObject({ input_tokens: 50, output_tokens: 12 });
  });
});

describe("handleMessages", () => {
  it("refuses a missing, unknown or out-of-budget key and a model the key doesn't allow, without calling Anthropic", async () => {
    const d = deps();
    expect((await handleMessages(req({ model: "claude-haiku-5-5" }, "nope"), d)).status).toBe(401);
    expect((await handleMessages(req({ model: "claude-haiku-5-5" }, "agk_" + "b".repeat(40)), d)).status).toBe(401);
    expect((await handleMessages(req({ model: "claude-opus-5-5" }), d)).status).toBe(403);
    const broke = deps({ checkKey: vi.fn(async () => ({ jobId: "j", models: ["claude-haiku-5-5"], remaining: 0 })) });
    expect((await handleMessages(req({ model: "claude-haiku-5-5" }), broke)).status).toBe(402);
    expect(d.upstream).not.toHaveBeenCalled();
  });

  it("passes a call through and charges its cost in credits to the job, keyed by the message id", async () => {
    const d = deps();
    const r = await handleMessages(req({ model: "claude-haiku-5-5", max_tokens: 100, messages: [] }), d);
    expect(r.status).toBe(200);
    expect(JSON.parse(await r.text()).id).toBe("msg_1");
    // 1000 in × $0.10/M + 200 out × $0.50/M = $0.0002 → 0.02 credits at $0.01
    expect(d.capture).toHaveBeenCalledWith("job1", "msg_1", expect.closeTo(0.02, 6));
    expect((d.upstream as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![1]).not.toHaveProperty("x-api-key"); // the master key is added only by the upstream function
  });

  it("streams unchanged and charges the final usage, also if the caller stops reading", async () => {
    const sse = 'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_s","usage":{"input_tokens":2000}}}\n\nevent: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":400}}\n\n';
    const d = deps({}, new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }));
    const r = await handleMessages(req({ model: "claude-haiku-5-5", stream: true }), d);
    expect(await r.text()).toBe(sse);
    await new Promise((res) => setTimeout(res, 10));
    expect(d.capture).toHaveBeenCalledWith("job1", "msg_s", expect.closeTo((2000 * 0.1 + 400 * 0.5) / 1e6 / 0.01, 6));
  });

  it("returns Anthropic's error as is and charges nothing", async () => {
    const d = deps({}, JSON.stringify({ type: "error", error: { type: "overloaded_error" } }), 529);
    const r = await handleMessages(req({ model: "claude-haiku-5-5" }), d);
    expect(r.status).toBe(529);
    expect(d.capture).not.toHaveBeenCalled();
  });
});
