/**
 * Not-found pages that work without JavaScript (blind-critique 2026-10-26, H4).
 *
 * Next 16 renders a page's `notFound()` through a CLIENT error boundary.
 * Server rendering has no error boundaries, so for `/p/{id}` and
 * `/portal/element/{id}` the server answered 404 with an empty document
 * (`<html id="__next_error__">`, the title "Alembic" and nothing else) and the
 * "Not found" message appeared only once the scripts ran. With JavaScript off
 * the visitor saw a blank white page.
 *
 * The site-wide 404 (an address no route matches) is server-rendered in full.
 * So the middleware asks the same question the page asks — is this course /
 * shared file listed? (the anon read of the discovery index, RLS exactly as for
 * a signed-out visitor) — and, when the answer is a definite "no", rewrites the
 * request to an address no route matches. Next then serves the site 404:
 * status 404, the heading, the message, Home and Discover, all in the HTML.
 *
 * Bounds:
 * - only full page loads are checked; an in-app navigation (an `RSC` request,
 *   or a prefetch) renders its not-found in the browser, which works;
 * - a "listed" answer is remembered for `LISTING_CHECK_TTL_MS` per server
 *   instance (the same 120 s window the page's own cached read has), so a
 *   popular course costs one extra read per instance per two minutes, not per
 *   view. A "not listed" answer is never remembered, so a course listed a
 *   moment ago is never hidden by this check (a stale "listed" only lets the
 *   page answer, as before);
 * - any failure (no configuration, the database unreachable, a timeout, an
 *   unexpected answer) falls through to the page — never a false 404.
 */

/** An address no route matches: Next serves the site 404 for it. */
export const PUBLIC_NOT_FOUND_REWRITE = "/_alembic/not-found";

export const LISTING_CHECK_TTL_MS = 120_000;
const LISTING_CHECK_TIMEOUT_MS = 1_500;
const CACHE_LIMIT = 500;

export type ListingTarget =
  | { table: "discovery_courses"; column: "package_id"; id: string }
  | { table: "discovery_elements"; column: "doc_id"; id: string };

/**
 * The listed thing a public path names, or null when the path is not a course
 * page (`/p/{id}`) or a shared-file page (`/portal/element/{id}`).
 */
export function listingTargetOf(pathname: string): ListingTarget | null {
  const course = /^\/p\/([^/]+)\/?$/.exec(pathname);
  if (course) {
    const id = decodeSegment(course[1]!);
    return id ? { table: "discovery_courses", column: "package_id", id } : null;
  }
  const element = /^\/portal\/element\/([^/]+)\/?$/.exec(pathname);
  if (element) {
    const id = decodeSegment(element[1]!);
    return id ? { table: "discovery_elements", column: "doc_id", id } : null;
  }
  return null;
}

function decodeSegment(raw: string): string | null {
  try {
    const id = decodeURIComponent(raw);
    return id.length > 0 && id.length <= 200 ? id : null;
  } catch {
    return null;
  }
}

/** An in-app navigation or prefetch: the browser renders its own not-found. */
export function isClientNavigation(headers: Headers): boolean {
  return headers.has("rsc") || headers.has("next-router-prefetch");
}

type Entry = { exists: boolean; at: number };

/** A small per-instance memory of recent "listed" answers. */
export class ListingCheckCache {
  private readonly entries = new Map<string, Entry>();
  constructor(
    private readonly ttlMs = LISTING_CHECK_TTL_MS,
    private readonly limit = CACHE_LIMIT,
  ) {}

  get(key: string, now: number): boolean | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (now - e.at >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return e.exists;
  }

  set(key: string, exists: boolean, now: number): void {
    this.entries.delete(key);
    this.entries.set(key, { exists, at: now });
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

const sharedCache = new ListingCheckCache();

export type ListingCheckDeps = {
  env: { url: string; anonKey: string } | null;
  fetchImpl?: typeof fetch;
  cache?: ListingCheckCache;
  now?: () => number;
};

/**
 * true = listed, false = definitely not listed, null = could not tell (the
 * caller must then let the page answer).
 */
export async function isListed(target: ListingTarget, deps: ListingCheckDeps): Promise<boolean | null> {
  const { env } = deps;
  if (!env) return null;
  const cache = deps.cache ?? sharedCache;
  const now = deps.now ?? Date.now;
  const key = `${target.table}:${target.id}`;
  const remembered = cache.get(key, now());
  if (remembered !== undefined) return remembered;

  const url =
    `${env.url.replace(/\/+$/, "")}/rest/v1/${target.table}` +
    `?select=${target.column}&${target.column}=eq.${encodeURIComponent(target.id)}&limit=1`;
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(url, {
      // The key alone: the request is the anon role, as for a signed-out visitor.
      headers: { apikey: env.anonKey, Accept: "application/json" },
      signal: AbortSignal.timeout(LISTING_CHECK_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) return null;
    const exists = rows.length > 0;
    if (exists) cache.set(key, true, now());
    return exists;
  } catch {
    return null;
  }
}
