import { describe, expect, it } from "vitest";
import { ARTIFACT_ID_PATTERN } from "@alembic/package-contract";
import type { AIProvider, GenerateResult } from "@alembic/ai-assist";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";
import { loadStudyGuide, saveStudyGuide } from "./study-guide";
import {
  generateWorksheetArtifact,
  keepWorksheetMine,
  listArtifacts,
  regenerateWorksheetArtifact,
} from "./worksheets";

class FakeWorksheetProvider implements AIProvider {
  readonly name = "fake";
  calls = 0;
  async generateText(): Promise<GenerateResult> {
    this.calls++;
    return {
      text: `# Practice Worksheet\n\n1. Question (gen ${this.calls}).`,
      model: "fake-1",
    };
  }
}

async function setup() {
  const store = new MemoryPackageStore();
  const { packageId } = await createSandboxPackage(store, {
    ownerId: "u1",
    title: "Thermo",
    license: "CC-BY-4.0",
  });
  const provider = new FakeWorksheetProvider();
  const guide = await loadStudyGuide(store, packageId);
  return { store, packageId, provider, firstBlockId: guide.blocks[0]!.id! };
}

describe("generateWorksheetArtifact", () => {
  it("creates a worksheet file and an artifact record under .alembic", async () => {
    const { store, packageId, provider, firstBlockId } = await setup();
    const { record } = await generateWorksheetArtifact(store, packageId, {
      provider,
      blockIds: [firstBlockId],
      packageTitle: "Thermo",
    });
    expect(record.artifactId).toMatch(ARTIFACT_ID_PATTERN);

    const files = await store.listFiles(packageId);
    expect(files.some((f) => f.path.startsWith("materials/worksheets/"))).toBe(true);
    expect(
      files.some((f) => f.path === `.alembic/artifacts/${record.artifactId}.json`),
    ).toBe(true);
  });

  it("throws when no source blocks match", async () => {
    const { store, packageId, provider } = await setup();
    await expect(
      generateWorksheetArtifact(store, packageId, {
        provider,
        blockIds: ["blk-doesnotexist"],
      }),
    ).rejects.toThrow();
  });
});

describe("staleness lifecycle", () => {
  it("flags an artifact stale after its source block changes", async () => {
    const { store, packageId, provider, firstBlockId } = await setup();
    await generateWorksheetArtifact(store, packageId, {
      provider,
      blockIds: [firstBlockId],
    });
    expect((await listArtifacts(store, packageId))[0]?.stale).toBe(false);

    const guide = await loadStudyGuide(store, packageId);
    guide.blocks[0]!.body += "\n\nNew material added.";
    await saveStudyGuide(store, packageId, guide);

    expect((await listArtifacts(store, packageId))[0]?.stale).toBe(true);
  });

  it("regenerate clears staleness and re-runs the model", async () => {
    const { store, packageId, provider, firstBlockId } = await setup();
    const { record } = await generateWorksheetArtifact(store, packageId, {
      provider,
      blockIds: [firstBlockId],
    });
    const guide = await loadStudyGuide(store, packageId);
    guide.blocks[0]!.body += "\n\nchanged";
    await saveStudyGuide(store, packageId, guide);

    await regenerateWorksheetArtifact(store, packageId, record.artifactId, {
      provider,
    });
    const status = (await listArtifacts(store, packageId))[0];
    expect(status?.stale).toBe(false);
    expect(provider.calls).toBe(2); // initial + regenerate
  });

  it("keep-mine marks divergent and stops flagging", async () => {
    const { store, packageId, provider, firstBlockId } = await setup();
    const { record } = await generateWorksheetArtifact(store, packageId, {
      provider,
      blockIds: [firstBlockId],
    });
    const guide = await loadStudyGuide(store, packageId);
    guide.blocks[0]!.body += "\n\nchanged";
    await saveStudyGuide(store, packageId, guide);

    await keepWorksheetMine(store, packageId, record.artifactId, () =>
      new Date("2026-06-11T12:00:00Z"),
    );
    const status = (await listArtifacts(store, packageId))[0];
    expect(status?.stale).toBe(false);
    expect(status?.record.status).toBe("divergent");
    expect(status?.record.divergedAt).toBe("2026-06-11T12:00:00.000Z");
  });

  it("flags stale when a source block is deleted", async () => {
    const { store, packageId, provider, firstBlockId } = await setup();
    const { record } = await generateWorksheetArtifact(store, packageId, {
      provider,
      blockIds: [firstBlockId],
    });
    const guide = await loadStudyGuide(store, packageId);
    guide.blocks = guide.blocks.filter((b) => b.id !== firstBlockId);
    await saveStudyGuide(store, packageId, guide);

    const status = (await listArtifacts(store, packageId))[0];
    expect(status?.stale).toBe(true);
    expect(status?.missingBlocks).toContain(firstBlockId);
  });
});
