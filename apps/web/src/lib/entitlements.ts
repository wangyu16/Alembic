/**
 * Entitlements (M17) — the single seam future monetization plugs into.
 *
 * Capabilities are resolved from an identity in ONE place. Today: anonymous →
 * local-file editing only; a signed-in cloud user → everything. Future paid
 * plans add capabilities here (e.g. `ai`, `cloudProject`) with NO feature-code
 * changes — the resolver is the only thing that learns about plans/billing.
 * See docs/specs/local-mode.md §2.
 *
 * Pure module (no IO) so it can run on the server (authoritative enforcement)
 * and the client (UX gating). It may graduate to a shared package when the
 * worker/billing layer also needs it.
 */

export type Capability =
  | "localFile" // open/edit/save files on the user's own disk
  | "ai" // AI assist (metered, costs money)
  | "cloudProject" // packages saved server-side
  | "github" // connect publishing
  | "publish" // build + publish a site
  | "portal"; // list on the public index

export interface Identity {
  kind: "anonymous" | "user";
  userId?: string;
  /** Future: "free" | "edu" | "pro" | … — drives plan-based entitlements. */
  plan?: string;
}

export const ANONYMOUS: Identity = { kind: "anonymous" };

const FULL: Capability[] = ["localFile", "ai", "cloudProject", "github", "publish", "portal"];

/** The capabilities an identity is entitled to. The monetization seam. */
export function resolveEntitlements(id: Identity): Set<Capability> {
  if (id.kind === "anonymous") return new Set<Capability>(["localFile"]);
  // Signed-in cloud user today gets the full set; plan-based refinement (e.g.
  // gating `ai` behind a paid plan) lands here without touching feature code.
  return new Set<Capability>(FULL);
}

export function can(id: Identity, cap: Capability): boolean {
  return resolveEntitlements(id).has(cap);
}
