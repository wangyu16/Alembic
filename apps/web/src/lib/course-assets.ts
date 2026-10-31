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


const mac = (secret: string, packageId: string, path: string, blob: string, exp: number) =>
  createHmac("sha256", secret).update(`asset\n${packageId}\n${path}\n${blob}\n${exp}`).digest("base64url");

/**
 * `?b=<blob id>&e=<expiry>&s=<signature>` for one version of one course file. The expiry is rounded
 * to whole days, so the same image keeps the same address all day and the browser can cache it (RC.9).
 */
export function signAsset(secret: string, packageId: string, path: string, blob: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const day = 86_400;
  const exp = (Math.floor(nowSeconds / day) + 2) * day; // between 24 and 48 hours from now
  return `b=${blob}&e=${exp}&s=${mac(secret, packageId, path, blob, exp)}`;
}

/** Is this a valid, unexpired signature for exactly this version of this course file? */
export function verifyAsset(secret: string, packageId: string, path: string, blob: string | null, e: string | null, s: string | null, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!blob || !/^[0-9a-f]{40}$/.test(blob) || !e || !s || !/^\d{1,12}$/.test(e)) return false;
  const exp = Number(e);
  if (exp < nowSeconds || exp > nowSeconds + 2 * 86_400 + 60) return false;
  const want = Buffer.from(mac(secret, packageId, path, blob, exp));
  const got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Course path → signed address, for every servable file the person may see (instructor-only files only for those allowed). */
export function assetUrlMap(packageId: string, files: ReadonlyArray<{ path: string; sha: string }>, mayReadPrivate: boolean, secret: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files) {
    if (!assetContentType(f.path)) continue;
    if (f.path.startsWith("private/") && !mayReadPrivate) continue;
    out.set(f.path, `${assetUrl(packageId, f.path)}?${signAsset(secret, packageId, f.path, f.sha)}`);
  }
  return out;
}

/** The server's key for image addresses (derived from the action-link secret), or null when unset. */
export function assetSecret(): string | null {
  const base = process.env["ACTION_LINK_SECRET"]?.trim();
  return base ? createHmac("sha256", base).update("alembic-asset-v1").digest("base64url") : null;
}
