/**
 * Server-side cache of a PUBLIC permalink's bytes, keyed by (docId, source
 * hash) — Phase 5 Track A.6. With it, `/d/{docId}` reads GitHub once per
 * file version instead of once per view.
 *
 * Two layers, both optional, no new service:
 *  1. an in-process LRU bounded by total bytes (per server instance);
 *  2. a shared layer injected by the caller (the route uses Next's data
 *     cache, `lib/next-doc-bytes-layer.ts`) for small files, so a cold
 *     instance does not go to GitHub either.
 * Concurrent misses for one key share a single load.
 *
 * **Only verified bytes are cached.** The key is the registry's hash, but the
 * bytes come from the repo's current head; when someone committed to GitHub
 * and reconcile has not run yet, the two disagree. `bytesMatchHash` recomputes
 * the registration hash over the fetched bytes; a mismatch is served (as
 * before) but never cached and never labelled with that hash (no ETag, no
 * `immutable`). This keeps a pinned `@{hash}` from ever being cached with
 * bytes of another version.
 *
 * Callers must use this ONLY for answers anyone may read (public file of a
 * published package). Owner-only answers never touch it — enforced in
 * `lib/permalink-response.ts` and pinned by its adversarial tests.
 *
 * Pure apart from the injected loader/layer — unit-tested.
 */

import { computeSourceHash } from "@alembic/package-ops";
import { isBinaryPath } from "./collection-upload";

export interface DocBytesKey {
  docId: string;
  /** The registry's `source_hash` for the version being served. */
  hash: string;
  /** Repo path (decides how the registration hashed a binary). */
  path: string;
}

/** A shared get-or-load layer. `load` THROWS when its result must not be
 *  stored; the layer must not cache a thrown load. */
export interface SharedBytesLayer {
  getOrLoad(key: string, load: () => Promise<Buffer>): Promise<Buffer>;
  /** Drop `key` (best-effort): called when a revalidation finds the bytes
   *  stored under it are no longer the file's current bytes (loop r2,
   *  P5.A.6.o), so cold instances stop being offered the old copy. */
  evict?(key: string): void | Promise<void>;
}

export interface CachedBytes {
  bytes: Buffer;
  /** The bytes hash to the requested registry hash. */
  verified: boolean;
  from: "memory" | "shared" | "origin";
}

/**
 * Do these bytes hash to the registry's `source_hash`? The registration hashes
 * a string: UTF-8 text for text files and for binaries read from GitHub, the
 * base64 text for binaries read from a trial store — both forms are derived
 * from the bytes, so both are tried for a binary path.
 */
export function bytesMatchHash(path: string, bytes: Buffer, hash: string): boolean {
  if (computeSourceHash(bytes.toString("utf8")) === hash) return true;
  return isBinaryPath(path) && computeSourceHash(bytes.toString("base64")) === hash;
}

class NotStored extends Error {
  constructor(readonly result: { bytes: Buffer; verified: boolean } | null) {
    super("not stored");
  }
}

export interface DocBytesCacheOptions {
  /** Total bytes the in-process layer may hold (default 64 MB). */
  maxBytes?: number;
  /** Largest single file kept in process (default 8 MB). */
  maxItemBytes?: number;
  /** Shared layer, and the largest file it may hold (default 1 MB — Next's
   *  data cache refuses items over ~2 MB, and base64 inflates by a third). */
  shared?: SharedBytesLayer;
  sharedMaxItemBytes?: number;
  /** Clock (tests). */
  now?: () => number;
}

/** What `revalidate` found. `fresh.bytes` is set when this call read the
 *  origin (so the caller need not read it again). */
export type Revalidation =
  | { status: "fresh"; bytes?: Buffer }
  | { status: "stale"; bytes: Buffer }
  | null;

export class DocBytesCache {
  private readonly lru = new Map<string, Buffer>();
  private total = 0;
  private readonly inflight = new Map<string, Promise<CachedBytes | null>>();
  private readonly maxBytes: number;
  private readonly maxItemBytes: number;
  private readonly sharedMaxItemBytes: number;
  /** When each key was last verified against bytes read from ORIGIN. */
  private readonly verifiedAt = new Map<string, number>();
  private readonly now: () => number;

  /**
   * How long an origin verification licenses a conditional (304) answer
   * (loop r1b, P5.B.1.m). Past it, a revalidation re-reads the file.
   */
  static readonly REVALIDATE_MS = 60_000;

  constructor(private readonly opts: DocBytesCacheOptions = {}) {
    this.maxBytes = opts.maxBytes ?? 64 * 1024 * 1024;
    this.maxItemBytes = opts.maxItemBytes ?? 8 * 1024 * 1024;
    this.sharedMaxItemBytes = opts.sharedMaxItemBytes ?? 1024 * 1024;
    this.now = opts.now ?? Date.now;
  }

