import { describe, expect, it } from "vitest";
import { computeSourceHash } from "@alembic/package-ops";
import { bytesMatchHash, DocBytesCache, type SharedBytesLayer } from "./doc-bytes-cache";

const text = (s: string) => Buffer.from(s, "utf8");
const key = (content: string, docId = "doc-a", path = "study-guide/a.md") => ({
  docId,
  path,
  hash: computeSourceHash(content),
});

function counter(bytes: Buffer | null) {
  let calls = 0;
  return {
    load: async () => (calls++, bytes),
    get calls() {
      return calls;
    },
  };
}

/** A shared layer like Next's data cache: stores what a load returns, never a throw. */
function fakeShared(): SharedBytesLayer & { store: Map<string, Buffer> } {
  const store = new Map<string, Buffer>();
  return {
    store,
    async getOrLoad(k, load) {
      const hit = store.get(k);
      if (hit) return hit;
      const b = await load();
      store.set(k, b);
      return b;
    },
  };
}

describe("bytesMatchHash", () => {
  it("[P5.A.6.e] text: matches the registration hash of the UTF-8 content", () => {
    expect(bytesMatchHash("a.md", text("# Hi"), computeSourceHash("# Hi"))).toBe(true);
    expect(bytesMatchHash("a.md", text("# Hi!"), computeSourceHash("# Hi"))).toBe(false);
  });

  it("[P5.A.6.e] binary: matches either registration form (GitHub UTF-8 read, trial base64)", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0x10]);
    expect(bytesMatchHash("assets/x.png", png, computeSourceHash(png.toString("utf8")))).toBe(true);
    expect(bytesMatchHash("assets/x.png", png, computeSourceHash(png.toString("base64")))).toBe(true);
    // a text path does not get the base64 allowance
    expect(bytesMatchHash("a.md", png, computeSourceHash(png.toString("base64")))).toBe(false);
  });
});

describe("DocBytesCache (Track A.6)", () => {
  it("[P5.A.6.d] reads the origin once per (docId, hash), then serves from memory", async () => {
    const cache = new DocBytesCache();
    const src = counter(text("v1"));
    const k = key("v1");
    expect((await cache.get(k, src.load))?.from).toBe("origin");
    const second = await cache.get(k, src.load);
    expect(second?.from).toBe("memory");
    expect(second?.bytes.toString()).toBe("v1");
    expect(src.calls).toBe(1);
  });

  it("[P5.A.6.e] a new version is a new key — the old bytes are never served for it", async () => {
    const cache = new DocBytesCache();
    await cache.get(key("v1"), counter(text("v1")).load);
    const v2 = await cache.get(key("v2"), counter(text("v2")).load);
    expect(v2?.bytes.toString()).toBe("v2");
  });

  it("[P5.A.6.e] bytes that do not hash to the key are served but NOT cached, and flagged", async () => {
    // registry says v1; the repo already holds v2 (reconcile has not run)
    const cache = new DocBytesCache();
    const shared = fakeShared();
    const withShared = new DocBytesCache({ shared });
    const src = counter(text("v2"));
    for (const c of [cache, withShared]) {
      const got = await c.get(key("v1"), src.load);
      expect(got?.verified).toBe(false);
      expect(c.size).toBe(0);
    }
    expect(shared.store.size).toBe(0);
  });

  it("[P5.A.6.i] not found is not cached", async () => {
    const shared = fakeShared();
    const cache = new DocBytesCache({ shared });
    const src = counter(null);
    expect(await cache.get(key("v1"), src.load)).toBeNull();
    expect(await cache.get(key("v1"), src.load)).toBeNull();
    expect(src.calls).toBe(2);
    expect(shared.store.size).toBe(0);
  });

  it("[P5.A.6.d] a cold instance is served by the shared layer without the origin", async () => {
    const shared = fakeShared();
    const warm = new DocBytesCache({ shared });
    await warm.get(key("v1"), counter(text("v1")).load);
    const cold = new DocBytesCache({ shared });
    const src = counter(text("v1"));
    const got = await cold.get(key("v1"), src.load);
    expect(got?.from).toBe("shared");
    expect(src.calls).toBe(0);
  });

  it("[P5.A.6.i] files over the shared limit stay in process only", async () => {
    const shared = fakeShared();
    const cache = new DocBytesCache({ shared, sharedMaxItemBytes: 4 });
    const got = await cache.get(key("long content"), counter(text("long content")).load);
    expect(got?.verified).toBe(true);
    expect(shared.store.size).toBe(0);
    expect(cache.size).toBe(1);
  });

  it("[P5.A.6.i] a broken shared layer degrades to a direct read", async () => {
    const cache = new DocBytesCache({
      shared: { getOrLoad: async () => { throw new Error("incrementalCache missing"); } },
    });
    const got = await cache.get(key("v1"), counter(text("v1")).load);
    expect(got).toMatchObject({ verified: true, from: "origin" });
  });

  it("[P5.A.6.d] concurrent misses share one origin read", async () => {
    const cache = new DocBytesCache();
    const src = counter(text("v1"));
    const results = await Promise.all([1, 2, 3].map(() => cache.get(key("v1"), src.load)));
    expect(results.every((r) => r?.bytes.toString() === "v1")).toBe(true);
    expect(src.calls).toBe(1);
  });

  it("[P5.A.6.i] memory is bounded by total bytes (least recently used goes first)", async () => {
    const cache = new DocBytesCache({ maxBytes: 10 });
    for (const v of ["aaaa", "bbbb", "cccc"]) {
      await cache.get(key(v, `doc-${v}`), counter(text(v)).load);
    }
    expect(cache.size).toBe(2);
    expect(cache.has(key("aaaa", "doc-aaaa"))).toBe(false);
    expect(cache.has(key("cccc", "doc-cccc"))).toBe(true);
  });
});

