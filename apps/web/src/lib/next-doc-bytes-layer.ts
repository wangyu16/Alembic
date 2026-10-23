import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import type { SharedBytesLayer } from "@/lib/doc-bytes-cache";

/** One cache tag per entry, so a single key can be evicted. */
const tagFor = (key: string) => `alembic-doc-bytes:${key}`;

/**
 * The shared layer of the `/d` bytes cache: Next's data cache (on Vercel, the
 * platform's shared cache — no extra service). Entries are keyed by
 * `{docId}@{hash}`, so a new file version is a new key; the one-day revalidate
 * only bounds how long an unused entry lingers. A thrown load is not cached
 * (only verified bytes are stored — `DocBytesCache` throws for everything
 * else). When a revalidation finds the file moved on while the registry did
 * not, the entry is evicted (loop r2, P5.A.6.o) — expired at once
 * (`expire: 0`), not served stale while it refreshes.
 */
export const nextDocBytesLayer: SharedBytesLayer = {
  async getOrLoad(key, load) {
    const cached = unstable_cache(
      async () => (await load()).toString("base64"),
      ["alembic-doc-bytes", key],
      { revalidate: 86_400, tags: [tagFor(key)] },
    );
    return Buffer.from(await cached(), "base64");
  },
  evict(key) {
    try {
      revalidateTag(tagFor(key), { expire: 0 });
    } catch (err) {
      console.warn("[doc-bytes] shared eviction failed:", err instanceof Error ? err.message : err);
    }
  },
};
