import { describe, expect, it } from "vitest";
import {
  addressSubject,
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
  it("[P5.A.6.k] report: the 6th report within 10 minutes is refused, with a retry time", async () => {
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

  it("[P5.A.6.k] report: the daily cap holds across 10-minute windows", async () => {
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

  it("[P5.A.6.l] permalink: generous per-minute budget (a class behind one NAT)", async () => {
    const store = new MemoryRateStore();
    const t0 = 60_000 * 1000;
    for (let i = 0; i < RATE_LIMITS.permalink[0].limit; i++) {
      expect((await consumeRateLimit(store, "permalink", "nat", t0)).ok).toBe(true);
    }
    expect((await consumeRateLimit(store, "permalink", "nat", t0)).ok).toBe(false);
    expect((await consumeRateLimit(store, "permalink", "nat", t0 + 60_000)).ok).toBe(true);
  });

  it("[P5.A.6.n] memory store stays bounded under a flood of distinct keys", async () => {
    const store = new MemoryRateStore(100);
    for (let i = 0; i < 1000; i++) await store.hit(`k${i}`, 60_000, 0);
    expect(store.size).toBe(100);
  });

  it("[P5.A.6.n] falls back to memory when the Postgres store is unavailable", async () => {
    const broken = new PostgresRateStore({
      rpc: async () => ({ data: null, error: { message: "function does not exist" } }),
    });
    const store = new FallbackRateStore(broken, new MemoryRateStore());
    expect(await store.hit("k", 1000, 0)).toBe(1);
    expect(await store.hit("k", 1000, 0)).toBe(2);
  });

  it("[P5.A.6.n] uses the Postgres count when available", async () => {
    const calls: unknown[] = [];
    const pg: RateStore = new PostgresRateStore({
      rpc: async (fn, args) => (calls.push([fn, args]), { data: 7, error: null }),
    });
    expect(await pg.hit("k", 600_000, 0)).toBe(7);
    expect(calls).toEqual([["rate_limit_hit", { p_key: "k", p_window_seconds: 600 }]]);
  });

  it("[P5.A.6.n] keys are one-way: no address in the key, per bucket, per secret", () => {
    const k = rateKey("report", "203.0.113.9", "s1");
    expect(k).not.toContain("203.0.113.9");
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(rateKey("search", "203.0.113.9", "s1")).not.toBe(k);
    expect(rateKey("report", "203.0.113.9", "s2")).not.toBe(k);
    expect(rateKey("report", "203.0.113.9", "s1")).toBe(k);
  });

  it("[P5.A.6.n] client IP: first forwarded-for entry, then x-real-ip", () => {
    expect(clientIp(h({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
    expect(clientIp(h({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(h({}))).toBe("unknown");
  });

  it("[P5.A.6.j] a 429 is never cached and says when to retry", () => {
    const r = tooManyRequests(42);
    expect(r.status).toBe(429);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("retry-after")).toBe("42");
  });
});

describe("M4 residual (loop r2): an IPv6 client is one subject per /64", () => {
  const h = (ip: string) => new Headers({ "x-forwarded-for": ip });

  it("[P5.S.5.c] addresses in one /64 share a rate-limit key; another /64 does not", () => {
    const secret = "s";
    const a = rateKey("report", clientIp(h("2001:db8:1:2:aaaa:bbbb:cccc:1")), secret);
    const b = rateKey("report", clientIp(h("2001:db8:1:2::ffff")), secret);
    const c = rateKey("report", clientIp(h("2001:0db8:0001:0002:0:0:0:9")), secret);
    const other = rateKey("report", clientIp(h("2001:db8:1:3::1")), secret);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(other).not.toBe(a);
  });

  it("[P5.S.5.c] IPv4 and IPv4-mapped IPv6 keep the full address; junk passes through", () => {
    expect(addressSubject("198.51.100.7")).toBe("198.51.100.7");
    expect(addressSubject("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(addressSubject("[2001:db8::1]")).toBe("2001:db8:0:0::/64");
    expect(addressSubject("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(addressSubject("::1")).toBe("0:0:0:0::/64");
    expect(addressSubject("not-an-ip")).toBe("not-an-ip");
    expect(addressSubject("1:2:3")).toBe("1:2:3");
  });

  it("[P5.S.5.c] a client rotating through its /64 is capped like one client", async () => {
    const store = new MemoryRateStore();
    const now = Date.UTC(2026, 9, 23, 12, 0, 0);
    const results: boolean[] = [];
    for (let i = 1; i <= 7; i++) {
      const key = rateKey("report", clientIp(h(`2001:db8:1:2::${i.toString(16)}`)), "s");
      results.push((await consumeRateLimit(store, "report", key, now)).ok);
    }
    expect(results).toEqual([true, true, true, true, true, false, false]);
  });
});
