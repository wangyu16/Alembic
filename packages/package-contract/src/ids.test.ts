import { describe, expect, it } from "vitest";
import { BlockIdSchema } from "./blocks";
import { newBlockId, newPackageId } from "./ids";

describe("newBlockId", () => {
  it("generates well-formed, distinct IDs", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newBlockId()));
    expect(ids.size).toBe(1000);
    for (const id of ids) {
      expect(BlockIdSchema.safeParse(id).success).toBe(true);
    }
  });
});

describe("newPackageId", () => {
  it("slugifies the title", () => {
    expect(newPackageId("General Chemistry: Thermo!")).toMatch(
      /^pkg-general-chemistry-thermo-[a-z0-9]{8}$/,
    );
  });

  it("handles empty titles", () => {
    expect(newPackageId("")).toMatch(/^pkg-untitled-[a-z0-9]{8}$/);
  });
});
