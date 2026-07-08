import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOST_AI_PROTOCOL,
  HOST_AI_VERSION,
  createHostAIClient,
  type HostAIClientOptions,
} from "./host-ai-client";

const READY = {
  type: "orz-host-ai-ready",
  protocol: HOST_AI_PROTOCOL,
  version: HOST_AI_VERSION,
};

const OPS = [
  { id: "check-spelling-grammar", title: "Check spelling & grammar", selection: true },
  { id: "improve-language", title: "Improve language", selection: true },
];

function makeClient(overrides: Partial<HostAIClientOptions> = {}) {
  const posted: Record<string, unknown>[] = [];
  const run = vi.fn(async () => ({ ok: true as const, proposed: "fixed" }));
  const client = createHostAIClient({
    post: (m) => posted.push(m),
    operations: OPS,
    run,
    ...overrides,
  });
  return { client, posted, run };
}

const request = (over: Record<string, unknown> = {}) => ({
  type: "orz-host-ai-request",
  protocol: HOST_AI_PROTOCOL,
  version: 1,
  requestId: "r1",
  op: "improve-language",
  text: "a passage",
  selection: true,
  ...over,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createHostAIClient", () => {
  it("advertises operations in the hello and retries until ready", () => {
    const { client, posted } = makeClient();
    client.start();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      type: "orz-host-ai-hello",
      version: 1,
      operations: OPS,
    });
    vi.advanceTimersByTime(1200);
    expect(posted.length).toBe(4); // initial + 3 retries at 400ms
    client.handleMessage(READY);
    expect(client.ready).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(posted.filter((m) => m["type"] === "orz-host-ai-hello")).toHaveLength(4);
  });

  it("reports the hello timeout when the file never answers", () => {
    const onHelloTimeout = vi.fn();
    const { client } = makeClient({ onHelloTimeout });
    client.start();
    vi.advanceTimersByTime(20_001);
    expect(onHelloTimeout).toHaveBeenCalledOnce();
    expect(client.ready).toBe(false);
  });

  it("ignores ready messages with the wrong protocol or version", () => {
    const { client } = makeClient();
    client.start();
    client.handleMessage({ ...READY, protocol: "other" });
    client.handleMessage({ ...READY, version: 2 });
    client.handleMessage("not even an object");
    expect(client.ready).toBe(false);
  });

  it("relays a request to run() and returns the proposal", async () => {
    const { client, posted, run } = makeClient();
    client.start();
    client.handleMessage(READY);
    client.handleMessage(request());
    await vi.waitFor(() =>
      expect(posted.some((m) => m["type"] === "orz-host-ai-result")).toBe(true),
    );
    expect(run).toHaveBeenCalledWith({ op: "improve-language", text: "a passage", selection: true });
    expect(posted.at(-1)).toMatchObject({
      type: "orz-host-ai-result",
      requestId: "r1",
      ok: true,
      proposed: "fixed",
    });
  });

  it("relays a failed run with the host's error", async () => {
    const { client, posted } = makeClient({
      run: async () => ({ ok: false, error: "Over your AI budget." }),
    });
    client.start();
    client.handleMessage(READY);
    client.handleMessage(request());
    await vi.waitFor(() =>
      expect(posted.at(-1)).toMatchObject({ ok: false, error: "Over your AI budget." }),
    );
  });

  it("rejects requests before the handshake and empty requests after it", async () => {
    const { client, posted, run } = makeClient();
    client.start();
    client.handleMessage(request()); // pre-handshake → dropped silently
    expect(run).not.toHaveBeenCalled();
    client.handleMessage(READY);
    client.handleMessage(request({ text: "" })); // empty → nacked, not run
    await vi.waitFor(() => expect(posted.at(-1)).toMatchObject({ ok: false }));
    expect(run).not.toHaveBeenCalled();
  });

  it("echoes the requestId so concurrent requests correlate", async () => {
    const { client, posted } = makeClient();
    client.start();
    client.handleMessage(READY);
    client.handleMessage(request({ requestId: "abc" }));
    await vi.waitFor(() => expect(posted.at(-1)).toMatchObject({ requestId: "abc" }));
  });

  it("stop() silences timers and messages", () => {
    const onReady = vi.fn();
    const { client, posted } = makeClient({ onReady });
    client.start();
    client.stop();
    const before = posted.length;
    vi.advanceTimersByTime(5000);
    expect(posted.length).toBe(before);
    client.handleMessage(READY);
    expect(onReady).not.toHaveBeenCalled();
  });
});
