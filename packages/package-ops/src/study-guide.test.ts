import { describe, expect, it } from "vitest";
import { BLOCK_ID_PATTERN } from "@alembic/package-contract";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";
import {
  BlockIdIntegrityError,
  DEFAULT_STUDY_GUIDE_PATH,
  loadStudyGuide,
  saveStudyGuide,
} from "./study-guide";

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

describe("loadStudyGuide", () => {
  it("loads seeded blocks with their IDs", async () => {
    const { store, packageId } = await seeded();
    const doc = await loadStudyGuide(store, packageId);
    expect(doc.path).toBe(DEFAULT_STUDY_GUIDE_PATH);
    expect(doc.blocks.length).toBeGreaterThanOrEqual(1);
    expect(doc.blocks[0]?.id).toMatch(BLOCK_ID_PATTERN);
  });

  it("returns an empty doc for a package with no study guide", async () => {
    const store = new MemoryPackageStore();
    const doc = await loadStudyGuide(store, "pkg-missing");
    expect(doc.blocks).toEqual([]);
  });
});

describe("saveStudyGuide", () => {
  it("mints IDs for new blocks and preserves existing ones", async () => {
    const { store, packageId } = await seeded();
    const doc = await loadStudyGuide(store, packageId);
    const originalId = doc.blocks[0]!.id;

    doc.blocks.push({ id: null, title: "New Section", body: "fresh content" });
    const { blocks } = await saveStudyGuide(store, packageId, doc);

    expect(blocks[0]!.id).toBe(originalId); // preserved
    expect(blocks[1]!.id).toMatch(BLOCK_ID_PATTERN); // minted
  });

  it("persists changes so a reload sees them", async () => {
    const { store, packageId } = await seeded();
    const doc = await loadStudyGuide(store, packageId);
    doc.blocks[0]!.title = "Energy and Heat (revised)";
    doc.blocks[0]!.body = "Rewritten body.";
    await saveStudyGuide(store, packageId, doc);

    const reloaded = await loadStudyGuide(store, packageId);
    expect(reloaded.blocks[0]!.title).toBe("Energy and Heat (revised)");
    expect(reloaded.blocks[0]!.body).toBe("Rewritten body.");
    expect(reloaded.blocks[0]!.id).toBe(doc.blocks[0]!.id); // ID survived
  });

  it("rejects a save that would create duplicate IDs", async () => {
    const { store, packageId } = await seeded();
    const doc = await loadStudyGuide(store, packageId);
    const dupId = doc.blocks[0]!.id;
    doc.blocks.push({ id: dupId, title: "Clone", body: "x" });
    await expect(saveStudyGuide(store, packageId, doc)).rejects.toBeInstanceOf(
      BlockIdIntegrityError,
    );
  });

  it("writes the study guide only to the public partition", async () => {
    const { store, packageId } = await seeded();
    const doc = await loadStudyGuide(store, packageId);
    await saveStudyGuide(store, packageId, doc);
    const files = await store.listFiles(packageId);
    const guide = files.find((f) => f.path === DEFAULT_STUDY_GUIDE_PATH);
    expect(guide?.repo).toBe("public");
  });
});
