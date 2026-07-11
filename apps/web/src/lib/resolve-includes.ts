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
    return await prepareSources(markdown, { allowedHosts: [PERMALINK_HOST] });
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
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
