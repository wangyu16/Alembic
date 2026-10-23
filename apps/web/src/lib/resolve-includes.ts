import "server-only";
import { DOC_ID_SOURCE } from "@alembic/package-contract";
import { prepareSources } from "@alembic/renderer";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchDocBytes } from "@/lib/doc-content";
import { resolvePermalinkAccess } from "@/lib/permalink-access";

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
 * Per-call budget of `resolveWebIncludes` (security loop r1, M5): at most
 * `maxIncludes` distinct include fetches (nested ones count) and at most
 * `maxTotalBytes` fetched in total (+ the one fetch that crosses it, itself
 * capped at `maxIncludeBytes`). Past the budget the remaining directives stay
 * unresolved, exactly like a failed fetch. Before, one 109 KB preview body
 * made the server issue 2000 fetches. A real document includes a handful of
 * fragments; 50 and 2 MB leave room for that and nothing like a fan-out.
 */
export const INCLUDE_LIMITS = {
  maxIncludes: 50,
  maxTotalBytes: 2 * 1024 * 1024,
  maxIncludeBytes: MAX_INCLUDE_BYTES,
} as const;

/** Wrap a fetcher with one call's budget (count and total bytes). */
export function budgetedFetcher(
  fetcher: (url: string) => Promise<string | null>,
  limits: { maxIncludes: number; maxTotalBytes: number } = INCLUDE_LIMITS,
): (url: string) => Promise<string | null> {
  let count = 0;
  let bytes = 0;
  return async (url) => {
    // Checked and charged before the fetch starts, so concurrent fetches
    // cannot overrun the count.
    if (count >= limits.maxIncludes || bytes >= limits.maxTotalBytes) return null;
    count++;
    const text = await fetcher(url);
    if (text === null) return null;
    bytes += Buffer.byteLength(text, "utf8");
    return bytes > limits.maxTotalBytes ? null : text;
  };
}

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
 * leaves the directive in place. At most `INCLUDE_LIMITS` per call.
 *
 * Callers must be session-gated (security loop r1, M5): every entry point
 * that reaches this is listed and checked by
 * `app/include-fetch-entry-points.test.ts`.
 */
export async function resolveWebIncludes(markdown: string): Promise<string> {
  if (!PERMALINK_HOST || !markdown.includes("{{")) return markdown;
  try {
    // Pass the guarded fetcher so nested includes are bounded too; allowedHosts
    // is the primary SSRF gate, `resolveIncludeUrl` re-checks the host; the
    // budget bounds how much one call may fetch (`INCLUDE_LIMITS`).
    return await prepareSources(markdown, {
      allowedHosts: [PERMALINK_HOST],
      fetcher: budgetedFetcher(resolveIncludeUrl),
    });
  } catch {
    return markdown;
  }
}

/**
 * Resolve ONE include URL to its markdown — the `orz-host-include@1` bridge
 * target for hosted in-file editors (their preview requests URLs one at a time)
 * and `prepareSources`' fetcher. Only the app's own permalink host is accepted
 * (SSRF guard); anything else, or a failed/unset fetch, returns null (the file
 * leaves the directive unresolved).
 *
 * A permalink (`/d/{docId}`, optionally `@{version}`) is resolved IN-PROCESS
 * through the same access check as the resolver route
 * (`lib/permalink-access.ts`), with the requesting educator's session: a
 * published public file for anyone, a TRIAL package's file for its owner only
 * (S1), and a private-repo file NEVER — an include can end up in a public
 * artifact, so the two-repo invariant forbids it even for the owner. Other
 * paths on the app host are fetched over HTTP as before.
 */
export async function resolveIncludeUrl(url: string): Promise<string | null> {
  if (!PERMALINK_HOST) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.host.toLowerCase() !== PERMALINK_HOST.toLowerCase()) return null;
  const permalink = new RegExp(`^/d/(${DOC_ID_SOURCE})(?:@([^/]+))?/?$`).exec(parsed.pathname);
  if (permalink) return resolveOwnPermalink(permalink[1]!, permalink[2] ?? null);
  return guardedFetch(url);
}

async function resolveOwnPermalink(docId: string, pin: string | null): Promise<string | null> {
  try {
    const access = await resolvePermalinkAccess(
      docId,
      { session: await createSupabaseServerClient(), service: createServiceClient() },
      { allowPrivate: false },
    );
    if (access.status !== "ok") return null;
    const { doc, db } = access;
    if (pin && doc.source_hash && pin !== doc.source_hash) return null;
    const bytes = await fetchDocBytes(db, doc);
    if (!bytes || bytes.byteLength > MAX_INCLUDE_BYTES) return null;
    return bytes.toString("utf8");
  } catch {
    return null;
  }
}
