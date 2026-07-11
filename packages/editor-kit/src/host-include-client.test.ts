import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOST_INCLUDE_PROTOCOL,
  HOST_INCLUDE_VERSION,
  createHostIncludeClient,
  type HostIncludeClientOptions,
} from "./host-include-client";

const READY = {
  type: "orz-host-include-ready",
  protocol: HOST_INCLUDE_PROTOCOL,
  version: HOST_INCLUDE_VERSION,
};

function makeClient(overrides: Partial<HostIncludeClientOptions> = {}) {
  const posted: Record<string, unknown>[] = [];
  const resolve = vi.fn(async (url: string) => (url.includes("ok") ? "INCLUDED" : null));
  const client = createHostIncludeClient({
    post: (m) => posted.push(m),
    resolve,
    ...overrides,
  });
  return { client, posted, resolve };
}

const request = (over: Record<string, unknown> = {}) => ({
  type: "orz-host-include-request",
  protocol: HOST_INCLUDE_PROTOCOL,
  version: 1,
  requestId: "r1",
  url: "https://host/d/doc-ok",
  ...over,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createHostIncludeClient", () => {
  it("announces hello and retries until ready", () => {
    const { client, posted } = makeClient();
    client.start();
    expect(posted[0]).toMatchObject({ type: "orz-host-include-hello", version: 1 });
    vi.advanceTimersByTime(400);
    expect(posted).toHaveLength(2); // retried
    client.handleMessage(READY);
    expect(client.ready).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(posted).toHaveLength(2); // retry loop stopped after ready
  });

  it("resolves an include request and replies with the markdown", async () => {
    const { client, posted, resolve } = makeClient();
    client.start();
    client.handleMessage(READY);
    client.handleMessage(request());
    await vi.runAllTimersAsync();
    expect(resolve).toHaveBeenCalledWith("https://host/d/doc-ok");
    const result = posted.find((m) => m["type"] === "orz-host-include-result");
    expect(result).toMatchObject({ requestId: "r1", ok: true, markdown: "INCLUDED" });
  });

  it("replies ok:false when the host declines (resolve → null)", async () => {
    const { client, posted } = makeClient();
    client.start();
    client.handleMessage(READY);
    client.handleMessage(request({ url: "https://host/d/doc-nope" }));
    await vi.runAllTimersAsync();
    const result = posted.find((m) => m["type"] === "orz-host-include-result");
    expect(result).toMatchObject({ ok: false });
    expect(result).not.toHaveProperty("markdown");
  });

  it("ignores requests before the handshake and rejects empty urls", async () => {
    const { client, posted, resolve } = makeClient();
    client.start();
    client.handleMessage(request()); // before ready → ignored
    expect(resolve).not.toHaveBeenCalled();
    client.handleMessage(READY);
    client.handleMessage(request({ url: "" }));
    await vi.runAllTimersAsync();
    expect(resolve).not.toHaveBeenCalled();
    const result = posted.find((m) => m["type"] === "orz-host-include-result");
    expect(result).toMatchObject({ ok: false, error: "The include request arrived empty." });
  });

  it("calls onHelloTimeout when the file never confirms", () => {
    const onHelloTimeout = vi.fn();
    const { client } = makeClient({ onHelloTimeout });
    client.start();
    vi.advanceTimersByTime(20_000);
    expect(onHelloTimeout).toHaveBeenCalledOnce();
  });

  it("ignores foreign-protocol and wrong-version messages", () => {
    const { client } = makeClient();
    client.start();
    client.handleMessage({ ...READY, protocol: "orz-host-ai" });
    expect(client.ready).toBe(false);
    client.handleMessage({ ...READY, version: 2 });
    expect(client.ready).toBe(false);
  });
});
