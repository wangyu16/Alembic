/**
 * ID generation for contract primitives. Uses Web Crypto (available in Node
 * and browsers) — no IO, keeping the package pure.
 */

const BASE36 = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomBase36(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    out += BASE36[byte % 36];
  }
  return out;
}

/** New block ID: `blk-` + 12 base36 chars (~62 bits — collision-negligible). */
export function newBlockId(): string {
  return `blk-${randomBase36(12)}`;
}

/**
 * New document ID: `doc-` + 12 base36 chars (~62 bits — collision-negligible).
 * Minted at first registration (contract v2); immutable; never reused, even
 * after deletion (tombstones keep the ID forever).
 */
export function newDocId(): string {
  return `doc-${randomBase36(12)}`;
}

/** New platform-wide package ID: `pkg-<slug>-<8 base36 chars>`. */
export function newPackageId(titleSlug: string): string {
  const slug = titleSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `pkg-${slug || "untitled"}-${randomBase36(8)}`;
}

/**
 * SHA-256 (lower-case hex) of a string's UTF-8 bytes — Web Crypto, so the
 * package stays pure. Postgres computes the same value as
 * `encode(sha256(convert_to(content, 'UTF8')), 'hex')` (migration 0027).
 */
export async function sha256Hex(content: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(content),
  );
  let out = "";
  for (const byte of new Uint8Array(digest)) out += byte.toString(16).padStart(2, "0");
  return out;
}