describe("DocBytesCache verification record (closed loop r3, LOW)", () => {
  const verified = (c: DocBytesCache) => (c as unknown as { verifiedAt: Map<string, number> }).verifiedAt.size;

  it("[P5.A.6.q] entries older than the window are dropped, so the record does not grow with every version ever viewed", async () => {
    let now = 1_000_000;
    const cache = new DocBytesCache({ now: () => now, maxBytes: 1024 });
    for (let i = 0; i < 500; i++) {
      const c = `# v${i}`;
      await cache.revalidate(key(c, `doc-${i}`), async () => text(c));
    }
    expect(verified(cache)).toBe(500);
    now += DocBytesCache.REVALIDATE_MS + 1;
    await cache.revalidate(key("# late", "doc-late"), async () => text("# late"));
    expect(verified(cache)).toBe(1);
  });

  it("[P5.A.6.q] within the window it holds at most maxVerified entries (oldest first out), via revalidate and get", async () => {
    const now = 1_000_000;
    const cache = new DocBytesCache({ now: () => now, maxVerified: 100 });
    for (let i = 0; i < 300; i++) {
      const c = `# w${i}`;
      if (i % 2) await cache.revalidate(key(c, `doc-${i}`), async () => text(c));
      else await cache.get(key(c, `doc-${i}`), async () => text(c));
    }
    expect(verified(cache)).toBe(100);
    // The newest is still verified (a conditional answer needs no re-read).
    let reads = 0;
    await cache.revalidate(key("# w299", "doc-299"), async () => (reads++, text("# w299")));
    expect(reads).toBe(0);
  });

  it("[P5.A.6.q] by default it holds at most 10,000 verification records", async () => {
    const now = 1_000_000;
    const cache = new DocBytesCache({ now: () => now, maxBytes: 1024 });
    for (let i = 0; i <= 10_000; i++) {
      const c = `# d${i}`;
      await cache.revalidate(key(c, `doc-${i}`), async () => text(c));
    }
    expect(verified(cache)).toBe(10_000);
    let reads = 0;
    await cache.revalidate(key("# d0", "doc-0"), async () => (reads++, text("# d0")));
    expect(reads).toBe(1); // the oldest went out: re-read, not 'fresh' on its say-so
    await cache.revalidate(key("# d10000", "doc-10000"), async () => (reads++, text("# d10000")));
    expect(reads).toBe(1); // the newest is still verified
  });
});
