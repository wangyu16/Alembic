import { describe, it, expect } from "vitest";
import { extractSource } from "@alembic/carriers";
import { MemoryPackageStore } from "./memory-store";
import {
  AssetOperationError,
  listAssets,
  prepareAssetWrite,
  readAsset,
  writeAsset,
} from "./assets";

const PKG = "pkg-test";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
const KET_SOURCE = '{"root":{"nodes":[]},"molecule":"benzene"}';

describe("carrier asset ops", () => {
  it("writes a ketcher carrier under materials/ and round-trips its source", async () => {
    const store = new MemoryPackageStore();
    const res = await writeAsset(store, PKG, {
      path: "materials/structures/benzene.ketcher.svg",
      rendered: SVG,
      source: KET_SOURCE,
    });
    expect(res.kind).toBe("ketcher");
    // The written carrier embeds the source and still renders.
    expect(res.carrier).toContain("<svg");
    expect(extractSource(res.carrier).source).toBe(KET_SOURCE);

    const read = await readAsset(store, PKG, "materials/structures/benzene.ketcher.svg");
    expect(read.kind).toBe("ketcher");
    expect(read.source).toBe(KET_SOURCE);
    expect(read.contentHash).toBe(res.contentHash);
  });

  it("lists only recognized carrier assets in the public repo", async () => {
    const store = new MemoryPackageStore();
    await writeAsset(store, PKG, {
      path: "materials/plots/titration.plot.svg",
      rendered: SVG,
      source: '{"data":[]}',
    });
    // Non-carrier material + a private file must be ignored.
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/notes.md", content: "# notes" },
      { repo: "private", path: "private-instructor/key.ketcher.svg", content: SVG },
    ]);
    const assets = await listAssets(store, PKG);
    expect(assets.map((a) => a.path)).toEqual(["materials/plots/titration.plot.svg"]);
    expect(assets[0]!.kind).toBe("plot");
    expect(assets[0]!.role).toBe("asset");
  });

  it("rejects assets outside the materials layer", async () => {
    const store = new MemoryPackageStore();
    await expect(
      writeAsset(store, PKG, {
        path: "study-guide/intro.ketcher.svg",
        rendered: SVG,
        source: KET_SOURCE,
      }),
    ).rejects.toBeInstanceOf(AssetOperationError);
  });

  it("rejects unrecognized asset extensions", async () => {
    const store = new MemoryPackageStore();
    await expect(
      writeAsset(store, PKG, {
        path: "materials/figures/diagram.txt",
        rendered: "x",
        source: "x",
      }),
    ).rejects.toBeInstanceOf(AssetOperationError);
  });

  it("throws when reading a missing asset", async () => {
    const store = new MemoryPackageStore();
    await expect(
      readAsset(store, PKG, "materials/structures/nope.ketcher.svg"),
    ).rejects.toBeInstanceOf(AssetOperationError);
  });
});

/**
 * The prepare half (T15): kind + placement checks and the embedded carrier
 * bytes, with no store write, so the caller commits before it projects
 * (docs/specs/storage-and-write-paths.md §3).
 */
describe("prepareAssetWrite", () => {
  it("returns byte-identical output to what writeAsset persists", async () => {
    const store = new MemoryPackageStore();
    const input = {
      path: "materials/structures/benzene.ketcher.svg",
      rendered: SVG,
      source: KET_SOURCE,
    };
    const prepared = prepareAssetWrite(input);
    const persisted = await writeAsset(store, PKG, input);
    const written = (await store.listFiles(PKG)).find((f) => f.path === input.path);
    expect(prepared.file).toEqual(written);
    expect(prepared.result).toEqual(persisted);
    expect(extractSource(prepared.file.content).source).toBe(KET_SOURCE);
  });

  it("rejects assets outside the materials layer without writing", async () => {
    const store = new MemoryPackageStore();
    expect(() =>
      prepareAssetWrite({
        path: "study-guide/intro.ketcher.svg",
        rendered: SVG,
        source: KET_SOURCE,
      }),
    ).toThrow(AssetOperationError);
    expect(await store.listFiles(PKG)).toEqual([]);
  });

  it("rejects an unrecognized carrier extension", () => {
    expect(() =>
      prepareAssetWrite({
        path: "materials/figures/diagram.txt",
        rendered: "x",
        source: "x",
      }),
    ).toThrow(AssetOperationError);
  });
});
