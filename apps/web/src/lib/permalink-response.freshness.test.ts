/**
 * Loop r1b (HIGH-1 sibling, P5.B.1.m): `/d/{docId}` must not answer 304 for
 * an ETag unless the registry hash was verified against the file's CURRENT
 * bytes recently. Before r1b a stale registry row (a save that never
 * registered) made every revalidation 304 — the old version forever, at the
 * CDN and in browsers.
 *
 * (Touches the other fix agent's area — `/d` cache headers — minimally: only
 * the conditional branch; headers are unchanged.)
 */
import { describe, expect, it } from "vitest";
import { computeSourceHash } from "@alembic/package-ops";
import type { PermalinkDoc } from "./permalink-access";
import { CACHE, servePermalink, type PermalinkDeps } from "./permalink-response";
import { DocBytesCache } from "./doc-bytes-cache";

const OLD = "# Ch1\n\nOld text\n";
const NEW = "# Ch1\n\nNEW text\n";
const H_OLD = computeSourceHash(OLD);

function deps(current: () => string, cache = new DocBytesCache()) {
  let reads = 0;
  const doc: PermalinkDoc = {
    doc_id: "doc-p6yeztm4k2k7",
    package_id: "pkg-x",
    repo: "public",
    path: "study-guide/ch1.md",
    source_hash: H_OLD, // the registry row
    tombstoned: false,
  };
  const d: PermalinkDeps = {
    access: async () => ({ status: "ok", doc, ownerOnly: false, db: null as never }),
    readBytes: async () => {
      reads++;
      return Buffer.from(current(), "utf8");
    },
    cache,
  } as PermalinkDeps;
  return { d, reads: () => reads, cache };
}

const conditional = new Headers({ "if-none-match": `W/"${H_OLD}"` });

describe("/d conditional answers are verified against the current bytes", () => {
  it("[P5.B.1.m] a stale registry hash never yields 304: the current bytes are served, unlabelled", async () => {
    const { d } = deps(() => NEW); // the file moved on; the registry did not
    const res = await servePermalink("doc-p6yeztm4k2k7", conditional, d);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(NEW);
    expect(res.headers.get("etag")).toBeNull();
    expect(res.headers.get("cache-control")).toBe(CACHE.unverified);
  });

  it("[P5.B.1.m] a matching ETag is 304 only after a recent verification, then without re-reading", async () => {
    const { d, reads } = deps(() => OLD);
    const first = await servePermalink("doc-p6yeztm4k2k7", conditional, d);
    expect(first.status).toBe(304);
    expect(reads()).toBe(1); // verified against the current bytes once
    const second = await servePermalink("doc-p6yeztm4k2k7", conditional, d);
    expect(second.status).toBe(304);
    expect(reads()).toBe(1); // within the window: no origin read
  });

  it("[P5.B.1.m] once the window has passed, a revalidation re-reads and notices a change", async () => {
    let bytes = OLD;
    let now = 1_000_000;
    const cache = new DocBytesCache({ now: () => now });
    const { d } = deps(() => bytes, cache);
    expect((await servePermalink("doc-p6yeztm4k2k7", conditional, d)).status).toBe(304);
    bytes = NEW;
    now += DocBytesCache.REVALIDATE_MS + 1;
    const res = await servePermalink("doc-p6yeztm4k2k7", conditional, d);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(NEW);
    // and a plain GET no longer serves the remembered old bytes either
    const plain = await servePermalink("doc-p6yeztm4k2k7", new Headers(), d);
    expect(await plain.text()).toBe(NEW);
  });
});

/**
 * Loop r2 (MEDIUM-2, P5.A.6.o): the plain-GET (200) path is bounded by the
 * same 60 s verification window as the 304 path. Before r2 an in-process LRU
 * hit, or a cold instance's shared-layer hit, was served as verified forever:
 * after a save whose registration failed, `/d` kept serving the OLD text with
 * the old ETag (from every warm instance and from every cold one).
 */
