import { describe, expect, it } from "vitest";
import { MemoryPackageStore } from "./memory-store";
import { createSandboxPackage } from "./create";
import { loadStudyGuide, saveStudyGuide } from "./study-guide";
import { ADAPTATIONS_PROVENANCE_PATH, adaptBlocksInto } from "./adaptation";
import {
  applyUpstreamUpdate,
  detectUpstreamUpdates,
  prepareUpstreamUpdate,
} from "./pull-updates";
import type { AdaptationSource } from "@alembic/package-contract";

async function setup() {
  const store = new MemoryPackageStore();
  const { packageId: src } = await createSandboxPackage(store, { ownerId: "u1", title: "Src", license: "CC-BY-4.0" });
  const { packageId: tgt } = await createSandboxPackage(store, { ownerId: "u1", title: "Tgt", license: "CC-BY-4.0" });

  const srcDoc = await loadStudyGuide(store, src);
  const { blocks: srcBlocks } = await saveStudyGuide(store, src, {
    path: srcDoc.path,
    preamble: srcDoc.preamble,
    blocks: [{ id: null, title: "Acids", body: "Original acids body." }],
  });
  const tgtDoc = await loadStudyGuide(store, tgt);

  const attribution: AdaptationSource = {
    packageId: src, title: "Src", license: "CC-BY-4.0",
    attribution: "Dr. A", adaptedAt: "2026-06-17T00:00:00Z",
  };
  const res = await adaptBlocksInto(store, {
    source: { packageId: src, path: srcDoc.path },
    target: { packageId: tgt, path: tgtDoc.path, license: "CC-BY-4.0" },
    attribution,
  });
  return { store, src, tgt, srcPath: srcDoc.path, tgtPath: tgtDoc.path, srcBlockId: srcBlocks[0]!.id!, targetBlockId: res.newBlockIds[0]! };
}

describe("pull updates", () => {
  it("detects no update right after adaptation", async () => {
    const { store, tgt, tgtPath } = await setup();
    expect(await detectUpstreamUpdates(store, tgt, tgtPath)).toHaveLength(0);
  });

  it("detects an upstream change to an adapted block", async () => {
    const { store, src, srcPath, srcBlockId, tgt, tgtPath } = await setup();
    // upstream edits the source block
    const srcDoc = await loadStudyGuide(store, src, srcPath);
    srcDoc.blocks.find((b) => b.id === srcBlockId)!.body = "Revised acids body (upstream).";
    await saveStudyGuide(store, src, srcDoc);

    const updates = await detectUpstreamUpdates(store, tgt, tgtPath);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.upstreamBody).toContain("Revised");
  });

  it("take applies upstream content and clears the flag", async () => {
    const { store, src, srcPath, srcBlockId, tgt, tgtPath, targetBlockId } = await setup();
    const srcDoc = await loadStudyGuide(store, src, srcPath);
    srcDoc.blocks.find((b) => b.id === srcBlockId)!.body = "Revised body.";
    await saveStudyGuide(store, src, srcDoc);

    const r = await applyUpstreamUpdate(store, tgt, tgtPath, targetBlockId, "take");
    expect(r.applied).toBe(true);
    const tgtDoc = await loadStudyGuide(store, tgt, tgtPath);
    expect(tgtDoc.blocks.find((b) => b.id === targetBlockId)!.body).toContain("Revised");
    // no longer flagged
    expect(await detectUpstreamUpdates(store, tgt, tgtPath)).toHaveLength(0);
  });

  it("keep leaves the adapter's content but clears the flag (recorded divergence)", async () => {
    const { store, src, srcPath, srcBlockId, tgt, tgtPath, targetBlockId } = await setup();
    const srcDoc = await loadStudyGuide(store, src, srcPath);
    srcDoc.blocks.find((b) => b.id === srcBlockId)!.body = "Upstream changed.";
    await saveStudyGuide(store, src, srcDoc);

    const r = await applyUpstreamUpdate(store, tgt, tgtPath, targetBlockId, "keep");
    expect(r.applied).toBe(true);
    const tgtDoc = await loadStudyGuide(store, tgt, tgtPath);
    // adapter's content unchanged
    expect(tgtDoc.blocks.find((b) => b.id === targetBlockId)!.body).toContain("Original acids body.");
    // but the change is acknowledged → no longer flagged
    expect(await detectUpstreamUpdates(store, tgt, tgtPath)).toHaveLength(0);
  });
});

/**
 * The prepare half (T15): "take"/"keep" is worked out and the resulting bytes
 * returned, with nothing written, so the caller commits before it projects
 * (docs/specs/storage-and-write-paths.md §3).
 */
describe("prepareUpstreamUpdate", () => {
  async function drifted() {
    const ctx = await setup();
    const srcDoc = await loadStudyGuide(ctx.store, ctx.src, ctx.srcPath);
    srcDoc.blocks[0]!.body = "Revised acids body.";
    await saveStudyGuide(ctx.store, ctx.src, srcDoc);
    return ctx;
  }

  it('"take" returns the updated chapter AND the advanced provenance, writing neither', async () => {
    const { store, tgt, tgtPath, targetBlockId } = await drifted();
    const before = await store.listFiles(tgt);

    const prepared = await prepareUpstreamUpdate(store, tgt, tgtPath, targetBlockId, "take");
    expect(prepared.applied).toBe(true);
    expect(prepared.files.map((f) => f.path)).toEqual([
      tgtPath,
      ADAPTATIONS_PROVENANCE_PATH,
    ]);
    expect(prepared.content).toBe(prepared.files[0]!.content);
    expect(prepared.files[0]!.content).toContain("Revised acids body.");
    // Nothing persisted yet.
    expect(await store.listFiles(tgt)).toEqual(before);
  });

  it('"keep" advances only the provenance record', async () => {
    const { store, tgt, tgtPath, targetBlockId } = await drifted();
    const prepared = await prepareUpstreamUpdate(store, tgt, tgtPath, targetBlockId, "keep");
    expect(prepared.applied).toBe(true);
    expect(prepared.files.map((f) => f.path)).toEqual([ADAPTATIONS_PROVENANCE_PATH]);
    expect(prepared.content).toBeUndefined();
  });

  it("prepares nothing for an unknown block", async () => {
    const { store, tgt, tgtPath } = await drifted();
    expect(
      await prepareUpstreamUpdate(store, tgt, tgtPath, "blk-zzzzzzzzzzzz", "take"),
    ).toEqual({ applied: false, files: [] });
  });

  it("applyUpstreamUpdate persists exactly the prepared bytes", async () => {
    const { store, tgt, tgtPath, targetBlockId } = await drifted();
    const prepared = await prepareUpstreamUpdate(store, tgt, tgtPath, targetBlockId, "take");
    const result = await applyUpstreamUpdate(store, tgt, tgtPath, targetBlockId, "take");
    expect(result).toEqual({ applied: true, content: prepared.content });
    const after = await store.listFiles(tgt);
    for (const file of prepared.files) {
      expect(after).toContainEqual(file);
    }
  });
});
