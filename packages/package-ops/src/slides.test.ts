import { describe, expect, it } from "vitest";
import { extractSlides } from "@alembic/renderer";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";
import { listArtifacts } from "./worksheets";
import { generateSlidesArtifact } from "./slides";

async function setup() {
  const store = new MemoryPackageStore();
  const { packageId } = await createSandboxPackage(store, {
    ownerId: "u1",
    title: "Thermo",
    license: "CC-BY-4.0",
  });
  return { store, packageId };
}

describe("generateSlidesArtifact", () => {
  it("writes a .slides.html carrier + a derived-artifact record (kind slides)", async () => {
    const { store, packageId } = await setup();
    const { record, carrier } = await generateSlidesArtifact(store, packageId, {
      packageTitle: "Thermo",
    });
    expect(record.kind).toBe("slides");
    expect(record.path.startsWith("materials/slides/")).toBe(true);
    expect(record.path.endsWith(".slides.html")).toBe(true);

    // The carrier round-trips its embedded deck source.
    expect(extractSlides(carrier)).not.toBeNull();

    const files = await store.listFiles(packageId);
    expect(files.some((f) => f.path === record.path)).toBe(true);
    expect(
      files.some((f) => f.path === `.alembic/artifacts/${record.artifactId}.json`),
    ).toBe(true);
  });

  it("regenerates in place (same path + artifact id)", async () => {
    const { store, packageId } = await setup();
    const first = await generateSlidesArtifact(store, packageId, {});
    const second = await generateSlidesArtifact(store, packageId, {});
    expect(second.record.artifactId).toBe(first.record.artifactId);
    expect(second.record.path).toBe(first.record.path);
    const decks = (await store.listFiles(packageId)).filter((f) =>
      f.path.startsWith("materials/slides/"),
    );
    expect(decks).toHaveLength(1);
  });

  it("appears in listArtifacts and goes stale when a source block changes", async () => {
    const { store, packageId } = await setup();
    const { record } = await generateSlidesArtifact(store, packageId, {});
    let arts = await listArtifacts(store, packageId);
    const slide = arts.find((a) => a.record.artifactId === record.artifactId);
    expect(slide?.stale).toBe(false);

    // Mutate a source block, then re-list: the deck should read stale.
    const { loadStudyGuide, saveStudyGuide } = await import("./study-guide");
    const guide = await loadStudyGuide(store, packageId);
    await saveStudyGuide(store, packageId, {
      path: guide.path,
      preamble: guide.preamble,
      blocks: guide.blocks.map((b, i) =>
        i === 0 ? { ...b, body: b.body + "\n\nEdited." } : b,
      ),
    });
    arts = await listArtifacts(store, packageId);
    expect(arts.find((a) => a.record.artifactId === record.artifactId)?.stale).toBe(true);
  });
});
