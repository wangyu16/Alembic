import { describe, expect, it } from "vitest";
import { parseManifest } from "@alembic/package-contract";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";
import {
  COURSE_CONCEPT_MAP_PATH,
  chapterDescriptionPath,
  loadCourseConceptMap,
  setCourseConceptMap,
} from "./metadata";

const input = { ownerId: "u1", title: "Thermo", license: "CC-BY-4.0" as const };

async function seeded() {
  const store = new MemoryPackageStore();
  const { packageId } = await createSandboxPackage(store, input);
  return { store, packageId };
}

async function readManifest(store: MemoryPackageStore, packageId: string) {
  const files = await store.listFiles(packageId);
  const f = files.find((x) => x.repo === "public" && x.path === "alembic.json");
  return parseManifest(JSON.parse(f!.content));
}

describe("setCourseConceptMap / loadCourseConceptMap", () => {
  it("writes metadata/course.md verbatim, free-form", async () => {
    const { store, packageId } = await seeded();
    const md = "# Big ideas\n\n- enthalpy -> entropy -> free energy\n\nObjective: explain Gibbs.\n";
    await setCourseConceptMap(store, packageId, md);
    expect(await loadCourseConceptMap(store, packageId)).toBe(md);
  });

  it("never touches manifest.description or manifest.keywords", async () => {
    const { store, packageId } = await seeded();
    const before = await readManifest(store, packageId);
    await setCourseConceptMap(store, packageId, "Some free-form concept notes.");
    const after = await readManifest(store, packageId);
    expect(after.description).toBe(before.description);
    expect(after.keywords).toEqual(before.keywords);
  });

  it("loadCourseConceptMap is null before anything is set", async () => {
    const { store, packageId } = await seeded();
    expect(await loadCourseConceptMap(store, packageId)).toBeNull();
  });

  it("chapterDescriptionPath is a metadata-layer path", () => {
    expect(chapterDescriptionPath("acids")).toBe("metadata/acids.md");
    expect(COURSE_CONCEPT_MAP_PATH).toBe("metadata/course.md");
  });
});
