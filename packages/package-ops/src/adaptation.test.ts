import { describe, expect, it } from "vitest";
import { MemoryPackageStore } from "./memory-store";
import { createSandboxPackage } from "./create";
import { loadStudyGuide, saveStudyGuide } from "./study-guide";
import {
  adaptBlocksInto,
  adaptAssetInto,
  loadAdaptationProvenance,
  AdaptationNotAllowedError,
  ADAPTATIONS_PROVENANCE_PATH,
  ADAPTED_ASSET_DIR,
  prepareAdaptAssetInto,
  prepareAdaptBlocksInto,
  prepareAdaptGivenBlocksInto,
  type AdaptBlocksInput,
} from "./adaptation";
import { writeAsset } from "./assets";
import type { AdaptationSource } from "@alembic/package-contract";

async function pkg(store: MemoryPackageStore, license: "CC-BY-4.0" | "CC-BY-SA-4.0" | "CC-BY-NC-4.0") {
  const { packageId } = await createSandboxPackage(store, {
    ownerId: "u1",
    title: "P",
    license,
  });
  return packageId;
}

function attribution(sourcePackageId: string, license: AdaptationSource["license"]): AdaptationSource {
  return {
    packageId: sourcePackageId,
    title: "Source",
    license,
    attribution: "Dr. A, Some University",
    snapshot: "v1.0",
    adaptedAt: "2026-06-17T00:00:00Z",
  };
}

async function seedSource(store: MemoryPackageStore, packageId: string) {
  const doc = await loadStudyGuide(store, packageId);
  const { blocks } = await saveStudyGuide(store, packageId, {
    path: doc.path,
    preamble: doc.preamble,
    blocks: [
      { id: null, title: "Alpha", body: "Alpha body." },
      { id: null, title: "Beta", body: "Beta body." },
    ],
  });
  return { path: doc.path, blocks };
}

describe("adaptBlocksInto", () => {
  it("copies blocks with NEW ids, appends to the target, and records lineage", async () => {
    const store = new MemoryPackageStore();
    const src = await pkg(store, "CC-BY-4.0");
    const tgt = await pkg(store, "CC-BY-SA-4.0");
    const { path: srcPath, blocks: srcBlocks } = await seedSource(store, src);
    const tgtDoc = await loadStudyGuide(store, tgt);

    const input: AdaptBlocksInput = {
      source: { packageId: src, path: srcPath, blockIds: [srcBlocks[0]!.id!] },
      target: { packageId: tgt, path: tgtDoc.path, license: "CC-BY-SA-4.0" },
      attribution: attribution(src, "CC-BY-4.0"),
    };
    const res = await adaptBlocksInto(store, input);

    expect(res.newBlockIds).toHaveLength(1);
    expect(res.newBlockIds[0]).not.toBe(srcBlocks[0]!.id); // new id, never reused
    // lineage points back to the source block + snapshot
    expect(res.lineage[0]).toMatchObject({
      sourcePackageId: src,
      sourceBlockId: srcBlocks[0]!.id,
      snapshot: "v1.0",
    });
    // target chapter now contains the adapted block
    const reloaded = await loadStudyGuide(store, tgt, tgtDoc.path);
    expect(reloaded.blocks.some((b) => b.title === "Alpha")).toBe(true);
    // provenance persisted under the public provenance/ layer
    const prov = await loadAdaptationProvenance(store, tgt);
    expect(prov).toHaveLength(1);
    const files = await store.listFiles(tgt);
    expect(files.some((f) => f.repo === "public" && f.path === ADAPTATIONS_PROVENANCE_PATH)).toBe(true);
  });

  it("adapts the whole chapter when no blockIds are given", async () => {
    const store = new MemoryPackageStore();
    const src = await pkg(store, "CC-BY-4.0");
    const tgt = await pkg(store, "CC-BY-4.0");
    const { path: srcPath } = await seedSource(store, src);
    const tgtDoc = await loadStudyGuide(store, tgt);
    const res = await adaptBlocksInto(store, {
      source: { packageId: src, path: srcPath },
      target: { packageId: tgt, path: tgtDoc.path, license: "CC-BY-4.0" },
      attribution: attribution(src, "CC-BY-4.0"),
    });
    expect(res.newBlockIds).toHaveLength(2);
  });

  it("blocks a license-incompatible adaptation and writes nothing", async () => {
    const store = new MemoryPackageStore();
    const src = await pkg(store, "CC-BY-SA-4.0");
    const tgt = await pkg(store, "CC-BY-4.0");
    const { path: srcPath } = await seedSource(store, src);
    const tgtDoc = await loadStudyGuide(store, tgt);
    await expect(
      adaptBlocksInto(store, {
        source: { packageId: src, path: srcPath },
        target: { packageId: tgt, path: tgtDoc.path, license: "CC-BY-4.0" },
        attribution: attribution(src, "CC-BY-SA-4.0"), // SA → must stay SA
      }),
    ).rejects.toBeInstanceOf(AdaptationNotAllowedError);
    // nothing adapted; no provenance written
    expect(await loadAdaptationProvenance(store, tgt)).toHaveLength(0);
  });

  it("accumulates lineage across multiple adaptations", async () => {
    const store = new MemoryPackageStore();
    const src = await pkg(store, "CC-BY-4.0");
    const tgt = await pkg(store, "CC-BY-4.0");
    const { path: srcPath, blocks } = await seedSource(store, src);
    const tgtDoc = await loadStudyGuide(store, tgt);
    const common = { target: { packageId: tgt, path: tgtDoc.path, license: "CC-BY-4.0" as const }, attribution: attribution(src, "CC-BY-4.0") };
    await adaptBlocksInto(store, { source: { packageId: src, path: srcPath, blockIds: [blocks[0]!.id!] }, ...common });
    await adaptBlocksInto(store, { source: { packageId: src, path: srcPath, blockIds: [blocks[1]!.id!] }, ...common });
    expect(await loadAdaptationProvenance(store, tgt)).toHaveLength(2);
  });
});

