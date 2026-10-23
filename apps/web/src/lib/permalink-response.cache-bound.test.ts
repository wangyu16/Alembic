/**
 * Security loop r1, finding M3: a taken-down, tombstoned or privatised file
 * must stop being served by every SHARED cache (the CDN, a school proxy)
 * within the documented takedown bound. Before the fix a pinned `/d/{doc}@{hash}`
 * answer was `public, max-age=31536000, immutable`, so the CDN could keep
 * serving it for a year after the educator removed it.
 *
 * `sharedLifetimeSeconds` reads the answer the way a shared cache does: the
 * CDN-specific headers (`Vercel-CDN-Cache-Control`, `CDN-Cache-Control`) and
 * `Cache-Control` (`s-maxage`, else `max-age` when `public`); stale windows
 * (`stale-while-revalidate`, `stale-if-error`) count towards the lifetime,
 * because a stale copy is still served. The longest of them is the answer's
 * shared lifetime.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeSourceHash } from "@alembic/package-ops";
import type { PermalinkAccess, PermalinkDoc } from "./permalink-access";
import { servePermalink, TAKEDOWN_BOUND_SECONDS, type PermalinkDeps } from "./permalink-response";
import { DocBytesCache } from "./doc-bytes-cache";

function directives(value: string | null): Map<string, string | true> {
  const m = new Map<string, string | true>();
  for (const part of (value ?? "").split(",")) {
    const [k, v] = part.trim().split("=");
    if (k) m.set(k.toLowerCase(), v === undefined ? true : v.replace(/^"|"$/g, ""));
  }
  return m;
}

const num = (v: string | true | undefined) => (typeof v === "string" ? Number(v) : 0);

/** Seconds any shared cache may keep serving this answer (Infinity = unbounded). */
function sharedLifetimeSeconds(headers: Headers): number {
  const lifetimes: number[] = [];
  const stale = (d: Map<string, string | true>) =>
    num(d.get("stale-while-revalidate")) + num(d.get("stale-if-error"));

  // CDN-targeted headers (RFC 9213): max-age is the shared lifetime there.
  for (const name of ["vercel-cdn-cache-control", "cdn-cache-control"]) {
    const raw = headers.get(name);
    if (raw === null) continue;
    const d = directives(raw);
    if (d.has("no-store") || d.has("private")) continue;
    const age = d.get("s-maxage") ?? d.get("max-age");
    lifetimes.push(age === undefined ? Infinity : num(age) + stale(d));
  }

  // Cache-Control, as seen by any shared cache that ignores the CDN headers.
  const cc = headers.get("cache-control");
  if (cc === null) {
    lifetimes.push(Infinity); // heuristic freshness — unbounded
  } else {
    const d = directives(cc);
    if (!d.has("no-store") && !d.has("private")) {
      const age = d.get("s-maxage") ?? d.get("max-age");
      if (age !== undefined) lifetimes.push(num(age) + stale(d));
      else if (d.has("public")) lifetimes.push(Infinity);
      else if (!d.has("no-cache")) lifetimes.push(Infinity);
    }
  }
  return lifetimes.length ? Math.max(...lifetimes) : 0;
}

const V1 = "# Version one";
const H1 = computeSourceHash(V1);
const db = {} as SupabaseClient;

function doc(over: Partial<PermalinkDoc> = {}): PermalinkDoc {
  return {
    doc_id: "doc-pub",
    package_id: "pkg-pub",
    repo: "public",
    path: "study-guide/x.md",
    source_hash: H1,
    tombstoned: false,
    ...over,
  };
}

interface Case {
  kind: string;
  param: string;
  access: PermalinkAccess;
  bytes?: string | null;
  headers?: Record<string, string>;
  rateLimited?: boolean;
  status: number;
}

const ok = (d: PermalinkDoc, ownerOnly = false): PermalinkAccess => ({ status: "ok", doc: d, db, ownerOnly });

