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
  prepareProposedChangeSet,
} from "./coherence";

const input = {
  ownerId: "user-1",
  title: "Thermochemistry",
  license: "CC-BY-4.0" as const,
};

async function seeded() {
  const store = new MemoryPackageStore();
  const { packageId } = await createSandboxPackage(store, input);
  // Packages are created empty (slots, not placeholders — spec §4). Author the
  // first chapter through the real save path; `seededWithExtraBlocks` appends
  // to it, so this keeps that helper's block indices stable.
  await saveStudyGuide(store, packageId, {
    path: "study-guide/01-getting-started.md",
    preamble: "",
    blocks: [{ id: null, title: "Getting started", body: "First section." }],
  });
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

/**
 * The prepare half (T15): the full set is validated against the live course and
 * the per-chapter bytes computed, with NOTHING written — so an accepted
 * proposal can be committed before it is projected
 * (docs/specs/storage-and-write-paths.md §3), and a set that throws part-way
 * leaves no half-applied chapters behind.
 */
describe("prepareProposedChangeSet", () => {
  it("returns the chapter bytes applyProposedChangeSet would write, writing none", async () => {
    const { store, packageId, slug, path, ids } = await seededWithExtraBlocks();
    const before = await store.listFiles(packageId);

    const prepared = await prepareProposedChangeSet(
      store,
      packageId,
      makeSet([
        { op: "update-block", chapterSlug: slug, blockId: ids[0]!, body: "prepared body", rationale: "test" },
      ]),
    );

    expect(prepared.chaptersChanged).toEqual([slug]);
    expect(prepared.files.map((f) => f.path)).toEqual([path]);
    expect(prepared.files[0]!.repo).toBe("public");
    expect(prepared.files[0]!.content).toContain("prepared body");
    // Untouched store.
    expect(await store.listFiles(packageId)).toEqual(before);

    // …and persisting the set produces exactly those bytes.
    await applyProposedChangeSet(
      store,
      packageId,
      makeSet([
        { op: "update-block", chapterSlug: slug, blockId: ids[0]!, body: "prepared body", rationale: "test" },
      ]),
    );
    const written = (await store.listFiles(packageId)).find(
      (f) => f.repo === "public" && f.path === path,
    );
    expect(written).toEqual(prepared.files[0]);
  });

  it("refuses an invalid set without preparing anything", async () => {
    const { store, packageId, slug } = await seededWithExtraBlocks();
    await expect(
      prepareProposedChangeSet(
        store,
        packageId,
        makeSet([
          { op: "update-block", chapterSlug: slug, blockId: "blk-zzzzzzzzzzzz", body: "x", rationale: "test" },
        ]),
      ),
    ).rejects.toThrow();
  });

  it("mints ids for created blocks in the prepared bytes", async () => {
    const { store, packageId, slug, ids } = await seededWithExtraBlocks();
    const prepared = await prepareProposedChangeSet(
      store,
      packageId,
      makeSet([
        {
          op: "create-block",
          chapterSlug: slug,
          afterBlockId: ids[0]!,
          title: "Fresh",
          body: "new body",
          rationale: "test",
        },
      ]),
    );
    const created = prepared.blocksByChapter[slug]!.find((b) => b.title === "Fresh");
    expect(created!.id).toMatch(BLOCK_ID_PATTERN);
    expect(prepared.files[0]!.content).toContain(created!.id!);
  });
});
