import "server-only";
import { unstable_cache } from "next/cache";
import type { SharedBytesLayer } from "@/lib/doc-bytes-cache";

/**
 * The shared layer of the `/d` bytes cache: Next's data cache (on Vercel, the
 * platform's shared cache — no extra service). Entries are keyed by
 * `{docId}@{hash}`, so a new file version is a new key and nothing needs
 * invalidating; the one-day revalidate only bounds how long an unused entry
 * lingers. A thrown load is not cached (only verified bytes are stored —
 * `DocBytesCache` throws for everything else).
 */
export const nextDocBytesLayer: SharedBytesLayer = {
  async getOrLoad(key, load) {
    const cached = unstable_cache(
      async () => (await load()).toString("base64"),
      ["alembic-doc-bytes", key],
      { revalidate: 86_400 },
    );
    return Buffer.from(await cached(), "base64");
  },
};
