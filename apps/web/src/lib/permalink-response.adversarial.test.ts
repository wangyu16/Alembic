/**
 * Track A.6 adversarial: the `/d/{docId}` cache must never make a private or
 * trial file cacheable by a shared cache, and no conditional answer (304) or
 * ETag may reveal that a file the visitor cannot read exists. Runs the REAL
 * access check (`resolvePermalinkAccess`) over in-memory Supabase doubles:
 * the service client sees every row, a session sees only its owner's rows.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeSourceHash } from "@alembic/package-ops";
import { resolvePermalinkAccess, type PermalinkDoc } from "./permalink-access";
import { CACHE, etagMatches, servePermalink, type PermalinkDeps } from "./permalink-response";
import { DocBytesCache } from "./doc-bytes-cache";

type Row = Record<string, unknown>;
interface World {
  packages: Array<{ id: string; owner_id: string; storage: "sandbox" | "github" }>;
  documents: PermalinkDoc[];
  /** What the repo / trial store currently holds, per docId. */
  bytes: Record<string, string>;
}

function client(world: World, viewer: string | "service" | null): SupabaseClient {
  const owns = (packageId: unknown) =>
    viewer === "service" ||
    (viewer !== null && world.packages.some((p) => p.id === packageId && p.owner_id === viewer));
  const visible = (table: string): Row[] => {
    if (table === "packages") return world.packages.filter((p) => owns(p.id));
    if (table === "documents") return world.documents.filter((d) => owns(d.package_id)) as unknown as Row[];
    return [];
  };
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => (filters.push([col, v]), q),
        maybeSingle: async () => ({
          data: visible(table).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null,
          error: null,
        }),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const OWNER = "user-owner";
const STRANGER = "user-stranger";
const V1 = "# Version one";
const H1 = computeSourceHash(V1);

function doc(doc_id: string, package_id: string, repo: "public" | "private", path = `${repo === "public" ? "study-guide" : "private"}/x.md`): PermalinkDoc {
  return { doc_id, package_id, repo, path, source_hash: H1, tombstoned: false };
}

function makeWorld(): World {
  return {
    packages: [
      { id: "pkg-trial", owner_id: OWNER, storage: "sandbox" },
      { id: "pkg-pub", owner_id: OWNER, storage: "github" },
    ],
    documents: [
      doc("doc-pubpub", "pkg-pub", "public"),
      doc("doc-pubpriv", "pkg-pub", "private"),
      doc("doc-trialpub", "pkg-trial", "public"),
      doc("doc-trialpriv", "pkg-trial", "private"),
      { ...doc("doc-gone", "pkg-pub", "public"), tombstoned: true },
    ],
    bytes: {
      "doc-pubpub": V1,
      "doc-pubpriv": V1,
      "doc-trialpub": V1,
      "doc-trialpriv": V1,
    },
  };
}

function harness(world = makeWorld()) {
  const cache = new DocBytesCache();
  const reads: string[] = [];
  const served: string[] = [];
  const service = client(world, "service");
  const deps = (viewer: string | null): PermalinkDeps => ({
    access: (docId) => resolvePermalinkAccess(docId, { session: client(world, viewer), service }),
    readBytes: async (d) => {
      reads.push(d.doc_id);
      const b = world.bytes[d.doc_id];
      return b === undefined ? null : Buffer.from(b, "utf8");
    },
    cache,
    onPublicServed: ({ doc, status }) => served.push(`${doc.doc_id}:${status}`),
  });
  const get = (param: string, viewer: string | null, headers: Record<string, string> = {}) =>
    servePermalink(param, new Headers(headers), deps(viewer));
  return { world, cache, reads, served, get };
}

const PRIVATE_OR_TRIAL = ["doc-pubpriv", "doc-trialpub", "doc-trialpriv"];
const inm = (h: string) => ({ "if-none-match": `W/"${h}"` });

describe("public answers (Track A.6)", () => {
  it("[P5.A.6.b] live: ETag = hash, CDN cache with stale-while-revalidate, CORS", async () => {
    const { get } = harness();
    const r = await get("doc-pubpub", null);
    expect(r.status).toBe(200);
    expect(r.headers.get("etag")).toBe(`W/"${H1}"`);
    expect(r.headers.get("cache-control")).toBe(CACHE.live);
    expect(r.headers.get("cache-control")).toMatch(/s-maxage=\d+, stale-while-revalidate=\d+/);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(await r.text()).toBe(V1);
  });

  it("[P5.A.6.b] pinned to the current hash: immutable", async () => {
    const { get } = harness();
    const r = await get(`doc-pubpub@${H1}`, null);
    expect(r.headers.get("cache-control")).toBe(CACHE.pinned);
    expect(r.headers.get("etag")).toBe(`W/"${H1}"`);
  });

  it("[P5.A.6.c] If-None-Match → 304 without reading the bytes at all", async () => {
    const { get, reads } = harness();
    // Loop r1b (P5.B.1.m): a 304 needs a recent verification of the hash
    // against the current bytes — the first view does it; after that, a
    // revalidation inside the window reads nothing.
    expect((await get("doc-pubpub", null)).status).toBe(200);
    reads.length = 0;
    const r = await get("doc-pubpub", null, inm(H1));
    expect(r.status).toBe(304);
    expect(await r.text()).toBe("");
    expect(r.headers.get("etag")).toBe(`W/"${H1}"`);
    expect(reads).toEqual([]);
  });

  it("[P5.A.6.d] GitHub is read once per version, not once per view", async () => {
    const { get, reads } = harness();
    for (let i = 0; i < 5; i++) expect((await get("doc-pubpub", null)).status).toBe(200);
    expect(reads).toEqual(["doc-pubpub"]);
  });

  it("[P5.A.6.e] repo ahead of the registry: served uncached, no ETag, never immutable", async () => {
    const { get, world, cache } = harness();
    world.bytes["doc-pubpub"] = "# Version two (committed on GitHub, not yet reconciled)";
    for (const param of ["doc-pubpub", `doc-pubpub@${H1}`]) {
      const r = await get(param, null);
      expect(r.status).toBe(200);
      expect(r.headers.get("etag")).toBeNull();
      expect(r.headers.get("cache-control")).toBe(CACHE.unverified);
    }
    expect(cache.size).toBe(0);
  });

  it("[P5.A.6.c] a stale If-None-Match gets the full new version", async () => {
    const { get, world } = harness();
    const v2 = "# v2";
    world.documents[0] = { ...world.documents[0]!, source_hash: computeSourceHash(v2) };
    world.bytes["doc-pubpub"] = v2;
    const r = await get("doc-pubpub", null, inm(H1));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(v2);
  });

  it("[P5.A.6.f] an older pin is not served (interim page), and that answer is not stored", async () => {
    const { get } = harness();
    const r = await get("doc-pubpub@deadbeef", null);
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe(CACHE.none);
  });
});

describe("adversarial: private and trial files are never publicly cacheable", () => {
  it("[P5.A.6.g] [P5.A.7.e] anonymous and strangers: 404, no-store, no ETag — with or without If-None-Match", async () => {
    const { get, reads, served } = harness();
    for (const id of PRIVATE_OR_TRIAL) {
      for (const viewer of [null, STRANGER]) {
        for (const headers of [{}, inm(H1), { "if-none-match": "*" }]) {
          for (const param of [id, `${id}@${H1}`]) {
            const r = await get(param, viewer, headers);
            expect(r.status, `${param} ${viewer}`).toBe(404);
            expect(r.headers.get("etag")).toBeNull();
            expect(r.headers.get("cache-control")).toBe(CACHE.none);
            expect(r.headers.get("access-control-allow-origin")).toBeNull();
          }
        }
      }
    }
    expect(reads).toEqual([]);
    expect(served).toEqual([]);
  });

  it("[P5.0.2.d] a private file's 404 is byte-identical to a missing file's (no existence oracle)", async () => {
    const { get } = harness();
    const missing = await get("doc-doesnotexist", null, inm(H1));
    const hidden = await get("doc-pubpriv", null, inm(H1));
    expect(hidden.status).toBe(missing.status);
    expect([...hidden.headers]).toEqual([...missing.headers]);
    expect(await hidden.text()).toBe(await missing.text());
  });

  it("[P5.A.6.g] [P5.A.7.e] the owner gets private, no-store — no ETag, no 304, no CORS, nothing cached", async () => {
    const { get, cache, reads, served } = harness();
    for (const id of PRIVATE_OR_TRIAL) {
      for (const param of [id, `${id}@${H1}`]) {
        const r = await get(param, OWNER, inm(H1));
        expect(r.status, param).toBe(200);
        expect(r.headers.get("cache-control")).toBe(CACHE.ownerOnly);
        expect(r.headers.get("etag")).toBeNull();
        expect(r.headers.get("access-control-allow-origin")).toBeNull();
      }
    }
    expect(cache.size).toBe(0);
    expect(reads).toHaveLength(PRIVATE_OR_TRIAL.length * 2); // fresh every time
    expect(served).toEqual([]); // no public view events for owner-only reads
  });

  it("[P5.A.6.h] a file cached while public is not served once it turns private", async () => {
    const { get, world } = harness();
    expect((await get("doc-pubpub", null)).status).toBe(200); // now in the bytes cache
    world.documents[0] = { ...world.documents[0]!, repo: "private", path: "private/x.md" };
    const r = await get("doc-pubpub", null, inm(H1));
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe(CACHE.none);
  });

  it("[P5.A.6.h] a package taken back to trial stops being cacheable at once", async () => {
    const { get, world } = harness();
    expect((await get("doc-pubpub", null)).status).toBe(200);
    world.packages[1] = { ...world.packages[1]!, storage: "sandbox" };
    expect((await get("doc-pubpub", null, inm(H1))).status).toBe(404);
    const own = await get("doc-pubpub", OWNER, inm(H1));
    expect(own.status).toBe(200);
    expect(own.headers.get("cache-control")).toBe(CACHE.ownerOnly);
  });

  it("[P5.0.2.e] tombstones answer 410 for everyone (unchanged by A.6)", async () => {
    const { get } = harness();
    expect((await get("doc-gone", null, inm(H1))).status).toBe(410);
  });

  it("[P5.A.6.j] rate limit answers first, before any lookup, and is never cached", async () => {
    const { reads } = harness();
    let looked = false;
    const r = await servePermalink("doc-pubpub", new Headers(), {
      rateLimit: async () => ({ ok: false, retryAfterSeconds: 30 }),
      access: async () => ((looked = true), { status: "not-found" }),
      readBytes: async () => null,
      cache: new DocBytesCache(),
    });
    expect(r.status).toBe(429);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(looked).toBe(false);
    expect(reads).toEqual([]);
  });
});

describe("etagMatches", () => {
  it("[P5.A.6.c] weak comparison over a list", () => {
    expect(etagMatches(`"x", W/"${H1}"`, H1)).toBe(true);
    expect(etagMatches(`"${H1}"`, H1)).toBe(true);
    expect(etagMatches(`W/"other"`, H1)).toBe(false);
    expect(etagMatches(null, H1)).toBe(false);
  });
});
