/**
 * Course images in the workspace editor (RC.9): a course's own files are
 * served by a route to its members, and the editor is given the map from
 * course path to that route's address. The editor's preview is a sandboxed
 * frame whose image requests carry no session, so each address the page
 * hands out carries a signature for exactly that course file, valid for a
 * limited time (a capability address, minted only for a member).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
const TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  svg: "image/svg+xml", avif: "image/avif", pdf: "application/pdf",
};

/** The content type to serve a course file with, or null for files the route doesn't serve. */
export function assetContentType(path: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return ext ? (TYPES[ext] ?? null) : null;
}

/** The route address of a course file. */
export const assetUrl = (packageId: string, path: string) =>
  `/workspace/${encodeURIComponent(packageId)}/asset/${path.split("/").map(encodeURIComponent).join("/")}`;

/** How long a signed image address works. */
export const ASSET_SIGNATURE_SECONDS = 12 * 60 * 60;

const mac = (secret: string, packageId: string, path: string, exp: number) =>
  createHmac("sha256", secret).update(`asset\n${packageId}\n${path}\n${exp}`).digest("base64url");

/** `?e=<expiry>&s=<signature>` for one course file. */
export function signAsset(secret: string, packageId: string, path: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const exp = nowSeconds + ASSET_SIGNATURE_SECONDS;
  return `e=${exp}&s=${mac(secret, packageId, path, exp)}`;
}

/** Is this a valid, unexpired signature for exactly this course file? */
export function verifyAsset(secret: string, packageId: string, path: string, e: string | null, s: string | null, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!e || !s || !/^\d{1,12}$/.test(e)) return false;
  const exp = Number(e);
  if (exp < nowSeconds || exp > nowSeconds + ASSET_SIGNATURE_SECONDS + 60) return false;
  const want = Buffer.from(mac(secret, packageId, path, exp));
  const got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Course path → signed address, for every servable file the person may see (instructor-only files only for those allowed). */
export function assetUrlMap(packageId: string, paths: readonly string[], mayReadPrivate: boolean, secret: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of paths) {
    if (!assetContentType(p)) continue;
    if (p.startsWith("private/") && !mayReadPrivate) continue;
    out.set(p, `${assetUrl(packageId, p)}?${signAsset(secret, packageId, p)}`);
  }
  return out;
}

/** The server's key for image addresses (derived from the action-link secret), or null when unset. */
export function assetSecret(): string | null {
  const base = process.env["ACTION_LINK_SECRET"]?.trim();
  return base ? createHmac("sha256", base).update("alembic-asset-v1").digest("base64url") : null;
}
