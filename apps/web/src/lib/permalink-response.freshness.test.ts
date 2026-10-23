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
