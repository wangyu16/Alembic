import { describe, expect, it } from "vitest";
import { MemoryPackageStore } from "./memory-store";
import { createSandboxPackage } from "./create";
import { loadStudyGuide, saveStudyGuide } from "./study-guide";
import { adaptBlocksInto } from "./adaptation";
import { applyUpstreamUpdate, detectUpstreamUpdates } from "./pull-updates";
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
