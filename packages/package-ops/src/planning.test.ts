import { describe, expect, it } from "vitest";
import type { ConceptMap, Objectives } from "@alembic/package-contract";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";
import {
  loadConceptMap,
  saveConceptMap,
  loadObjectives,
  saveObjectives,
} from "./planning";
import { packageOps } from "./ops";

const input = {
  ownerId: "user-1",
  title: "Thermochemistry",
  license: "CC-BY-4.0" as const,
};

async function seeded() {
  const store = new MemoryPackageStore();
  const { packageId } = await createSandboxPackage(store, input);
  return { store, packageId };
}

describe("loadConceptMap / loadObjectives — empty defaults", () => {
  it("returns an empty course concept map when none was ever saved", async () => {
    const { store, packageId } = await seeded();
    const map = await loadConceptMap(store, packageId, "course");
    expect(map).toEqual({ scope: "course", concepts: [] });
  });

  it("returns empty course objectives when none was ever saved", async () => {
    const { store, packageId } = await seeded();
    const objectives = await loadObjectives(store, packageId, "course");
    expect(objectives).toEqual({ scope: "course", objectives: [] });
  });
});

describe("saveConceptMap — round trip", () => {
  it("reloads the course concept map exactly as saved", async () => {
    const { store, packageId } = await seeded();
    const map: ConceptMap = {
      scope: "course",
      concepts: [
        { id: "energy", label: "Energy", prerequisites: [], related: [], blockIds: [] },
        {
          id: "enthalpy",
          label: "Enthalpy",
          prerequisites: ["energy"],
          related: ["energy"],
          blockIds: [],
        },
      ],
    };
    await saveConceptMap(store, packageId, map);
    const reloaded = await loadConceptMap(store, packageId, "course");
    expect(reloaded).toEqual(map);
  });
});

describe("saveObjectives — chapter scope round trip", () => {
  it("reloads chapter objectives by the same scope + slug", async () => {
    const { store, packageId } = await seeded();
    const objectives: Objectives = {
      scope: "chapter",
      objectives: [
        { id: "obj-1", text: "Explain enthalpy", conceptIds: ["enthalpy"], blockIds: [] },
      ],
    };
    await saveObjectives(store, packageId, objectives, "02-enthalpy");
    const reloaded = await loadObjectives(store, packageId, "chapter", "02-enthalpy");
    expect(reloaded).toEqual(objectives);
  });

  it("returns the empty default for a different chapter slug", async () => {
    const { store, packageId } = await seeded();
    const objectives: Objectives = {
      scope: "chapter",
      objectives: [{ id: "obj-1", text: "Explain enthalpy", conceptIds: [], blockIds: [] }],
    };
    await saveObjectives(store, packageId, objectives, "02-enthalpy");
    const other = await loadObjectives(store, packageId, "chapter", "03-entropy");
    expect(other).toEqual({ scope: "chapter", objectives: [] });
  });
});

describe("malformed save is rejected and writes nothing", () => {
  it("throws on a concept missing its label and persists no file", async () => {
    const { store, packageId } = await seeded();
    const bad = {
      scope: "course",
      concepts: [{ id: "energy" }], // missing required `label`
    } as unknown as ConceptMap;

    await expect(saveConceptMap(store, packageId, bad)).rejects.toThrow();

    const files = await store.listFiles(packageId);
    expect(files.some((f) => f.path === "concepts/course.json")).toBe(false);
  });

  it("throws when a chapter-scope save is missing a slug", async () => {
    const { store, packageId } = await seeded();
    const map: ConceptMap = { scope: "chapter", concepts: [] };
    await expect(saveConceptMap(store, packageId, map)).rejects.toThrow(/slug/i);
  });
});

describe("file placement", () => {
  it("lands the concept map under concepts/ in the PUBLIC repo", async () => {
    const { store, packageId } = await seeded();
    await saveConceptMap(store, packageId, { scope: "course", concepts: [] });
    const files = await store.listFiles(packageId);
    const file = files.find((f) => f.path === "concepts/course.json");
    expect(file).toBeDefined();
    expect(file!.repo).toBe("public");
  });

  it("lands objectives under objectives/ in the PUBLIC repo", async () => {
    const { store, packageId } = await seeded();
    await saveObjectives(store, packageId, { scope: "course", objectives: [] });
    const files = await store.listFiles(packageId);
    const file = files.find((f) => f.path === "objectives/course.json");
    expect(file).toBeDefined();
    expect(file!.repo).toBe("public");
  });
});

describe("facade", () => {
  it("exposes loadConceptMap through packageOps", async () => {
    const { store, packageId } = await seeded();
    const ops = packageOps(store, packageId);
    const map = await ops.loadConceptMap("course");
    expect(map).toEqual({ scope: "course", concepts: [] });
  });
});
