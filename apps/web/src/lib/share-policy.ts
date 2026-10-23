/**
 * Owner ruling 2026-10-23 (P5.R.2): "Share this" — making a file discoverable
 * on Discover — is offered only for a published course. A trial course's
 * files are never in Discover, so the control would promise something that
 * cannot happen; it returns once the course is published. Pure, so the
 * workspace UI and the server actions share the one rule.
 */

/** True when the share control may be offered for a course with this storage. */
export function canOfferShare(storage: string | null | undefined): boolean {
  return storage === "github";
}

/** What the educator is told instead of the share control. */
export const SHARE_NEEDS_PUBLISH = "Sharing is available once the course is published.";
