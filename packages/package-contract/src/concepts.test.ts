import { describe, expect, it } from "vitest";
import {
  ConceptMapSchema,
  ObjectivesSchema,
  conceptMapPath,
  objectivesPath,
} from "./concepts";
import { assertPathAllowedInRepo } from "./layers";

describe("ConceptMap / Objectives schemas", () => {
  it("parses a chapter concept map with defaults", () => {
    const map = ConceptMapSchema.parse({
      scope: "chapter",
      concepts: [{ id: "enthalpy", label: "Enthalpy" }],
    });
    expect(map.concepts[0]?.prerequisites).toEqual([]);
    expect(map.concepts[0]?.blockIds).toEqual([]);
  });

  it("parses objectives aligned to blocks", () => {
    const obj = ObjectivesSchema.parse({
      scope: "course",
      objectives: [
        { id: "o1", text: "Compute ΔH", blockIds: ["blk-aaaaaaaa"] },
      ],
    });
    expect(obj.objectives[0]?.blockIds).toEqual(["blk-aaaaaaaa"]);
  });

  it("rejects a malformed block id in alignment", () => {
    expect(() =>
      ObjectivesSchema.parse({
        scope: "course",
        objectives: [{ id: "o1", text: "x", blockIds: ["nope"] }],
      }),
    ).toThrow();
  });
});

describe("record paths land in public layers", () => {
  it("concept-map and objectives paths validate for the public repo", () => {
    for (const p of [
      conceptMapPath("course"),
      conceptMapPath("chapter", "01-intro"),
      objectivesPath("course"),
      objectivesPath("chapter", "01-intro"),
    ]) {
      expect(() => assertPathAllowedInRepo(p, "public")).not.toThrow();
    }
  });
});
