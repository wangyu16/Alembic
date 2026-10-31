/**
 * The public origin a request was made to. Behind a proxy (Vercel, or the
 * Cloudflare tunnel on the testing VM) `request.url` can carry the address
 * the server listens on (e.g. `0.0.0.0:3000`), so redirects and same-origin
 * checks use the forwarded host and protocol, falling back to the URL.
 * Next's standalone server (self-hosted, e.g. the testing VM) replaces the
 * Host header with its own bind address; for such an address the configured
 * public URL (NEXT_PUBLIC_APP_URL) is the answer.
 */
const BIND_ADDRESS = /^(0\.0\.0\.0|127\.0\.0\.1|\[::\]|\[::1\])(:\d+)?$/;

export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;
  const host = first(request.headers.get("x-forwarded-host")) ?? first(request.headers.get("host"));
  const proto = first(request.headers.get("x-forwarded-proto")) ?? url.protocol.slice(0, -1);
  const configured = process.env["NEXT_PUBLIC_APP_URL"]?.replace(/\/+$/, "");
  if (configured && (!host || BIND_ADDRESS.test(host))) return configured;
  if (!host || !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host) || (proto !== "http" && proto !== "https")) return url.origin;
  return `${proto}://${host}`;
}
