import { describe, expect, it } from "vitest";
import { BLOCK_ID_PATTERN } from "@alembic/package-contract";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";
import { loadStudyGuide } from "./study-guide";
import {
  ADAPTATIONS_PROVENANCE_PATH,
  AdaptationNotAllowedError,
  forkPackage,
} from "./adaptation";

async function source(license: "CC-BY-4.0" | "CC-BY-SA-4.0" = "CC-BY-4.0") {
  const store = new MemoryPackageStore();
  const { packageId, manifest } = await createSandboxPackage(store, {
    ownerId: "author",
    title: "Source Chem",
    license,
  });
  const doc = await loadStudyGuide(store, packageId);
  const blockId = doc.blocks[0]!.id!;
  // A chapter-scoped concept map that references the study-guide block id.
  await store.putFiles(packageId, [
    {
      repo: "public",
      path: "concepts/course.json",
      content: JSON.stringify({ scope: "course", links: [{ blockId }] }),
    },
  ]);
  const publicFiles = (await store.listFiles(packageId)).filter((f) => f.repo === "public");
  return { store, packageId, manifest, blockId, publicFiles };
}

describe("forkPackage", () => {
  it("clones public content with re-minted block ids and remapped references", async () => {
    const s = await source();
    const forked = forkPackage({
      source: { packageId: s.packageId, manifest: s.manifest, publicFiles: s.publicFiles },
      target: { ownerId: "adapter", title: "Adapted Chem", license: "CC-BY-4.0" },
      attribution: "Source Chem by author, CC-BY-4.0",
    });

    expect(forked.packageId).not.toBe(s.packageId);

    // Study-guide block ids are re-minted (never reused).
    const sg = forked.files.find((f) => f.path.startsWith("study-guide/"))!;
    expect(sg.content).not.toContain(s.blockId);
    const newId = forked.lineage[0]!.targetBlockId;
    expect(newId).toMatch(BLOCK_ID_PATTERN);
    expect(newId).not.toBe(s.blockId);

    // Lineage maps new → source.
    expect(forked.lineage[0]).toMatchObject({
      sourcePackageId: s.packageId,
      sourceBlockId: s.blockId,
    });

    // Concept-map reference to the block id is remapped to the new id.
    const concepts = forked.files.find((f) => f.path === "concepts/course.json")!;
    expect(concepts.content).toContain(newId);
    expect(concepts.content).not.toContain(s.blockId);
  });

  it("sets manifest.adaptedFrom and drops the source repo bindings", async () => {
    const s = await source();
    const forked = forkPackage({
      source: { packageId: s.packageId, manifest: s.manifest, publicFiles: s.publicFiles },
      target: { ownerId: "adapter", license: "CC-BY-4.0" },
      attribution: "by author",
    });
    expect(forked.manifest.adaptedFrom?.packageId).toBe(s.packageId);
    expect(forked.manifest.publicRepo).toBeUndefined();
    expect(forked.manifest.privateRepo).toBeUndefined();
  });

  it("regenerates manifest + provenance and seeds a private note", async () => {
    const s = await source();
    const forked = forkPackage({
      source: { packageId: s.packageId, manifest: s.manifest, publicFiles: s.publicFiles },
      target: { ownerId: "adapter", license: "CC-BY-4.0" },
      attribution: "by author",
    });
    const paths = forked.files.map((f) => f.path);
    expect(paths.filter((p) => p === "alembic.json")).toHaveLength(1);
    expect(forked.files.find((f) => f.path === ADAPTATIONS_PROVENANCE_PATH)).toBeDefined();
    expect(forked.files.some((f) => f.repo === "private")).toBe(true);
  });

  it("refuses an incompatible license (ShareAlike → non-SA)", () => {
    return source("CC-BY-SA-4.0").then((s) => {
      expect(() =>
        forkPackage({
          source: { packageId: s.packageId, manifest: s.manifest, publicFiles: s.publicFiles },
          target: { ownerId: "adapter", license: "CC-BY-4.0" },
          attribution: "by author",
        }),
      ).toThrow(AdaptationNotAllowedError);
    });
  });
});
