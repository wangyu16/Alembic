import { describe, expect, it, vi } from "vitest";
import { postgrestRpc, startSchedules, type Timers } from "./schedules";

function fakeTimers() {
  const fns: Array<{ fn: () => void; ms: number }> = [];
  const timers: Timers = { setInterval: (fn, ms) => fns.push({ fn, ms }) - 1, clearInterval: vi.fn() };
  return { timers, fns };
}

describe("startSchedules", () => {
  it("runs each schedule on its interval, never overlapping itself, and survives failures", async () => {
    const { timers, fns } = fakeTimers();
    let release!: () => void;
    const rpc = vi.fn((fn: string) =>
      fn === "slow" ? new Promise<unknown>((r) => { release = () => r(1); }) : Promise.reject(new Error("db down")));
    const log = vi.fn();
    const s = startSchedules(rpc, { schedules: [{ name: "a", everyMs: 10, rpc: "slow" }, { name: "b", everyMs: 20, rpc: "bad" }], timers, log });
    expect(fns.map((f) => f.ms)).toEqual([10, 20]);
    const first = s.tick("a");
    await s.tick("a"); // still running: skipped
    expect(rpc).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(log).toHaveBeenCalledWith("a: 1");
    await s.tick("b");
    expect(log).toHaveBeenCalledWith("b failed: db down");
    s.stop();
    expect(timers.clearInterval).toHaveBeenCalledTimes(2);
  });
});

describe("postgrestRpc", () => {
  it("posts to the function with the service key, and refuses odd names", async () => {
    const fetchImpl = vi.fn(async () => Response.json(3)) as unknown as typeof fetch;
    const rpc = postgrestRpc("https://x.supabase.co/", "key", fetchImpl);
    expect(await rpc("ledger_month_end")).toBe(3);
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe("https://x.supabase.co/rest/v1/rpc/ledger_month_end");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer key");
    await expect(rpc("x; drop")).rejects.toThrow();
  });
});
