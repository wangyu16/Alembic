import { describe, expect, it } from "vitest";
import {
  BASE_TIER,
  canAutoApply,
  effectiveTier,
  type TierPolicy,
} from "./change-tiers";

describe("base tiers", () => {
  it("classifies the three tiers", () => {
    expect(BASE_TIER["formatting-tidy"]).toBe(1);
    expect(BASE_TIER["draft-section"]).toBe(2);
    expect(BASE_TIER["publish"]).toBe(3);
  });
});

describe("effectiveTier — policy can only tighten", () => {
  it("default policy leaves base tiers unchanged", () => {
    expect(effectiveTier("formatting-tidy")).toBe(1);
    expect(effectiveTier("draft-section")).toBe(2);
    expect(effectiveTier("publish")).toBe(3);
  });

  it('"review everything" (minTier 2) escalates tier-1 to review', () => {
    const p: TierPolicy = { minTier: 2 };
    expect(effectiveTier("formatting-tidy", p)).toBe(2);
    expect(effectiveTier("draft-section", p)).toBe(2);
    expect(effectiveTier("publish", p)).toBe(3);
  });

  it("never lowers a tier — Tier-3 stays 3 under every policy", () => {
    for (const minTier of [1, 2, 3] as const) {
      expect(effectiveTier("publish", { minTier })).toBe(3);
      expect(effectiveTier("answer-key", { minTier })).toBe(3);
      // minTier can't drop a tier-2 kind to tier-1:
      expect(effectiveTier("draft-section", { minTier })).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("canAutoApply", () => {
  it("only Tier-1 (effective) auto-applies", () => {
    expect(canAutoApply("formatting-tidy")).toBe(true);
    expect(canAutoApply("draft-section")).toBe(false);
    expect(canAutoApply("publish")).toBe(false);
  });

  it("review-everything disables auto-apply entirely", () => {
    expect(canAutoApply("formatting-tidy", { minTier: 2 })).toBe(false);
  });
});
