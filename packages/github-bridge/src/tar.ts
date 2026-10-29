/**
 * A minimal reader for GitHub's tarball archives (gzip + ustar with pax
 * headers): regular files only, by path relative to the archive's single top
 * folder. Used to read a whole tree in ONE API request instead of one per
 * file (RC.11: a real course's Publish spent ~1,000 of the installation's
 * 5,000 requests an hour).
 */
import { gunzipSync } from "node:zlib";

const field = (b: Uint8Array, off: number, len: number) => {
  let end = off;
  while (end < off + len && b[end] !== 0) end++;
  return new TextDecoder().decode(b.subarray(off, end));
};
const octal = (b: Uint8Array, off: number, len: number) => parseInt(field(b, off, len).trim() || "0", 8);

/** pax records: "<len> key=value\n" ... */
function paxPath(data: Uint8Array): string | null {
  const text = new TextDecoder().decode(data);
  for (const line of text.split("\n")) {
    const m = /^\d+ path=(.*)$/.exec(line);
    if (m) return m[1]!;
  }
  return null;
}

/** Every regular file of a .tar.gz, path → bytes, with the archive's top folder stripped. Throws past `maxBytes` unpacked. */
export function readTarGz(gz: Uint8Array, maxBytes: number): Map<string, Uint8Array> {
  const tar = gunzipSync(gz, { maxOutputLength: maxBytes });
  const out = new Map<string, Uint8Array>();
  let off = 0;
  let nextPath: string | null = null;
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break; // end of archive
    const size = octal(h, 124, 12);
    const type = String.fromCharCode(h[156] || 48);
    const data = tar.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") { nextPath = paxPath(data); continue; } // pax header for the next entry
    if (type === "g") continue; // global pax header (GitHub's commit comment)
    if (type === "L") { nextPath = field(data, 0, data.length); continue; } // GNU long name
    const prefix = field(h, 345, 155);
    const name = nextPath ?? (prefix ? `${prefix}/${field(h, 0, 100)}` : field(h, 0, 100));
    nextPath = null;
    if (type !== "0") continue; // regular files only (no links, folders)
    const slash = name.indexOf("/");
    if (slash < 0) continue;
    out.set(name.slice(slash + 1), new Uint8Array(data));
  }
  return out;
}
