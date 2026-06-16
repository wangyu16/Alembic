import { describe, expect, it } from "vitest";
import {
  BLOCK_ID_PATTERN,
  PROPOSED_CHANGE_SET_VERSION,
  type ProposedChangeSet,
} from "@alembic/package-contract";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";
import { listChapters } from "./chapters";
import { loadStudyGuide, saveStudyGuide } from "./study-guide";
import {
  applyProposedChangeSet,
  blockIdsByChapter,
  gatherCoherenceContext,
} from "./coherence";

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

/**
 * Add two extra blocks to the (single) seeded chapter so reorder/create tests
 * have something to work with, then return the chapter slug and its block ids.
 */
async function seededWithExtraBlocks() {
  const { store, packageId } = await seeded();
  const [chapter] = await listChapters(store, packageId);
  const doc = await loadStudyGuide(store, packageId, chapter!.path);
  doc.blocks.push({ id: null, title: "Second", body: "second body" });
  doc.blocks.push({ id: null, title: "Third", body: "third body" });
  await saveStudyGuide(store, packageId, doc);
  const reloaded = await loadStudyGuide(store, packageId, chapter!.path);
  return {
    store,
    packageId,
    slug: chapter!.slug,
    path: chapter!.path,
    ids: reloaded.blocks.map((b) => b.id!),
  };
}

function makeSet(operations: ProposedChangeSet["operations"]): ProposedChangeSet {
  return {
    version: PROPOSED_CHANGE_SET_VERSION,
    task: "improve coherence",
    summary: "test change set",
    findings: [],
    operations,
  };
}

describe("gatherCoherenceContext", () => {
  it("returns chapters with their persisted blocks (ids present)", async () => {
    const { store, packageId } = await seeded();
    const ctx = await gatherCoherenceContext(store, packageId);

    expect(ctx.chapters.length).toBeGreaterThanOrEqual(1);
    const chapter = ctx.chapters[0]!;
    expect(chapter.slug).toBeTruthy();
    expect(chapter.blocks.length).toBeGreaterThanOrEqual(1);
    for (const block of chapter.blocks) {
      expect(block.id).toMatch(BLOCK_ID_PATTERN);
      expect(typeof block.body).toBe("string");
    }
  });

  it("blockIdsByChapter maps each slug to its block ids", async () => {
    const { store, packageId, slug, ids } = await seededWithExtraBlocks();
    const ctx = await gatherCoherenceContext(store, packageId);
    expect(blockIdsByChapter(ctx)[slug]).toEqual(ids);
  });
});

describe("applyProposedChangeSet", () => {
  it("update-block changes the body and preserves the id", async () => {
    const { store, packageId, slug, path, ids } = await seededWithExtraBlocks();
    const targetId = ids[0]!;

    const result = await applyProposedChangeSet(
      store,
      packageId,
      makeSet([
        {
          op: "update-block",
          chapterSlug: slug,
          blockId: targetId,
          body: "rewritten by the agent",
          rationale: "clarity",
        },
      ]),
    );

    expect(result.chaptersChanged).toEqual([slug]);

    const reloaded = await loadStudyGuide(store, packageId, path);
    const block = reloaded.blocks.find((b) => b.id === targetId);
    expect(block?.id).toBe(targetId); // preserved
    expect(block?.body).toBe("rewritten by the agent");
  });

  it("create-block inserts after the named block with a freshly minted id", async () => {
    const { store, packageId, slug, path, ids } = await seededWithExtraBlocks();
    const afterId = ids[0]!;

    await applyProposedChangeSet(
      store,
      packageId,
      makeSet([
        {
          op: "create-block",
          chapterSlug: slug,
          afterBlockId: afterId,
          title: "Inserted",
          body: "inserted body",
          rationale: "fills a gap",
        },
      ]),
    );

    const reloaded = await loadStudyGuide(store, packageId, path);
    const afterIdx = reloaded.blocks.findIndex((b) => b.id === afterId);
    const inserted = reloaded.blocks[afterIdx + 1]!;
    expect(inserted.title).toBe("Inserted");
    expect(inserted.body).toBe("inserted body");
    expect(inserted.id).toMatch(BLOCK_ID_PATTERN);
    expect(inserted.id).not.toBe(afterId);
  });

  it("create-block with afterBlockId null prepends", async () => {
    const { store, packageId, slug, path } = await seededWithExtraBlocks();

    await applyProposedChangeSet(
      store,
      packageId,
      makeSet([
        {
          op: "create-block",
          chapterSlug: slug,
          afterBlockId: null,
          title: "Front",
          body: "front body",
          rationale: "intro",
        },
      ]),
    );

    const reloaded = await loadStudyGuide(store, packageId, path);
    expect(reloaded.blocks[0]!.title).toBe("Front");
    expect(reloaded.blocks[0]!.id).toMatch(BLOCK_ID_PATTERN);
  });

  it("reorder-blocks reorders within a chapter", async () => {
    const { store, packageId, slug, path, ids } = await seededWithExtraBlocks();
    const reversed = [...ids].reverse();

    await applyProposedChangeSet(
      store,
      packageId,
      makeSet([
        {
          op: "reorder-blocks",
          chapterSlug: slug,
          orderedBlockIds: reversed,
          rationale: "better sequence",
        },
      ]),
    );

    const reloaded = await loadStudyGuide(store, packageId, path);
    expect(reloaded.blocks.map((b) => b.id)).toEqual(reversed);
  });

  it("throws on an invalid set (update referencing a missing id) and writes nothing", async () => {
    const { store, packageId, slug, path } = await seededWithExtraBlocks();
    const before = await loadStudyGuide(store, packageId, path);

    await expect(
      applyProposedChangeSet(
        store,
        packageId,
        makeSet([
          {
            op: "update-block",
            chapterSlug: slug,
            blockId: "blk-doesnotexist",
            body: "nope",
            rationale: "x",
          },
        ]),
      ),
    ).rejects.toThrow();

    const after = await loadStudyGuide(store, packageId, path);
    expect(after.blocks.map((b) => ({ id: b.id, body: b.body }))).toEqual(
      before.blocks.map((b) => ({ id: b.id, body: b.body })),
    );
  });

  it("operationIndices applies only the selected subset", async () => {
    const { store, packageId, slug, path, ids } = await seededWithExtraBlocks();

    await applyProposedChangeSet(
      store,
      packageId,
      makeSet([
        {
          op: "update-block",
          chapterSlug: slug,
          blockId: ids[0]!,
          body: "changed via index 0",
          rationale: "a",
        },
        {
          op: "update-block",
          chapterSlug: slug,
          blockId: ids[1]!,
          body: "should be skipped",
          rationale: "b",
        },
      ]),
      { operationIndices: [0] },
    );

    const reloaded = await loadStudyGuide(store, packageId, path);
    expect(reloaded.blocks.find((b) => b.id === ids[0])?.body).toBe(
      "changed via index 0",
    );
    expect(reloaded.blocks.find((b) => b.id === ids[1])?.body).toBe(
      "second body",
    );
  });
});