/** Seed a carrier object (structure) in the source package; return its bytes. */
async function seedAsset(store: MemoryPackageStore, packageId: string, name = "benzene") {
  const path = `materials/structures/${name}.ketcher.svg`;
  const { carrier } = await writeAsset(store, packageId, {
    path,
    rendered: "<svg xmlns='http://www.w3.org/2000/svg'><title>ring</title></svg>",
    source: '{"root":{"nodes":[]}}',
  });
  return { path, carrier };
}

describe("adaptAssetInto", () => {
  it("copies a shared object VERBATIM into materials/adapted/ and reports its kind", async () => {
    const store = new MemoryPackageStore();
    const src = await pkg(store, "CC-BY-4.0");
    const tgt = await pkg(store, "CC-BY-SA-4.0");
    const { path: srcPath, carrier } = await seedAsset(store, src);

    const res = await adaptAssetInto(store, {
      target: { packageId: tgt, license: "CC-BY-SA-4.0" },
      source: { license: "CC-BY-4.0", carrier, path: srcPath },
    });

    expect(res.kind).toBe("ketcher");
    expect(res.path).toBe(`${ADAPTED_ASSET_DIR}/benzene.ketcher.svg`);
    // byte-for-byte copy — same embedded source, so identity is preserved
    const files = await store.listFiles(tgt);
    const written = files.find((f) => f.repo === "public" && f.path === res.path);
    expect(written?.content).toBe(carrier);
    // never touches the private repo
    expect(files.every((f) => f.repo === "public" || !f.path.includes("adapted"))).toBe(true);
  });

  it("dedupes a name collision with a numeric suffix", async () => {
    const store = new MemoryPackageStore();
    const src = await pkg(store, "CC-BY-4.0");
    const tgt = await pkg(store, "CC-BY-4.0");
    const { path: srcPath, carrier } = await seedAsset(store, src);
    const common = { target: { packageId: tgt, license: "CC-BY-4.0" as const }, source: { license: "CC-BY-4.0" as const, carrier, path: srcPath } };

    const first = await adaptAssetInto(store, { ...common, existingPaths: [] });
    const second = await adaptAssetInto(store, { ...common, existingPaths: [first.path] });
    expect(first.path).toBe(`${ADAPTED_ASSET_DIR}/benzene.ketcher.svg`);
    expect(second.path).toBe(`${ADAPTED_ASSET_DIR}/benzene-2.ketcher.svg`);
  });

  it("blocks a license-incompatible adaptation and writes nothing", async () => {
    const store = new MemoryPackageStore();
    const src = await pkg(store, "CC-BY-SA-4.0");
    const tgt = await pkg(store, "CC-BY-4.0");
    const { path: srcPath, carrier } = await seedAsset(store, src);
    await expect(
      adaptAssetInto(store, {
        target: { packageId: tgt, license: "CC-BY-4.0" },
        source: { license: "CC-BY-SA-4.0", carrier, path: srcPath }, // SA → must stay SA
      }),
    ).rejects.toBeInstanceOf(AdaptationNotAllowedError);
    const files = await store.listFiles(tgt);
    expect(files.some((f) => f.path.startsWith(ADAPTED_ASSET_DIR))).toBe(false);
  });

  it("rejects a source path that isn't a recognized object kind", async () => {
    const store = new MemoryPackageStore();
    const tgt = await pkg(store, "CC-BY-4.0");
    await expect(
      adaptAssetInto(store, {
        target: { packageId: tgt, license: "CC-BY-4.0" },
        source: { license: "CC-BY-4.0", carrier: "not a carrier", path: "materials/notes.txt" },
      }),
    ).rejects.toBeInstanceOf(AdaptationNotAllowedError);
  });
});

