import { describe, expect, it } from "vitest";
import { BlockIdSchema, BlockSchema, validateBlockIds } from "./blocks";

describe("BlockIdSchema", () => {
  it("accepts well-formed IDs", () => {
    expect(BlockIdSchema.safeParse("blk-a1b2c3d4").success).toBe(true);
    expect(BlockIdSchema.safeParse("blk-0123456789abcdef").success).toBe(true);
  });

  it("rejects malformed IDs", () => {
    for (const bad of ["blk-ABC12345", "blk-short", "section-1", "blk_a1b2c3d4", ""]) {
      expect(BlockIdSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("BlockSchema", () => {
  it("parses a minimal section block", () => {
    const block = BlockSchema.parse({
      id: "blk-a1b2c3d4",
      kind: "section",
      title: "Lewis Structures",
      source: "## Lewis Structures {#blk-a1b2c3d4}\n\nContent.",
      revision: 0,
    });
    expect(block.kind).toBe("section");
  });

  it("carries adapted-from lineage", () => {
    const block = BlockSchema.parse({
      id: "blk-e5f6a7b8",
      kind: "section",
      title: "Adapted",
      source: "...",
      revision: 0,
      adaptedFrom: { packageId: "pkg-1", blockId: "blk-a1b2c3d4" },
    });
    expect(block.adaptedFrom?.blockId).toBe("blk-a1b2c3d4");
  });
});

describe("validateBlockIds", () => {
  it("passes a clean list", () => {
    const result = validateBlockIds([{ id: "blk-a1b2c3d4" }, { id: "blk-e5f6a7b8" }]);
    expect(result.ok).toBe(true);
  });

  it("reports duplicates and malformed IDs", () => {
    const result = validateBlockIds([
      { id: "blk-a1b2c3d4" },
      { id: "blk-a1b2c3d4" },
      { id: "not-an-id" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it("accepts blocks whose ids are all null (anonymous sections, v2 §4)", () => {
    const result = validateBlockIds([{ id: null }, { id: null }, { id: undefined }]);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a mix of null ids and valid ids", () => {
    const result = validateBlockIds([
      { id: null },
      { id: "blk-a1b2c3d4" },
      { id: null },
      { id: "blk-e5f6a7b8" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("still rejects duplicate non-null ids even amid null ids", () => {
    const result = validateBlockIds([
      { id: null },
      { id: "blk-a1b2c3d4" },
      { id: "blk-a1b2c3d4" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /Duplicate/.test(e))).toBe(true);
  });

  it("still rejects malformed ids even amid null ids", () => {
    const result = validateBlockIds([{ id: null }, { id: "not-an-id" }]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /Malformed/.test(e))).toBe(true);
  });
});
