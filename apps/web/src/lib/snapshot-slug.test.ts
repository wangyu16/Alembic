import { describe, expect, it } from "vitest";
import { snapshotSlug } from "./snapshot-slug";

describe("snapshot names (history-v3 §5)", () => {
  it("[H.6] a name becomes a safe tag slug; a non-Latin or empty name falls back to the date", () => {
    expect(snapshotSlug("Fall 2026")).toBe("fall-2026");
    expect(snapshotSlug("  Spring — ’27!! ")).toBe("spring-27");
    expect(snapshotSlug("秋学期", new Date("2026-10-30T12:00:00Z"))).toBe("snapshot-2026-10-30");
    expect(snapshotSlug("../../refs/heads/main")).toBe("refs-heads-main");
    expect(snapshotSlug("x".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});
