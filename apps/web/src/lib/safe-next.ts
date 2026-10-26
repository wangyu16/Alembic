/**
 * The return address after sign-in (blind-critique 2026-10-26, P6).
 *
 * "Sign in" links on public pages carry where the visitor was
 * (`/signin?next=/p/{id}?adapt=1#adapt`); the sign-in page forwards it through
 * the GitHub round trip to `/auth/callback`, which redirects there. Anything
 * that arrives in `next` is attacker-controlled, so it is accepted only when
 * it is a path on THIS site:
 *
 * - it starts with exactly one "/" (not "//" or "/\", which browsers read as
 *   another host);
 * - no backslash, no "@", no control characters or whitespace anywhere, no
 *   scheme ("javascript:", "https:" …);
 * - resolved against our own origin it stays on our own origin.
 *
 * Anything else falls back to `/workspace`. Pure; tested adversarially in
 * `safe-next.test.ts`.
 */

export const DEFAULT_NEXT = "/workspace";
const MAX_NEXT_LENGTH = 1024;

export function safeNextPath(raw: string | null | undefined): string {
  if (typeof raw !== "string") return DEFAULT_NEXT;
  const next = raw;
  if (next.length === 0 || next.length > MAX_NEXT_LENGTH) return DEFAULT_NEXT;
  if (next[0] !== "/") return DEFAULT_NEXT;
  if (next[1] === "/" || next[1] === "\\") return DEFAULT_NEXT;
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (/[\\@\s\u0000-\u001f\u007f]/.test(next)) return DEFAULT_NEXT;
  // An encoded slash/backslash at the start can be decoded by a later hop.
  if (/^\/(%2f|%5c)/i.test(next)) return DEFAULT_NEXT;
  // No scheme before the first "/", "?" or "#" (defence in depth: a leading
  // "/" already rules it out, but keep the rule explicit).
  if (/^[a-z][a-z0-9+.-]*:/i.test(next)) return DEFAULT_NEXT;
  const base = "https://alembic.invalid";
  let url: URL;
  try {
    url = new URL(next, base);
  } catch {
    return DEFAULT_NEXT;
  }
  if (url.origin !== base) return DEFAULT_NEXT;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The sign-in link for a page: `/signin?next=<this page>`. */
export function signInHref(returnTo: string): string {
  const next = safeNextPath(returnTo);
  return next === DEFAULT_NEXT ? "/signin" : `/signin?next=${encodeURIComponent(next)}`;
}
