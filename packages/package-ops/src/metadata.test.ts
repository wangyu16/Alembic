import { describe, expect, it } from "vitest";
import { parseManifest } from "@alembic/package-contract";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";
import {
  COURSE_DESCRIPTION_PATH,
  chapterDescriptionPath,
  deriveDescription,
  loadCourseDescription,
  setCourseDescription,
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

describe("deriveDescription", () => {
  it("takes the first paragraph, skipping a leading heading", () => {
    expect(deriveDescription("# Title\n\nA course on heat and energy.\n\nMore.")).toBe(
      "A course on heat and energy.",
    );
  });

  it("strips inline markdown (links, emphasis, code, images)", () => {
    const md = "See **enthalpy** and [Hess's law](x.md) with `q=mcΔT` ![d](materials/a.svg).";
    expect(deriveDescription(md)).toBe("See enthalpy and Hess's law with q=mcΔT .");
  });

  it("collapses to the first paragraph only", () => {
    expect(deriveDescription("One two.\nthree.\n\nSecond para.")).toBe("One two. three.");
  });

  it("caps long text at a word boundary with an ellipsis", () => {
    const long = "word ".repeat(100);
    const out = deriveDescription(long);
    expect(out.length).toBeLessThanOrEqual(301);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns empty for heading-only / blank input", () => {
    expect(deriveDescription("# Only a title\n\n## Sub")).toBe("");
  });
});

describe("setCourseDescription", () => {
  it("writes metadata/course.md and derives manifest.description", async () => {
    const { store, packageId } = await seeded();
    const md = "# Intro\n\nA general chemistry course covering thermochemistry.\n";
    const { description } = await setCourseDescription(store, packageId, md);

    expect(description).toBe("A general chemistry course covering thermochemistry.");
    expect(await loadCourseDescription(store, packageId)).toBe(md); // canonical file
    const manifest = await readManifest(store, packageId);
    expect(manifest.description).toBe(description); // derived, in sync
  });

  it("loadCourseDescription is null before any description is set", async () => {
    const { store, packageId } = await seeded();
    expect(await loadCourseDescription(store, packageId)).toBeNull();
  });

  it("chapterDescriptionPath is a metadata-layer path", () => {
    expect(chapterDescriptionPath("acids")).toBe("metadata/acids.md");
    expect(COURSE_DESCRIPTION_PATH).toBe("metadata/course.md");
  });
});
