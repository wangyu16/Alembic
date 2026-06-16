import { describe, it, expect } from "vitest";
import { extractSource } from "@alembic/carriers";
import { MemoryPackageStore } from "./memory-store";
import {
  AssetOperationError,
  listAssets,
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
