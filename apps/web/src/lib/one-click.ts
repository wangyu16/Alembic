/**
 * One-click links from the Needs-you email (C8). A link opens a page; only
 * the page's button (a POST, by the signed-in person the email was for)
 * answers the item, through the same `needs_you_answer` as the workspace.
 */
import "server-only";
import { verifyActionToken, type ActionClaim } from "@alembic/notify";

export const ACTIONS: Record<string, { button: string; answer: Record<string, unknown> }> = {
  confirm: { button: "Confirm", answer: { decision: "confirmed", via: "email" } },
};

export type OneClick =
  | { state: "invalid" }
  | { state: "sign-in" }
  | { state: "someone-else" }
  | { state: "ok"; claim: ActionClaim };

export function readOneClick(token: string, userId: string | null, now?: number): OneClick {
  const secret = process.env["ACTION_LINK_SECRET"] ?? "";
  const claim = verifyActionToken(token, secret, now);
  if (!claim || !ACTIONS[claim.action]) return { state: "invalid" };
  if (!userId) return { state: "sign-in" };
  if (claim.user !== userId) return { state: "someone-else" };
  return { state: "ok", claim };
}