/**
 * The prepare half (T15): the license gate, the fresh ids and the merged
 * provenance record are all computed WITHOUT writing, so the caller commits
 * before it projects (docs/specs/storage-and-write-paths.md §3).
 */
describe("prepareAdaptGivenBlocksInto / prepareAdaptBlocksInto", () => {
  it("returns the target chapter and the provenance record without writing", async () => {
    const store = new MemoryPackageStore();
    const src = await pkg(store, "CC-BY-4.0");
    const tgt = await pkg(store, "CC-BY-SA-4.0");
    const { path: srcPath } = await seedSource(store, src);
    const tgtDoc = await loadStudyGuide(store, tgt);
    const before = await store.listFiles(tgt);

    const prepared = await prepareAdaptBlocksInto(store, {
      source: { packageId: src, path: srcPath },
      target: { packageId: tgt, path: tgtDoc.path, license: "CC-BY-SA-4.0" },
      attribution: attribution(src, "CC-BY-4.0"),
    });

    expect(prepared.files.map((f) => f.path)).toEqual([
      tgtDoc.path,
      ADAPTATIONS_PROVENANCE_PATH,
    ]);
    expect(prepared.files.every((f) => f.repo === "public")).toBe(true);
    expect(prepared.newBlockIds).toHaveLength(2);
    // Nothing was written: the target is byte-for-byte what it was.
    expect(await store.listFiles(tgt)).toEqual(before);
    expect(await loadAdaptationProvenance(store, tgt)).toEqual([]);
    // And the lineage bytes are the ones the write path would persist.
    expect(JSON.parse(prepared.files[1]!.content)).toEqual(prepared.lineage);
  });

  it("refuses an incompatible license before computing anything", async () => {
    const store = new MemoryPackageStore();
    const src = await pkg(store, "CC-BY-SA-4.0");
    const tgt = await pkg(store, "CC-BY-4.0");
    await expect(
      prepareAdaptGivenBlocksInto(store, {
        target: { packageId: tgt, path: "study-guide/01-getting-started.md", license: "CC-BY-4.0" },
        source: attribution(src, "CC-BY-SA-4.0"),
        sourcePath: "study-guide/01-getting-started.md",
        blocks: [{ sourceBlockId: "blk-aaaaaaaaaaaa", title: "A", body: "b" }],
      }),
    ).rejects.toBeInstanceOf(AdaptationNotAllowedError);
  });

  it("prepares nothing when there are no blocks to adapt", async () => {
    const store = new MemoryPackageStore();
    const src = await pkg(store, "CC-BY-4.0");
    const tgt = await pkg(store, "CC-BY-4.0");
    const prepared = await prepareAdaptGivenBlocksInto(store, {
      target: { packageId: tgt, path: "study-guide/01-getting-started.md", license: "CC-BY-4.0" },
      source: attribution(src, "CC-BY-4.0"),
      sourcePath: "study-guide/01-getting-started.md",
      blocks: [],
    });
    expect(prepared).toEqual({ newBlockIds: [], lineage: [], files: [] });
  });
});

describe("prepareAdaptAssetInto", () => {
  it("returns the verbatim carrier bytes at a public materials path", async () => {
    const store = new MemoryPackageStore();
    const src = await pkg(store, "CC-BY-4.0");
    const written = await writeAsset(store, src, {
      path: "materials/structures/benzene.ketcher.svg",
      rendered: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      source: '{"molecule":"benzene"}',
    });
    const prepared = prepareAdaptAssetInto({
      target: { packageId: "pkg-target", license: "CC-BY-SA-4.0" },
      source: { license: "CC-BY-4.0", carrier: written.carrier, path: written.path },
    });
    expect(prepared.file.repo).toBe("public");
    expect(prepared.file.path).toBe(`${ADAPTED_ASSET_DIR}/benzene.ketcher.svg`);
    expect(prepared.file.content).toBe(written.carrier); // byte-for-byte
    expect(prepared.result.contentHash).toBe(written.contentHash);
  });

  it("refuses an incompatible license", () => {
    expect(() =>
      prepareAdaptAssetInto({
        target: { packageId: "pkg-target", license: "CC-BY-4.0" },
        source: { license: "CC-BY-SA-4.0", carrier: "<svg></svg>", path: "materials/x.ketcher.svg" },
      }),
    ).toThrow(AdaptationNotAllowedError);
  });

  it("refuses a file that is not a reusable object", () => {
    expect(() =>
      prepareAdaptAssetInto({
        target: { packageId: "pkg-target", license: "CC-BY-4.0" },
        source: { license: "CC-BY-4.0", carrier: "text", path: "materials/notes.md" },
      }),
    ).toThrow(AdaptationNotAllowedError);
  });
});
