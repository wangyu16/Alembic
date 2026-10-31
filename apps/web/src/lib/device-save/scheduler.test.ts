import { describe, expect, it } from "vitest";
import { IDLE_MS, MAX_WAIT_MS, RETRY_MS, SyncScheduler, statusLabel, type Draft, type SendResult, type SyncStatus } from "./scheduler";

function harness(results: Array<SendResult | Error> = []) {
  let now = 0;
  let timers: Array<{ id: number; at: number; fn: () => void }> = [];
  let seq = 0;
  const sent: Array<{ text: string; syncId: string }> = [];
  const statuses: SyncStatus[] = [];
  const synced: Draft[] = [];
  let pending: { resolve: (r: SendResult) => void } | null = null;
  const s = new SyncScheduler({
    now: () => now,
    setTimer: (fn, ms) => { const id = ++seq; timers.push({ id, at: now + ms, fn }); return id; },
    clearTimer: (h) => { timers = timers.filter((t) => t.id !== h); },
    newSyncId: () => `sync-${++seq}`,
    send: (d, id) => {
      sent.push({ text: d.text, syncId: id });
      const r = results.shift();
      if (r instanceof Error) return Promise.reject(r);
      if (r) return Promise.resolve(r);
      return new Promise<SendResult>((resolve) => { pending = { resolve }; });
    },
    onStatus: (x) => statuses.push(x),
    onSynced: (d) => synced.push(d),
  });
  const advance = async (ms: number) => {
    now += ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      due.fn();
      await Promise.resolve(); await Promise.resolve();
    }
    await Promise.resolve();
  };
  const finish = async (r: SendResult) => { pending!.resolve(r); pending = null; for (let i = 0; i < 4; i++) await Promise.resolve(); };
  const edit = (text: string) => s.edit({ text, baseVersion: null });
  return { s, sent, statuses, synced, advance, finish, edit, get now() { return now; } };
}

describe("SyncScheduler cadence", () => {
  it("syncs after 2 minutes without typing", async () => {
    const h = harness([{ ok: true }]);
    h.edit("a");
    expect(h.s.current.kind).toBe("saved");
    await h.advance(IDLE_MS - 1);
    expect(h.sent).toHaveLength(0);
    await h.advance(1);
    expect(h.sent.map((x) => x.text)).toEqual(["a"]);
    expect(h.s.current).toEqual({ kind: "synced", at: IDLE_MS });
  });

  it("syncs at most MAX_WAIT_MS after the first edit while typing continues", async () => {
    const h = harness([{ ok: true }]);
    for (let t = 0; t < MAX_WAIT_MS; t += 10_000) { h.edit(`v${t}`); await h.advance(10_000); }
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.text).toBe(`v${MAX_WAIT_MS - 10_000}`);
  });

  it("Sync now sends at once; nothing to send is a no-op", async () => {
    const h = harness([{ ok: true }]);
    await h.s.syncNow();
    expect(h.sent).toHaveLength(0);
    h.edit("x");
    await h.s.syncNow();
    expect(h.sent).toHaveLength(1);
    expect(h.s.hasUnsynced).toBe(false);
  });

  it("typing during a sync leaves the document unsynced and plans the next one", async () => {
    const h = harness();
    h.edit("one");
    const p = h.s.syncNow();
    h.edit("two");
    expect(h.s.current.kind).toBe("syncing");
    await h.finish({ ok: true });
    await p;
    expect(h.s.current.kind).toBe("saved");
    expect(h.s.hasUnsynced).toBe(true);
    expect(h.synced.map((d) => d.text)).toEqual(["one"]);
  });

  it("offline: retries the same request (same sync id) every 30 s; new typing gets a new id", async () => {
    const h = harness([new Error("offline"), { ok: false, retryable: true, reason: "502" }, { ok: true }]);
    h.edit("a");
    await h.s.syncNow();
    expect(h.s.current.kind).toBe("retrying");
    expect(statusLabel(h.s.current, String)).toBe("Kept on this device — will save to the course when back online");
    await h.advance(RETRY_MS);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.syncId).toBe(h.sent[0]!.syncId);
    h.edit("b");
    await h.s.syncNow();
    expect(h.sent[2]!.syncId).not.toBe(h.sent[0]!.syncId);
    expect(h.s.current.kind).toBe("synced");
  });

  it("a refusal stops retrying and says so; the text stays", async () => {
    const h = harness([{ ok: false, retryable: false, reason: "not allowed to change instructor/key.md" }]);
    h.edit("a");
    await h.s.syncNow();
    expect(h.s.current.kind).toBe("refused");
    await h.advance(10 * 60_000);
    expect(h.sent).toHaveLength(1);
    expect(h.s.hasUnsynced).toBe(true);
  });
});

describe("what the status says (RC.13)", () => {
  it("[RC.13] the status never says Saved for text that is only on this device; it says so plainly, and when the course has it", () => {
    expect(statusLabel({ kind: "saved" }, String)).toBe("Kept on this device — not in the course yet");
    expect(statusLabel({ kind: "synced", at: 0 }, () => "10:53 PM")).toBe("Saved to the course at 10:53 PM");
    expect(statusLabel({ kind: "refused", reason: "not allowed" }, String)).toMatch(/^Kept on this device only/);
    expect(IDLE_MS).toBeLessThanOrEqual(30_000);
  });
});

describe("our own sync coming back (RC.17)", () => {
  it("[RC.17] after the course echoes our own text, typing still unsent is sent on the new version, not the old one (no false 'both changed')", async () => {
    const bases: Array<string | null> = [];
    const s = new SyncScheduler({
      now: () => 0, setTimer: () => 0, clearTimer: () => {}, newSyncId: () => crypto.randomUUID(),
      send: async (d) => { bases.push(d.baseVersion); return { ok: true }; },
    });
    s.edit({ text: "first", baseVersion: "v0" });
    await s.syncNow();
    s.edit({ text: "first, more", baseVersion: "v0" }); // typed on before the echo arrived
    s.rebase("v1"); // the course now holds "first" as v1
    await s.syncNow();
    expect(bases).toEqual(["v0", "v1"]);
  });
});

describe("Save while a sync is under way (audit r3 MEDIUM-4)", () => {
  it("[RC.17] syncNow during a sync waits for it, then sends what was typed meanwhile; nothing is dropped", async () => {
    const sent: string[] = [];
    let release!: () => void;
    const first = new Promise<void>((r) => { release = r; });
    const s = new SyncScheduler({
      now: () => 0, setTimer: () => 0, clearTimer: () => {}, newSyncId: () => crypto.randomUUID(),
      send: async (d) => { sent.push(d.text); if (sent.length === 1) await first; return { ok: true }; },
    });
    s.edit({ text: "one", baseVersion: "v0" });
    const a = s.syncNow();
    await Promise.resolve();
    s.edit({ text: "one two", baseVersion: "v0" }); // typed while "one" is being sent
    const b = s.syncNow(); // Save pressed now
    release();
    await Promise.all([a, b]);
    expect(sent).toEqual(["one", "one two"]);
    expect(s.hasUnsynced).toBe(false);
  });
});
