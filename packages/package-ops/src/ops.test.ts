import { describe, expect, it } from "vitest";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";
import { packageOps } from "./ops";

async function setup() {
  const store = new MemoryPackageStore();
  const { packageId } = await createSandboxPackage(store, {
    ownerId: "u1",
    title: "Thermo",
    license: "CC-BY-4.0",
  });
  return { ops: packageOps(store, packageId) };
}

describe("packageOps facade", () => {
  it("round-trips the study guide through the bound operations", async () => {
    const { ops } = await setup();
    const doc = await ops.loadStudyGuide();
    const { blocks } = await ops.saveStudyGuide({
      path: doc.path,
      preamble: doc.preamble,
      blocks: [...doc.blocks, { id: null, title: "New", body: "Body." }],
    });
    expect(blocks.at(-1)!.id).toMatch(/^blk-/); // id minted via the same path
    const reloaded = await ops.loadStudyGuide();
    expect(reloaded.blocks.some((b) => b.title === "New")).toBe(true);
  });

  it("creates and lists chapters via the facade", async () => {
    const { ops } = await setup();
    await ops.createChapter({ title: "Kinetics" });
    const chapters = await ops.listChapters();
    expect(chapters.some((c) => c.title === "Kinetics")).toBe(true);
  });

  it("writes and lists a carrier asset via the facade", async () => {
    const { ops } = await setup();
    await ops.writeAsset({
      path: "materials/structures/x.ketcher.svg",
      rendered: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      source: "{}",
    });
    const assets = await ops.listAssets();
    expect(assets.some((a) => a.kind === "ketcher")).toBe(true);
  });
});
