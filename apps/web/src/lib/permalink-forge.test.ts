/**
 * Owner decision 2026-10-24 (closes P5.S.L2, round-4 security MEDIUM-2): a
 * pinned `/d/{doc}@{pin}` cannot be satisfied by different bytes.
 *
 * Before, the pin, the ETag, the bytes-cache key and the mirror check were the
 * 32-bit FNV-1a `source_hash`, and a second preimage is cheap: the round-4
 * repro (/tmp/alembic-r4/forge.test.ts, reproduced here) appends three CJK
 * characters inside an SVG comment so a WRONG figure hashes to the right
 * figure's pin. Now all four use the SHA-256 of the content
 * (`documents.content_sha256`); a legacy 8-hex pin resolves only to the current
 * version and only when the bytes match its SHA-256.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeSourceHash } from "@alembic/package-ops";
import type { PermalinkDoc } from "./permalink-access";
import { CACHE, servePermalink, type PermalinkDeps } from "./permalink-response";
import { bytesMatchSha256, DocBytesCache } from "./doc-bytes-cache";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

// ── The forge (round-4 repro): a second FNV-1a preimage in ~10^5 steps ──
const P = 0x01000193;
let inv = P; // modular inverse of P mod 2^32 (Newton)
for (let i = 0; i < 5; i++) inv = Math.imul(inv, 2 - Math.imul(P, inv)) >>> 0;
const step = (h: number, c: number) => Math.imul((h ^ c) >>> 0, P) >>> 0;
const unstep = (h: number, c: number) => ((Math.imul(h, inv) >>> 0) ^ c) >>> 0;
const fnvState = (s: string, h = 0x811c9dc5) => {
  for (let i = 0; i < s.length; i++) h = step(h, s.charCodeAt(i));
  return h;
};
const cjk = (c: number) => c >= 0x4e00 && c <= 0x9fff; // no surrogates: survives a UTF-8 round trip

const ORIGINAL = `<svg xmlns="http://www.w3.org/2000/svg"><text x="1" y="20">pKa of acetic acid = 4.76</text></svg>\n`;

function forge(target: string): string {
  const prefix = `<svg xmlns="http://www.w3.org/2000/svg"><text x="1" y="20">pKa of acetic acid = 9.99 (WRONG)</text><!--`;
  const suffix = `--></svg>\n`;
  let need = parseInt(target, 16);
  for (let i = suffix.length - 1; i >= 0; i--) need = unstep(need, suffix.charCodeAt(i));
  const s0 = fnvState(prefix);
  for (let a = 0x4e00; a <= 0x9fff; a++) {
    const s1 = step(s0, a);
    for (let b = 0x4e00; b <= 0x9fff; b++) {
      const c = ((Math.imul(need, inv) >>> 0) ^ step(s1, b)) >>> 0;
      if (cjk(c)) return Buffer.from(prefix + String.fromCharCode(a, b, c) + suffix, "utf8").toString("utf8");
    }
  }
  throw new Error("no forge found");
}

const FNV = computeSourceHash(ORIGINAL);
const SHA = sha(ORIGINAL);
const FORGED = forge(FNV);
const PATH = "assets/figures/pka.svg";

function world(origin: string, mirror: string | null) {
  const doc: PermalinkDoc = {
    doc_id: "doc-fig1pka",
    package_id: "pkg-chem",
    repo: "public",
    path: PATH,
    source_hash: FNV,
    content_sha256: SHA, // the registry row: the GENUINE figure
    tombstoned: false,
  };
  const healed: string[] = [];
  const deps: PermalinkDeps = {
    access: async () => ({ status: "ok", doc, ownerOnly: false, db: null as never }),
    readBytes: async () => Buffer.from(origin, "utf8"),
    readMirror: async () => (mirror === null ? null : Buffer.from(mirror, "utf8")),
    cache: new DocBytesCache(),
    onStale: (d) => healed.push(d.doc_id),
  };
  return { deps, healed };
}

describe("P5.S.L2 a pin cannot be satisfied by different bytes (SHA-256 pins)", () => {
  it("[P5.S.L2] the forge is real: the wrong figure has the right figure's FNV hash, not its SHA-256", () => {
    expect(FORGED).not.toBe(ORIGINAL);
    expect(FORGED).toContain("9.99 (WRONG)");
    expect(computeSourceHash(FORGED)).toBe(FNV);
    expect(sha(FORGED)).not.toBe(SHA);
    expect(bytesMatchSha256(PATH, Buffer.from(FORGED, "utf8"), SHA)).toBe(false);
    expect(bytesMatchSha256(PATH, Buffer.from(ORIGINAL, "utf8"), SHA)).toBe(true);
  });

  it("[P5.S.L2] the forged bytes cannot be served under the SHA-256 pin, from the origin or the mirror", async () => {
    for (const mirror of [FORGED, null]) {
      const { deps, healed } = world(FORGED, mirror);
      const r = await servePermalink(`doc-fig1pka@${SHA}`, new Headers(), deps);
      const body = await r.text();
      expect(r.status).toBe(404);
      expect(body).not.toContain("WRONG");
      expect(r.headers.get("etag")).toBeNull();
      expect(r.headers.get("cache-control")).toBe(CACHE.none);
      expect(deps.cache.size).toBe(0);
      expect(healed).toEqual(["doc-fig1pka"]);
    }
  });

  it("[P5.S.L2] nor under the legacy FNV pin the forge collides with — the bytes must match the current SHA-256", async () => {
    const { deps } = world(FORGED, FORGED);
    const r = await servePermalink(`doc-fig1pka@${FNV}`, new Headers(), deps);
    expect(r.status).toBe(404);
    expect(await r.text()).not.toContain("WRONG");
    expect(deps.cache.size).toBe(0);
    // conditional, with the version's ETag: still never the forged bytes, never a 304
    const c = await servePermalink(`doc-fig1pka@${FNV}`, new Headers({ "if-none-match": `W/"${SHA}"` }), world(FORGED, FORGED).deps);
    expect(c.status).toBe(404);
  });

  it("[P5.S.L2] unpinned, the forged bytes are served only as unverified: no ETag, private, no-store, not cached", async () => {
    const { deps, healed } = world(FORGED, null);
    const r = await servePermalink("doc-fig1pka", new Headers(), deps);
    expect(r.status).toBe(200);
    expect(r.headers.get("etag")).toBeNull();
    expect(r.headers.get("cache-control")).toBe(CACHE.unverified);
    expect(deps.cache.size).toBe(0);
    expect(healed).toEqual(["doc-fig1pka"]);
  });

  it("[P5.S.L2] control: the genuine bytes are served immutable under the SHA-256 pin and live under the legacy pin", async () => {
    const pinned = await servePermalink(`doc-fig1pka@${SHA}`, new Headers(), world(ORIGINAL, null).deps);
    expect(pinned.status).toBe(200);
    expect(await pinned.text()).toBe(ORIGINAL);
    expect(pinned.headers.get("etag")).toBe(`W/"${SHA}"`);
    expect(pinned.headers.get("cache-control")).toBe(CACHE.pinned);
    const legacy = await servePermalink(`doc-fig1pka@${FNV}`, new Headers(), world(ORIGINAL, null).deps);
    expect(legacy.status).toBe(200);
    expect(legacy.headers.get("etag")).toBe(`W/"${SHA}"`);
    expect(legacy.headers.get("cache-control")).toBe(CACHE.live); // never immutable on the FNV alone
  });

  it("[P5.S.L2] the bytes cache is keyed by the SHA-256: a forged copy is never stored under the version key", async () => {
    const cache = new DocBytesCache();
    const key = { docId: "doc-fig1pka", hash: SHA, path: PATH };
    const got = await cache.get(key, async () => Buffer.from(FORGED, "utf8"));
    expect(got?.verified).toBe(false);
    expect(cache.has(key)).toBe(false);
    expect(DocBytesCache.keyOf(key)).toBe(`doc-fig1pka@${SHA}`);
  });
});