  /**
   * May a conditional request for `key` be answered 304? Only if `key`'s hash
   * was verified against the file's CURRENT bytes (read from origin) within
   * `REVALIDATE_MS` (loop r1b, P5.B.1.m) — the shared layer's copy proves
   * only that those bytes once had that hash, not that the file still does.
   * Otherwise re-read: a match → "fresh" (and remembered); a mismatch → the
   * registry is stale, the remembered copy is dropped from this instance and
   * the current bytes are returned to be served unlabelled, and the shared
   * layer's copy is evicted too (loop r2, P5.A.6.o); null → not found.
   *
   * The plain (200) answer uses this as well (loop r2, P5.A.6.o): an
   * unpinned answer is served under the registry hash only while that hash
   * was verified within the window on this instance.
   */
  async revalidate(key: DocBytesKey, load: () => Promise<Buffer | null>): Promise<Revalidation> {
    const id = DocBytesCache.keyOf(key);
    const at = this.verifiedAt.get(id);
    if (at !== undefined && this.now() - at < DocBytesCache.REVALIDATE_MS) {
      return { status: "fresh" };
    }
    const bytes = await load();
    if (bytes === null) return null;
    if (bytesMatchHash(key.path, bytes, key.hash)) {
      this.verifiedAt.set(id, this.now());
      this.remember(id, bytes);
      await this.storeShared(id, bytes);
      return { status: "fresh", bytes };
    }
    this.forget(id);
    this.evictShared(id);
    return { status: "stale", bytes };
  }

  /** Offer verified bytes to the shared layer (for pinned reads on cold
   *  instances). Best-effort. */
  private async storeShared(id: string, bytes: Buffer): Promise<void> {
    const shared = this.opts.shared;
    if (!shared || bytes.length > this.sharedMaxItemBytes) return;
    try {
      await shared.getOrLoad(id, async () => bytes);
    } catch {
      // the shared layer is optional
    }
  }

  private evictShared(id: string): void {
    const evict = this.opts.shared?.evict;
    if (!evict) return;
    try {
      void Promise.resolve(evict.call(this.opts.shared, id)).catch(() => {});
    } catch {
      // best-effort: the shared copy then ages out on its own
    }
  }

  private forget(id: string): void {
    this.verifiedAt.delete(id);
    const buf = this.lru.get(id);
    if (buf) {
      this.lru.delete(id);
      this.total -= buf.length;
    }
  }

  static keyOf(k: DocBytesKey): string {
    return `${k.docId}@${k.hash}`;
  }

  /** Bytes for the key: from a layer, or `load()` (null = not found). */
  async get(key: DocBytesKey, load: () => Promise<Buffer | null>): Promise<CachedBytes | null> {
    const id = DocBytesCache.keyOf(key);
    const hit = this.lru.get(id);
    if (hit) {
      this.lru.delete(id); // refresh recency
      this.lru.set(id, hit);
      return { bytes: hit, verified: true, from: "memory" };
    }
    const pending = this.inflight.get(id);
    if (pending) return pending;
    const p = this.miss(id, key, load).finally(() => this.inflight.delete(id));
    this.inflight.set(id, p);
    return p;
  }

  private async miss(
    id: string,
    key: DocBytesKey,
    load: () => Promise<Buffer | null>,
  ): Promise<CachedBytes | null> {
    let result: CachedBytes | null = null;
    const loadVerified = async (): Promise<{ bytes: Buffer; verified: boolean } | null> => {
      const bytes = await load();
      return bytes ? { bytes, verified: bytesMatchHash(key.path, bytes, key.hash) } : null;
    };

    const shared = this.opts.shared;
    if (shared) {
      try {
        let loaded = false;
        const bytes = await shared.getOrLoad(id, async () => {
          loaded = true;
          const r = await loadVerified();
          if (!r || !r.verified || r.bytes.length > this.sharedMaxItemBytes) throw new NotStored(r);
          return r.bytes;
        });
        // Whatever the shared layer returns was stored by a verified load.
        result = { bytes, verified: true, from: loaded ? "origin" : "shared" };
      } catch (e) {
        if (e instanceof NotStored) {
          result = e.result ? { ...e.result, from: "origin" } : null;
        } else {
          // The shared layer itself failed (not available here): load directly.
          const r = await loadVerified();
          result = r ? { ...r, from: "origin" } : null;
        }
      }
    } else {
      const r = await loadVerified();
      result = r ? { ...r, from: "origin" } : null;
    }

    if (result?.verified) {
      this.remember(id, result.bytes);
      if (result.from === "origin") this.verifiedAt.set(id, this.now());
    }
    return result;
  }

  private remember(id: string, bytes: Buffer): void {
    if (this.lru.has(id)) return;
    if (bytes.length > this.maxItemBytes || bytes.length > this.maxBytes) return;
    this.lru.set(id, bytes);
    this.total += bytes.length;
    while (this.total > this.maxBytes) {
      const [oldest, buf] = this.lru.entries().next().value as [string, Buffer];
      this.lru.delete(oldest);
      this.total -= buf.length;
    }
  }

  /** For tests and diagnostics. */
  get size(): number {
    return this.lru.size;
  }
  has(key: DocBytesKey): boolean {
    return this.lru.has(DocBytesCache.keyOf(key));
  }
}
