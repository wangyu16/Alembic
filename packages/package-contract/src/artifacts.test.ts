import { describe, expect, it } from "vitest";
import { assertPathAllowedInRepo } from "./layers";
import {
  ARTIFACT_ID_PATTERN,
  DerivedArtifactRecordSchema,
  artifactRecordPath,
  hashBlockContent,
  newArtifactId,
} from "./artifacts";

describe("hashBlockContent", () => {
  it("is deterministic", () => {
    const block = { title: "Enthalpy", body: "$\\Delta H$ is enthalpy." };
    expect(hashBlockContent(block)).toBe(hashBlockContent(block));
  });

  it("changes when title or body changes", () => {
    const base = hashBlockContent({ title: "A", body: "x" });
    expect(hashBlockContent({ title: "A", body: "y" })).not.toBe(base);
    expect(hashBlockContent({ title: "B", body: "x" })).not.toBe(base);
  });
});

describe("newArtifactId", () => {
  it("generates well-formed, distinct IDs", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newArtifactId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(ARTIFACT_ID_PATTERN);
  });
});

describe("DerivedArtifactRecord", () => {
  it("parses a valid worksheet record with defaults", () => {
    const record = DerivedArtifactRecordSchema.parse({
      artifactId: "art-abcd1234",
      kind: "worksheet",
      path: "materials/worksheets/enthalpy.md",
      title: "Enthalpy practice",
      sourceBlocks: [{ blockId: "blk-aaaaaaaa", contentHash: "deadbeef" }],
      generatedAt: "2026-06-11T12:00:00Z",
    });
    expect(record.status).toBe("fresh");
  });

  it("record path lives under the allowlisted .alembic dir (valid in public repo)", () => {
    const path = artifactRecordPath("art-abcd1234");
    expect(path).toBe(".alembic/artifacts/art-abcd1234.json");
    expect(() => assertPathAllowedInRepo(path, "public")).not.toThrow();
  });
});