describe("/d plain answers are verified against the current bytes", () => {
  function sharedLayer() {
    const map = new Map<string, Buffer>();
    const evicted: string[] = [];
    return {
      map,
      evicted,
      layer: {
        async getOrLoad(k: string, load: () => Promise<Buffer>) {
          const hit = map.get(k);
          if (hit) return hit;
          const b = await load();
          map.set(k, b);
          return b;
        },
        evict(k: string) {
          evicted.push(k);
          map.delete(k);
        },
      },
    };
  }

  it("[P5.A.6.o] after the window a warm instance and a cold one both serve the NEW bytes, unlabelled; onStale fires; the shared copy is evicted", async () => {
    let bytes = OLD;
    let now = 1_000_000;
    const shared = sharedLayer();
    const stale: string[] = [];
    const a = deps(() => bytes, new DocBytesCache({ shared: shared.layer, now: () => now }));
    a.d.onStale = (doc) => stale.push(doc.doc_id);
    const warm = await servePermalink("doc-p6yeztm4k2k7", new Headers(), a.d);
    expect(warm.headers.get("etag")).toBe(`W/"${H_OLD}"`);
    expect(shared.map.size).toBe(1);

    bytes = NEW; // a save whose registration failed: the registry stays at H_OLD
    now += DocBytesCache.REVALIDATE_MS + 1;

    const fromA = await servePermalink("doc-p6yeztm4k2k7", new Headers(), a.d);
    expect(await fromA.text()).toBe(NEW);
    expect(fromA.headers.get("etag")).toBeNull();
    expect(fromA.headers.get("cache-control")).toBe(CACHE.unverified);
    expect(stale).toEqual(["doc-p6yeztm4k2k7"]);
    expect(shared.evicted).toEqual([DocBytesCache.keyOf({ docId: "doc-p6yeztm4k2k7", hash: H_OLD, path: "study-guide/ch1.md" })]);

    // A cold instance whose shared layer still held the old copy.
    const shared2 = sharedLayer();
    shared2.map.set(`doc-p6yeztm4k2k7@${H_OLD}`, Buffer.from(OLD, "utf8"));
    const b = deps(() => bytes, new DocBytesCache({ shared: shared2.layer, now: () => now }));
    const fromB = await servePermalink("doc-p6yeztm4k2k7", new Headers(), b.d);
    expect(await fromB.text()).toBe(NEW);
    expect(fromB.headers.get("etag")).toBeNull();
    expect(shared2.map.size).toBe(0);
  });

  it("[P5.A.6.o] within the window a warm plain GET does not re-read the origin (cost bound)", async () => {
    let now = 1_000_000;
    const { d, reads } = deps(() => OLD, new DocBytesCache({ now: () => now }));
    for (let i = 0; i < 5; i++) {
      const r = await servePermalink("doc-p6yeztm4k2k7", new Headers(), d);
      expect(r.headers.get("etag")).toBe(`W/"${H_OLD}"`);
      now += 10_000;
    }
    expect(reads()).toBe(1); // 0 s … 40 s: one origin read
    now += DocBytesCache.REVALIDATE_MS;
    await servePermalink("doc-p6yeztm4k2k7", new Headers(), d);
    expect(reads()).toBe(2); // past the window: one re-verification, not two reads
  });

  it("[P5.A.6.o] a pinned request is served from cached bytes without re-reading the origin", async () => {
    let now = 1_000_000;
    const { d, reads } = deps(() => OLD, new DocBytesCache({ now: () => now }));
    await servePermalink(`doc-p6yeztm4k2k7@${H_OLD}`, new Headers(), d);
    expect(reads()).toBe(1);
    now += 24 * 3600 * 1000;
    const r = await servePermalink(`doc-p6yeztm4k2k7@${H_OLD}`, new Headers(), d);
    expect(r.headers.get("etag")).toBe(`W/"${H_OLD}"`);
    expect(await r.text()).toBe(OLD);
    expect(reads()).toBe(1);
  });
});
