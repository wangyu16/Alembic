import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTING, modelForTask, type ModelRouting } from "./routing";

describe("modelForTask", () => {
  const routing: ModelRouting = {
    default: "fast-model",
    byTask: { "draft-section": "strong-model" },
  };

  it("returns the byTask override when present", () => {
    expect(modelForTask("draft-section", routing)).toBe("strong-model");
  });

  it("falls back to default when the kind has no mapping", () => {
    expect(modelForTask("a11y-fix", routing)).toBe("fast-model");
  });

  it("falls back to default when byTask is absent entirely", () => {
    expect(modelForTask("anything", { default: "only" })).toBe("only");
  });
});

describe("DEFAULT_ROUTING", () => {
  it("has a default model and at least one byTask entry", () => {
    expect(DEFAULT_ROUTING.default).toBeTruthy();
    expect(Object.keys(DEFAULT_ROUTING.byTask ?? {}).length).toBeGreaterThan(0);
  });

  it("routes content generation to a stronger model than the cheap default", () => {
    expect(modelForTask("draft-section", DEFAULT_ROUTING)).not.toBe(
      DEFAULT_ROUTING.default,
    );
    expect(modelForTask("a11y-fix", DEFAULT_ROUTING)).toBe(
      DEFAULT_ROUTING.default,
    );
  });
});
