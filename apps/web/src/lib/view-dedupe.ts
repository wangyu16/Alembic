/**
 * De-duplication of `element.viewed` research events (security loop r1, L4b).
 *
 * Every origin answer of a public `/d` document used to write one event, and a
 * visitor can make every request an origin answer by varying the query string
 * (`?x=1`, `?x=2`, … are different CDN keys). So `research_events` grew with
 * whatever a client chose to send. Now a view is written at most ONCE per
 * (doc, client address, clock hour).
 *
 * The counter is the rate-limit store (`rate_limit_hit`, migration 0023,
 * shared across instances) with the bounded in-process store as fallback — so
 * when Postgres is unavailable writes stay bounded per instance rather than
 * becoming unbounded. Anything else going wrong answers "not first": a lost
 * view event is acceptable, an unbounded write path is not.
 *
 * Privacy: the key is an HMAC of (doc, address) under the server secret —
 * neither the address nor the docId is stored, and keys of one address for
 * different docs cannot be linked to each other.
 *
 * Pure apart from `node:crypto` (unit-tested through the `/d` route test).
 */

import { createHmac } from "node:crypto";
import type { RateStore } from "./rate-limit";

/** One view per (doc, address) per this window — a fixed clock hour. */
export const VIEW_DEDUPE_WINDOW_MS = 60 * 60_000;

/** `view:` + 32 hex chars (well under `rate_limit_hit`'s 128-char key limit). */
export function viewDedupeKey(docId: string, ip: string, secret: string): string {
  return "view:" + createHmac("sha256", secret).update(`view|${docId}|${ip}`).digest("hex").slice(0, 32);
}

/** Is this the first view of `docId` from `ip` in the current window? Never throws. */
export async function isFirstView(
  store: RateStore,
  docId: string,
  ip: string,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  try {
    return (await store.hit(viewDedupeKey(docId, ip, secret), VIEW_DEDUPE_WINDOW_MS, now)) === 1;
  } catch {
    return false;
  }
}