/** Every kind of answer the builder can produce. */
const CASES: Case[] = [
  { kind: "public pinned", param: `doc-pub@${H1}`, access: ok(doc()), status: 200 },
  { kind: "public pinned 304", param: `doc-pub@${H1}`, access: ok(doc()), headers: { "if-none-match": `W/"${H1}"` }, status: 304 },
  { kind: "public live", param: "doc-pub", access: ok(doc()), status: 200 },
  { kind: "public live 304", param: "doc-pub", access: ok(doc()), headers: { "if-none-match": `W/"${H1}"` }, status: 304 },
  { kind: "public, bytes ahead of registry", param: "doc-pub", access: ok(doc()), bytes: "# v2", status: 200 },
  { kind: "public pinned, bytes ahead of registry", param: `doc-pub@${H1}`, access: ok(doc()), bytes: "# v2", status: 200 },
  { kind: "public, no registry hash", param: "doc-pub", access: ok(doc({ source_hash: null })), status: 200 },
  { kind: "public, bytes missing", param: "doc-pub", access: ok(doc()), bytes: null, status: 404 },
  { kind: "public, no hash, bytes missing", param: "doc-pub", access: ok(doc({ source_hash: null })), bytes: null, status: 404 },
  { kind: "older pin", param: "doc-pub@deadbeef", access: ok(doc()), status: 404 },
  { kind: "not found", param: "doc-nope", access: { status: "not-found" }, status: 404 },
  { kind: "tombstone", param: "doc-gone", access: { status: "gone" }, status: 410 },
  { kind: "tombstone, pinned", param: `doc-gone@${H1}`, access: { status: "gone" }, status: 410 },
  { kind: "owner-only", param: "doc-priv", access: ok(doc({ repo: "private", path: "private/x.md" }), true), status: 200 },
  { kind: "owner-only pinned", param: `doc-priv@${H1}`, access: ok(doc({ repo: "private" }), true), headers: { "if-none-match": `W/"${H1}"` }, status: 200 },
  { kind: "owner-only, bytes missing", param: "doc-priv", access: ok(doc({ repo: "private" }), true), bytes: null, status: 404 },
  { kind: "rate limited", param: "doc-pub", access: ok(doc()), rateLimited: true, status: 429 },
];

async function answer(c: Case): Promise<Response> {
  const bytes = c.bytes === undefined ? V1 : c.bytes;
  const deps: PermalinkDeps = {
    rateLimit: async () => (c.rateLimited ? { ok: false, retryAfterSeconds: 5 } : { ok: true }),
    access: async () => c.access,
    readBytes: async () => (bytes === null ? null : Buffer.from(bytes, "utf8")),
    cache: new DocBytesCache(),
  };
  return servePermalink(c.param, new Headers(c.headers ?? {}), deps);
}

describe("/d takedown bound (security loop r1, M3)", () => {
  it("[P5.S.4.a] pinned answers are CDN-bounded", async () => {
    for (const c of CASES.filter((x) => x.kind.startsWith("public pinned"))) {
      const r = await answer(c);
      expect(r.status, c.kind).toBe(c.status);
      expect(sharedLifetimeSeconds(r.headers), c.kind).toBeLessThanOrEqual(TAKEDOWN_BOUND_SECONDS);
    }
    expect(TAKEDOWN_BOUND_SECONDS).toBe(300);
  });

  it("[P5.S.4.b] no permalink answer of any kind outlives the takedown bound in a shared cache", async () => {
    for (const c of CASES) {
      const r = await answer(c);
      expect(r.status, c.kind).toBe(c.status);
      expect(r.headers.get("cache-control"), `${c.kind}: explicit Cache-Control`).not.toBeNull();
      expect(sharedLifetimeSeconds(r.headers), c.kind).toBeLessThanOrEqual(TAKEDOWN_BOUND_SECONDS);
    }
  });

  it("[P5.S.4.b] the lifetime reader counts what a shared cache would keep", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(sharedLifetimeSeconds(h({ "cache-control": "public, max-age=31536000, immutable" }))).toBe(31536000);
    expect(sharedLifetimeSeconds(h({ "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400" }))).toBe(86700);
    expect(sharedLifetimeSeconds(h({ "cache-control": "private, max-age=31536000, immutable", "cdn-cache-control": "max-age=300" }))).toBe(300);
    expect(sharedLifetimeSeconds(h({ "cache-control": "private, no-store" }))).toBe(0);
    expect(sharedLifetimeSeconds(h({ "cache-control": "no-store", "vercel-cdn-cache-control": "max-age=9999" }))).toBe(9999);
    expect(sharedLifetimeSeconds(h({}))).toBe(Infinity);
  });
});
