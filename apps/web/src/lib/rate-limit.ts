/**
 * Simple fixed-window rate limits for anonymous surfaces (Phase 5 Track A.6;
 * portal-governance.md "Abuse controls").
 *
 * Pure apart from `node:crypto` — no `server-only`, no `@/` paths — so the
 * limits and the key derivation are unit-tested (`rate-limit.test.ts`).
 *
 * | Bucket      | Limit per client IP                  | Store                          |
 * |-------------|--------------------------------------|--------------------------------|
 * | `report`    | 5 per 10 minutes and 20 per day      | Postgres (`rate_limit_hit`, migration 0023), in-process fallback |
 * | `permalink` | 1200 per minute (`/d/{docId}`)       | in-process (per server instance) |
 * | `search`    | 120 per minute (portal search; helper for Track A core) | in-process |
 *
 * Why these numbers: a class behind one NAT opening a document with dozens of
 * embedded figures makes hundreds of `/d` requests a minute, most of them
 * answered by the CDN; 1200/min only stops a scraper hammering the origin.
 * Reports are rare and human — a handful per visit is generous. The
 * in-process store is per serverless instance, so it is a soft limit; the
 * report limit is the one that matters and is shared through Postgres.
 *
 * Privacy: the client IP is never stored or logged. Keys are an HMAC of
 * (bucket, IP) under a server secret, so the Postgres counters (kept two days)
 * cannot be reversed to an address or joined with anything else.
 */

import { createHmac } from "node:crypto";

export interface RateRule {
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  report: [
    { limit: 5, windowMs: 10 * 60_000 },
    { limit: 20, windowMs: 24 * 60 * 60_000 },
  ],
  permalink: [{ limit: 1200, windowMs: 60_000 }],
  search: [{ limit: 120, windowMs: 60_000 }],
  // Signed-in preview renders (security loop r2, LOW-5): per USER, not per
  // address — each call renders Markdown and may resolve up to 50 includes.
  preview: [{ limit: 60, windowMs: 60_000 }],
} as const satisfies Record<string, readonly RateRule[]>;

export type RateBucket = keyof typeof RATE_LIMITS;

/** Counts hits per (key, window). Returns the count INCLUDING this hit. */
export interface RateStore {
  hit(key: string, windowMs: number, now: number): Promise<number>;
}

export type RateDecision = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * In-process fixed-window counters, bounded: past `maxKeys` the oldest entry
 * is evicted (a Map iterates in insertion order), so a flood of distinct
 * addresses cannot grow memory without bound.
 */
export class MemoryRateStore implements RateStore {
  private readonly counters = new Map<string, { windowStart: number; count: number }>();
  constructor(private readonly maxKeys = 20_000) {}

  async hit(key: string, windowMs: number, now: number): Promise<number> {
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const id = `${key}|${windowMs}`;
    const cur = this.counters.get(id);
    if (cur && cur.windowStart === windowStart) {
      cur.count += 1;
      return cur.count;
    }
    this.counters.delete(id);
    this.counters.set(id, { windowStart, count: 1 });
    while (this.counters.size > this.maxKeys) {
      const oldest = this.counters.keys().next().value as string;
      this.counters.delete(oldest);
    }
    return 1;
  }

  get size(): number {
    return this.counters.size;
  }
}

/** Try `primary` (Postgres); if it errors (not configured, migration not yet
 *  applied, network) count in `fallback` instead — a limit never fails a
 *  legitimate request just because its store is down. */
export class FallbackRateStore implements RateStore {
  constructor(
    private readonly primary: RateStore,
    private readonly fallback: RateStore,
  ) {}
  async hit(key: string, windowMs: number, now: number): Promise<number> {
    try {
      return await this.primary.hit(key, windowMs, now);
    } catch {
      return this.fallback.hit(key, windowMs, now);
    }
  }
}

