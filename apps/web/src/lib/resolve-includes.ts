import "server-only";
import { prepareSources } from "@alembic/renderer";

/**
 * The app's own permalink host — the ONLY host whose `{{md-include …}}`
 * directives we resolve server-side (SSRF guard). Derived from
 * NEXT_PUBLIC_APP_URL; when unset we resolve nothing rather than fetch an
 * arbitrary URL.
 */
const PERMALINK_HOST = (() => {
  const u = process.env["NEXT_PUBLIC_APP_URL"];
  if (!u) return null;
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
})();

/** Include fetches are bounded: an included fragment is small markdown, not a payload. */
const INCLUDE_TIMEOUT_MS = 5000;
const MAX_INCLUDE_BYTES = 512 * 1024;

/**
 * Fetch an already-host-validated URL with SSRF-defensive bounds:
 * - `redirect: "manual"` — never follow a 3xx (a redirect could aim at an
 *   internal address even from an allowed host); a redirect response is not
 *   `ok`, so it resolves to null.
 * - an abort timeout, so a slow host can't tie up the serverless invocation.
 * - a size cap (Content-Length and the decoded body), so a large response
 *   can't exhaust memory.
 */
async function guardedFetch(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INCLUDE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: "manual", signal: controller.signal });
    if (!res.ok) return null;
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_INCLUDE_BYTES) return null;
    const text = await res.text();
    if (text.length > MAX_INCLUDE_BYTES) return null;
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve web transclusions (`{{md-include https://host/d/{docId}}}`) into the
 * markdown, restricted to the app's own permalink host. Used both on the
 * PUBLISH path (so exported artifacts are standalone) and for server-side
 * previews (so the educator sees included content before publishing). The
 * editable source of record always keeps the directive — this only transforms
 * the copy that gets rendered/built. Best-effort: a failed fetch or unset host
 * leaves the directive in place.
 */
export async function resolveWebIncludes(markdown: string): Promise<string> {
  if (!PERMALINK_HOST || !markdown.includes("{{")) return markdown;
  try {
    // Pass the guarded fetcher so nested includes are bounded too; allowedHosts
    // is the primary SSRF gate, `resolveIncludeUrl` re-checks the host.
    return await prepareSources(markdown, {
      allowedHosts: [PERMALINK_HOST],
      fetcher: resolveIncludeUrl,
    });
  } catch {
    return markdown;
  }
}

/**
 * Resolve ONE include URL to its markdown — the `orz-host-include@1` bridge
 * target for hosted in-file editors (their preview requests URLs one at a time).
 * Only the app's own permalink host is fetched (SSRF guard); anything else, or
 * a failed/unset fetch, returns null (the file leaves the directive unresolved).
 */
export async function resolveIncludeUrl(url: string): Promise<string | null> {
  if (!PERMALINK_HOST) return null;
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  if (host.toLowerCase() !== PERMALINK_HOST.toLowerCase()) return null;
  return guardedFetch(url);
}
