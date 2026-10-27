/**
 * The SourceStore seam (workspace v3, B4; interface I9): where source FILES
 * live — Cloudflare R2 in testing and production (R27), an in-memory fake in
 * tests. Only the server holds credentials; members get 60-second signed
 * links issued after `can(role, 'source.see-file', …)` on the `sources` row.
 */

export interface SourceStore {
  /** A pre-signed upload URL for `key` (browser → store directly), valid for `seconds`. */
  presignPut(key: string, opts: { contentType: string; sizeBytes: number; seconds?: number }): Promise<string>;
  /** A pre-signed download URL, valid for `seconds` (default 60). */
  presignGet(key: string, seconds?: number): Promise<string>;
  /** SHA-256 (hex) and size of a stored object, for the server to verify an upload. */
  stat(key: string): Promise<{ sha256: string; sizeBytes: number } | null>;
  /** Really delete (license ended, publisher request). */
  delete(key: string): Promise<void>;
}

const B32 = "abcdefghijklmnopqrstuvwxyz234567";

/** A new opaque source id: `src_` + 26 base32 chars (130 bits). */
export function newSourceId(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = random(17); // 136 bits ≥ 26 × 5 = 130
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 26) {
      out += B32[(acc >> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  return `src_${out}`;
}

/** A storage key: `<package_id>/<128-bit random hex>` — nothing guessable, nothing readable. */
export function newStorageKey(packageId: string, random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  if (!/^[a-z0-9-]+$/.test(packageId)) throw new Error("bad package id");
  return `${packageId}/${[...random(16)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** In-memory store for tests and local development. */
export class MemorySourceStore implements SourceStore {
  objects = new Map<string, Uint8Array>();
  async presignPut(key: string) {
    return `memory://put/${encodeURIComponent(key)}`;
  }
  async presignGet(key: string, seconds = 60) {
    return `memory://get/${encodeURIComponent(key)}?ttl=${seconds}`;
  }
  async stat(key: string) {
    const b = this.objects.get(key);
    if (!b) return null;
    const d = await crypto.subtle.digest("SHA-256", b);
    return { sha256: [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join(""), sizeBytes: b.length };
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}