/** Minimal RPC surface of a Supabase client (service role). */
export interface RpcClient {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

/** Postgres-backed counters through `rate_limit_hit` (migration 0023; the
 *  function is executable by the service role only). Throws on any error so
 *  `FallbackRateStore` takes over. */
export class PostgresRateStore implements RateStore {
  constructor(private readonly db: RpcClient) {}
  async hit(key: string, windowMs: number): Promise<number> {
    const { data, error } = await this.db.rpc("rate_limit_hit", {
      p_key: key,
      p_window_seconds: Math.max(1, Math.round(windowMs / 1000)),
    });
    if (error || typeof data !== "number") throw new Error("rate_limit_hit unavailable");
    return data;
  }
}

/**
 * The client address as the platform reports it. On Vercel the first
 * `x-forwarded-for` entry is set by the edge (a client cannot prepend to it
 * past the proxy); `x-real-ip` is the fallback. Without either (local dev)
 * every request shares one bucket.
 */
export function clientIp(headers: Pick<Headers, "get">): string {
  const xff = headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  if (first) return addressSubject(first);
  const real = headers.get("x-real-ip")?.trim();
  return real ? addressSubject(real) : "unknown";
}

/**
 * The address as a rate-limit SUBJECT (security loop r2, M4 residual): an
 * IPv6 client is counted by its /64 — one subscriber is routinely handed a
 * whole /64, so keying on the full address let one client rotate through
 * 2^64 fresh buckets. IPv4 (and IPv4-mapped IPv6) keeps the full address.
 * Anything unparseable is returned as given.
 */
export function addressSubject(raw: string): string {
  const ip = raw.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!ip.includes(":")) return ip;
  const halves = ip.split("::");
  if (halves.length > 2) return ip;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const quad = /^\d{1,3}(?:\.\d{1,3}){3}$/;
  const last = tail.length ? tail[tail.length - 1]! : head[head.length - 1] ?? "";
  // An embedded dotted quad counts as two 16-bit groups.
  const width = head.length + tail.length + (quad.test(last) ? 1 : 0);
  if (halves.length === 1 ? width !== 8 : width > 7) return ip;
  const full = [...head, ...Array<string>(8 - width).fill("0"), ...tail];
  // IPv4-mapped (::ffff:a.b.c.d): the IPv4 address itself.
  if (quad.test(last) && full.slice(0, 5).every((g) => /^0{1,4}$/.test(g)) && full[5] === "ffff") return last;
  const prefix = full.slice(0, 4);
  if (!prefix.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return ip;
  return `${prefix.map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

/** The one-way key a bucket counts under: HMAC-SHA256(secret, bucket|ip). */
export function rateKey(bucket: RateBucket, ip: string, secret: string): string {
  return createHmac("sha256", secret).update(`${bucket}|${ip}`).digest("hex").slice(0, 32);
}

/** The server secret keys are derived with. `RATE_LIMIT_SECRET` when set;
 *  otherwise the service key (never leaves the server; only a MAC of it is
 *  used); a fixed dev value as a last resort (dev keys are not shared). */
export function rateSecret(env: Record<string, string | undefined> = process.env): string {
  return env["RATE_LIMIT_SECRET"] || env["SUPABASE_SECRET_KEY"] || "alembic-dev-rate-limit";
}

/** Count one hit against every rule of the bucket; refuse when any is over. */
export async function consumeRateLimit(
  store: RateStore,
  bucket: RateBucket,
  key: string,
  now = Date.now(),
): Promise<RateDecision> {
  let retryAfterMs = 0;
  for (const rule of RATE_LIMITS[bucket]) {
    const count = await store.hit(key, rule.windowMs, now);
    if (count > rule.limit) {
      const windowEnd = (Math.floor(now / rule.windowMs) + 1) * rule.windowMs;
      retryAfterMs = Math.max(retryAfterMs, windowEnd - now);
    }
  }
  return retryAfterMs > 0
    ? { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) }
    : { ok: true };
}

/** The 429 answer for an HTTP surface: never cached, says when to retry. */
export function tooManyRequests(retryAfterSeconds: number): Response {
  return new Response("Too many requests — please wait a moment and try again.", {
    status: 429,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": String(retryAfterSeconds),
    },
  });
}
