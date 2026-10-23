import { describe, expect, it } from "vitest";
import {
  clientIp,
  consumeRateLimit,
  FallbackRateStore,
  MemoryRateStore,
  PostgresRateStore,
  RATE_LIMITS,
  rateKey,
  tooManyRequests,
  type RateStore,
} from "./rate-limit";

const h = (o: Record<string, string>) => new Headers(o);

describe("rate limits (Track A.6)", () => {
  it("report: the 6th report within 10 minutes is refused, with a retry time", async () => {
    const store = new MemoryRateStore();
    const t0 = 1_000_000_000_000;
    for (let i = 0; i < 5; i++) {
      expect((await consumeRateLimit(store, "report", "k", t0 + i)).ok).toBe(true);
    }
    const sixth = await consumeRateLimit(store, "report", "k", t0 + 10);
    expect(sixth.ok).toBe(false);
    if (!sixth.ok) {
      expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
      expect(sixth.retryAfterSeconds).toBeLessThanOrEqual(600);
    }
    // another address is unaffected
    expect((await consumeRateLimit(store, "report", "other", t0 + 10)).ok).toBe(true);
  });

  it("report: the daily cap holds across 10-minute windows", async () => {
    const store = new MemoryRateStore();
    const day = 24 * 60 * 60_000;
    const t0 = Math.floor(1_000_000_000_000 / day) * day; // start of a day window
    let refused = 0;
    for (let w = 0; w < 6; w++) {
      for (let i = 0; i < 5; i++) {
        const r = await consumeRateLimit(store, "report", "k", t0 + w * 10 * 60_000 + i);
        if (!r.ok) refused++;
      }
    }
    expect(refused).toBe(30 - 20);
  });

  it("permalink: generous per-minute budget (a class behind one NAT)", async () => {
    const store = new MemoryRateStore();
    const t0 = 60_000 * 1000;
    for (let i = 0; i < RATE_LIMITS.permalink[0].limit; i++) {
      expect((await consumeRateLimit(store, "permalink", "nat", t0)).ok).toBe(true);
    }
    expect((await consumeRateLimit(store, "permalink", "nat", t0)).ok).toBe(false);
    expect((await consumeRateLimit(store, "permalink", "nat", t0 + 60_000)).ok).toBe(true);
  });

  it("memory store stays bounded under a flood of distinct keys", async () => {
    const store = new MemoryRateStore(100);
    for (let i = 0; i < 1000; i++) await store.hit(`k${i}`, 60_000, 0);
    expect(store.size).toBe(100);
  });

  it("falls back to memory when the Postgres store is unavailable", async () => {
    const broken = new PostgresRateStore({
      rpc: async () => ({ data: null, error: { message: "function does not exist" } }),
    });
    const store = new FallbackRateStore(broken, new MemoryRateStore());
    expect(await store.hit("k", 1000, 0)).toBe(1);
    expect(await store.hit("k", 1000, 0)).toBe(2);
  });

  it("uses the Postgres count when available", async () => {
    const calls: unknown[] = [];
    const pg: RateStore = new PostgresRateStore({
      rpc: async (fn, args) => (calls.push([fn, args]), { data: 7, error: null }),
    });
    expect(await pg.hit("k", 600_000, 0)).toBe(7);
    expect(calls).toEqual([["rate_limit_hit", { p_key: "k", p_window_seconds: 600 }]]);
  });

  it("keys are one-way: no address in the key, per bucket, per secret", () => {
    const k = rateKey("report", "203.0.113.9", "s1");
    expect(k).not.toContain("203.0.113.9");
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(rateKey("search", "203.0.113.9", "s1")).not.toBe(k);
    expect(rateKey("report", "203.0.113.9", "s2")).not.toBe(k);
    expect(rateKey("report", "203.0.113.9", "s1")).toBe(k);
  });

  it("client IP: first forwarded-for entry, then x-real-ip", () => {
    expect(clientIp(h({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
    expect(clientIp(h({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(h({}))).toBe("unknown");
  });

  it("a 429 is never cached and says when to retry", () => {
    const r = tooManyRequests(42);
    expect(r.status).toBe(429);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("retry-after")).toBe("42");
  });
});
