import { describe, it, expect } from "vitest";
import { validateCommitPlan } from "./index";

// The LICENSE backfill (site-actions publishSiteAction) commits `LICENSE` to the
// PUBLIC repo. If the two-repo invariant rejected it, publishing would break —
// so pin that it is accepted for public and rejected for private.
describe("LICENSE commit vs the two-repo invariant", () => {
  it("accepts LICENSE at the public repo root", () => {
    expect(() =>
      validateCommitPlan({ repo: "public", summary: "Add LICENSE", changes: [{ path: "LICENSE", content: "x" }] }),
    ).not.toThrow();
  });
  it("still enforces the boundary (a private-instructor path can't ride a public commit)", () => {
    expect(() =>
      validateCommitPlan({
        repo: "public",
        summary: "x",
        changes: [{ path: "LICENSE", content: "x" }, { path: "private-instructor/keys.md", content: "secret" }],
      }),
    ).toThrow();
  });
});
