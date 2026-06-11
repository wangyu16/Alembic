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

/** New platform-wide package ID: `pkg-<slug>-<8 base36 chars>`. */
export function newPackageId(titleSlug: string): string {
  const slug = titleSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `pkg-${slug || "untitled"}-${randomBase36(8)}`;
}
