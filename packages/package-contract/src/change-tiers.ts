/**
 * Risk-tiered approvals (goal.md §2 "AI Orchestration Layer").
 *
 * Every change — AI-proposed or automatic — is classified into a tier:
 *   Tier 1 — auto-apply, always undoable. Mechanical, content-neutral
 *            (formatting, link repair, id/schema housekeeping). Never changes
 *            meaning, content, or public/private status.
 *   Tier 2 — batch review. Content-bearing but low-stakes (drafts,
 *            restructuring, generated artifacts). Accept/edit/reject in a queue.
 *   Tier 3 — mandatory itemized review, never batchable. Anything crossing a
 *            trust boundary (publish, registration, license/attribution,
 *            assessments/answer keys, suggest-back).
 *
 * Tiers are policy, not hardcode: educators may TIGHTEN (raise the floor), but
 * loosening below Tier 3 is impossible — publication always needs approval.
 */

export type Tier = 1 | 2 | 3;

export const CHANGE_KINDS = [
  // Tier 1 — mechanical, auto-appliable
  "formatting-tidy",
  "link-repair",
  "id-housekeeping",
  "schema-migrate",
  // Tier 2 — content-bearing, batch review
  "draft-section",
  "restructure",
  "generate-artifact",
  "import-blocks",
  "suggest-example",
  "a11y-fix",
  // Tier 3 — trust boundary, itemized review, never lowered
  "publish",
  "register",
  "license-change",
  "assessment-edit",
  "answer-key",
  "suggest-back",
] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** The intrinsic tier of each change kind. */
export const BASE_TIER: Record<ChangeKind, Tier> = {
  "formatting-tidy": 1,
  "link-repair": 1,
  "id-housekeeping": 1,
  "schema-migrate": 1,
  "draft-section": 2,
  restructure: 2,
  "generate-artifact": 2,
  "import-blocks": 2,
  "suggest-example": 2,
  "a11y-fix": 2,
  publish: 3,
  register: 3,
  "license-change": 3,
  "assessment-edit": 3,
  "answer-key": 3,
  "suggest-back": 3,
};

/**
 * Educator/admin policy. `minTier` raises the review floor — e.g. minTier 2 is
 * a "review everything" mode (nothing auto-applies). It can only TIGHTEN:
 * because effectiveTier takes the max, policy never lowers a kind's tier, and
 * Tier-3 kinds are always 3.
 */
export interface TierPolicy {
  minTier: Tier;
}

export const DEFAULT_TIER_POLICY: TierPolicy = { minTier: 1 };

/** The tier a change is actually handled at, after applying policy. */
export function effectiveTier(kind: ChangeKind, policy: TierPolicy = DEFAULT_TIER_POLICY): Tier {
  return Math.max(BASE_TIER[kind], policy.minTier) as Tier;
}

/** True only when the change may be applied automatically (effective Tier 1). */
export function canAutoApply(kind: ChangeKind, policy: TierPolicy = DEFAULT_TIER_POLICY): boolean {
  return effectiveTier(kind, policy) === 1;
}
