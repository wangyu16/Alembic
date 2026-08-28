import { describe, expect, it } from "vitest";
import {
  BLOCK_ID_PATTERN,
  serializeStudyGuide,
} from "@alembic/package-contract";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";
import {
  BlockIdIntegrityError,
  DEFAULT_STUDY_GUIDE_PATH,
  loadStudyGuide,
  prepareStudyGuideBlocks,
  prepareStudyGuideSave,
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
  // Packages are created empty (slots, not placeholders). Author the first
  // chapter's study guide the way an educator would, so the fixture exercises
  // the real save path and gets a minted block id.
  await saveStudyGuide(store, packageId, {
    path: DEFAULT_STUDY_GUIDE_PATH,
    preamble: "",
    blocks: [{ id: null, title: "Getting started", body: "First section." }],
  });
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

  it("rejects a save whose content references a private file (two-repo boundary)", async () => {
    const { store, packageId } = await seeded();
    const doc = await loadStudyGuide(store, packageId);
    doc.blocks[0]!.body = "See the key ![key](private-instructor/answer-key.md).";
    await expect(saveStudyGuide(store, packageId, doc)).rejects.toThrow();
    // And nothing was persisted (fail-closed before putFiles).
    const reloaded = await loadStudyGuide(store, packageId);
    expect(reloaded.blocks[0]!.body).not.toContain("private-instructor");
  });

  it("allows a save that references a public materials file", async () => {
    const { store, packageId } = await seeded();
    const doc = await loadStudyGuide(store, packageId);
    doc.blocks[0]!.body = "Structure ![benzene](materials/structures/benzene.ketcher.svg).";
    await expect(saveStudyGuide(store, packageId, doc)).resolves.toBeDefined();
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

/**
 * The prepare half (T15). `prepareStudyGuideSave` performs every check
 * `saveStudyGuide` performs and writes NOTHING, so a published package can
 * commit the returned bytes before it projects them
 * (docs/specs/storage-and-write-paths.md §3). It takes the caller's in-memory
 * doc rather than re-reading the store, which is what lets several edits stage
 * onto one file in order.
 */
describe("prepareStudyGuideBlocks", () => {
  it("mints only the missing IDs and returns canonical bytes", () => {
    const { blocks, content } = prepareStudyGuideBlocks({
      preamble: "# Thermochemistry",
      blocks: [
        { id: "blk-aaaaaaaaaaaa", title: "Enthalpy", body: "Kept." },
        { id: null, title: "Hess's law", body: "New." },
      ],
    });
    expect(blocks[0]!.id).toBe("blk-aaaaaaaaaaaa"); // rule 7: never re-minted
    expect(blocks[1]!.id).toMatch(BLOCK_ID_PATTERN);
    expect(content).toBe(serializeStudyGuide("# Thermochemistry", blocks));
  });

  it("rejects duplicate IDs instead of repairing them", () => {
    expect(() =>
      prepareStudyGuideBlocks({
        preamble: "",
        blocks: [
          { id: "blk-aaaaaaaaaaaa", title: "One", body: "" },
          { id: "blk-aaaaaaaaaaaa", title: "Two", body: "" },
        ],
      }),
    ).toThrow(BlockIdIntegrityError);
  });

  it("rejects a malformed ID", () => {
    expect(() =>
      prepareStudyGuideBlocks({
        preamble: "",
        blocks: [{ id: "not-a-block-id", title: "One", body: "" }],
      }),
    ).toThrow(BlockIdIntegrityError);
  });
});

describe("prepareStudyGuideSave", () => {
  it("returns the exact file saveStudyGuide would write, byte-for-byte", async () => {
    const store = new MemoryPackageStore();
    const doc = {
      path: DEFAULT_STUDY_GUIDE_PATH,
      preamble: "# T",
      blocks: [{ id: "blk-bbbbbbbbbbbb", title: "A", body: "x" }],
    };
    const prepared = prepareStudyGuideSave(doc);
    await saveStudyGuide(store, "pkg-1", doc);
    const written = (await store.listFiles("pkg-1")).find(
      (f) => f.repo === "public" && f.path === DEFAULT_STUDY_GUIDE_PATH,
    );
    expect(prepared.file).toEqual(written);
  });

  it("writes nothing — a rejected save leaves the store untouched", async () => {
    const store = new MemoryPackageStore();
    expect(() =>
      prepareStudyGuideSave({
        path: DEFAULT_STUDY_GUIDE_PATH,
        preamble: "",
        blocks: [{ id: null, title: "X", body: "![k](private-instructor/key.md)" }],
      }),
    ).toThrow();
    expect(await store.listFiles("pkg-1")).toEqual([]);
  });

  it("fails closed on a path the public repo refuses", () => {
    expect(() =>
      prepareStudyGuideSave({
        path: "private-instructor/notes/x.md",
        preamble: "",
        blocks: [],
      }),
    ).toThrow();
  });

  it("stages in order: each call takes the caller's blocks, not the store", () => {
    const first = prepareStudyGuideSave({
      path: DEFAULT_STUDY_GUIDE_PATH,
      preamble: "# T",
      blocks: [{ id: null, title: "One", body: "1" }],
    });
    // The second call builds on the FIRST call's returned blocks — the
    // accumulation the batch-accept path depends on, with no store in between.
    const second = prepareStudyGuideSave({
      path: DEFAULT_STUDY_GUIDE_PATH,
      preamble: "# T",
      blocks: [...first.blocks, { id: null, title: "Two", body: "2" }],
    });
    expect(second.blocks.map((b) => b.id)[0]).toBe(first.blocks[0]!.id);
    expect(second.file.content).toContain("One");
    expect(second.file.content).toContain("Two");
  });
});
