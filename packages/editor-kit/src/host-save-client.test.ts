import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOST_SAVE_PROTOCOL,
  HOST_SAVE_VERSION,
  createHostSaveClient,
  type HostSaveClientOptions,
} from "./host-save-client";

const READY = {
  type: "orz-host-ready",
  protocol: HOST_SAVE_PROTOCOL,
  version: HOST_SAVE_VERSION,
  kind: "md",
};

function makeClient(overrides: Partial<HostSaveClientOptions> = {}) {
  const posted: Record<string, unknown>[] = [];
  const save = vi.fn(async () => ({ ok: true as const }));
  const client = createHostSaveClient({
    post: (m) => posted.push(m),
    save,
    ...overrides,
  });
  return { client, posted, save };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createHostSaveClient", () => {
  it("sends the hello immediately and retries until ready", () => {
    const { client, posted } = makeClient();
    client.start();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: "orz-host-hello", version: 1 });
    vi.advanceTimersByTime(1200);
    expect(posted.length).toBe(4); // initial + 3 retries at 400ms
    client.handleMessage(READY);
    expect(client.ready).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(posted.filter((m) => m["type"] === "orz-host-hello")).toHaveLength(4);
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

  it("relays a save to the host hook and acknowledges ok", async () => {
    const { client, posted, save } = makeClient();
    client.start();
    client.handleMessage(READY);
    client.handleMessage({
      type: "orz-host-save",
      protocol: HOST_SAVE_PROTOCOL,
      version: 1,
      source: "# md",
      html: "<!doctype html>…",
    });
    await vi.waitFor(() =>
      expect(posted.some((m) => m["type"] === "orz-host-saved")).toBe(true),
    );
    expect(save).toHaveBeenCalledWith({ source: "# md", rendered: "<!doctype html>…" });
    expect(posted.at(-1)).toMatchObject({ type: "orz-host-saved", ok: true });
  });

  it("acknowledges a failed save with the host's error", async () => {
    const { client, posted } = makeClient({
      save: async () => ({ ok: false, error: "Private content detected." }),
    });
    client.start();
    client.handleMessage(READY);
    client.handleMessage({
      type: "orz-host-save",
      protocol: HOST_SAVE_PROTOCOL,
      version: 1,
      source: "x",
      html: "<!doctype html>…",
    });
    await vi.waitFor(() =>
      expect(posted.at(-1)).toMatchObject({ ok: false, error: "Private content detected." }),
    );
  });

  it("rejects saves before the handshake and empty documents after it", async () => {
    const { client, posted, save } = makeClient();
    client.start();
    const saveMsg = {
      type: "orz-host-save",
      protocol: HOST_SAVE_PROTOCOL,
      version: 1,
      source: "x",
      html: "<!doctype html>…",
    };
    client.handleMessage(saveMsg); // pre-handshake → dropped silently
    expect(save).not.toHaveBeenCalled();
    client.handleMessage(READY);
    client.handleMessage({ ...saveMsg, html: "" }); // empty → nacked, not persisted
    await vi.waitFor(() => expect(posted.at(-1)).toMatchObject({ ok: false }));
    expect(save).not.toHaveBeenCalled();
  });

  it("forwards dirty signals only after the handshake", () => {
    const onDirty = vi.fn();
    const { client } = makeClient({ onDirty });
    client.start();
    const dirty = { type: "orz-host-dirty", protocol: HOST_SAVE_PROTOCOL, version: 1, dirty: true };
    client.handleMessage(dirty);
    expect(onDirty).not.toHaveBeenCalled();
    client.handleMessage(READY);
    client.handleMessage(dirty);
    expect(onDirty).toHaveBeenCalledWith(true);
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
