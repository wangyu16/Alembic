import { describe, it, expect } from "vitest";
import { PathLayerError, scopeForPath } from "@alembic/package-contract";
import { MemoryPackageStore } from "./memory-store";
import {
  collectionTree,
  deleteFolder,
  moveFile,
  moveFolder,
} from "./collections-tree";

const PKG = "pkg-tree";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
const CHAPTERS = ["01-intro", "02-step"] as const;

function opts(over: Partial<Parameters<typeof collectionTree>[2]> = {}) {
  return {
    spaceDir: "materials",
    repo: "public" as const,
    chapterSlugs: CHAPTERS,
    ...over,
  };
}

describe("collectionTree — folder tree read model", () => {
  it("nests free folders below the course prefix; files at the prefix are root files", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/readme.md", content: "x" },
      { repo: "public", path: "materials/figs/a.svg", content: SVG },
      { repo: "public", path: "materials/figs/nested/b.svg", content: SVG },
    ]);

    const trees = await collectionTree(store, PKG, opts());
    expect(trees).toHaveLength(1);
    const course = trees[0]!;
    expect(course.scope).toEqual({ kind: "course" });
    // root.path is the scope prefix itself.
    expect(course.root.path).toBe("materials");
    expect(course.root.name).toBe("");

    // File directly under the prefix -> root.files.
    expect(course.root.files.map((f) => f.name)).toEqual(["readme.md"]);

    // `figs` folder created, with the correct path.
    const figs = course.root.folders.find((f) => f.name === "figs")!;
    expect(figs.path).toBe("materials/figs");
    expect(figs.files.map((f) => f.path)).toEqual(["materials/figs/a.svg"]);

    // Deeper nesting.
    const nested = figs.folders.find((f) => f.name === "nested")!;
    expect(nested.path).toBe("materials/figs/nested");
    expect(nested.files.map((f) => f.path)).toEqual([
      "materials/figs/nested/b.svg",
    ]);
  });

  it("annotates each leaf with its handling class and carrier kind", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/guide.md.html", content: "<html></html>" },
      { repo: "public", path: "materials/benzene.ketcher.svg", content: SVG },
      { repo: "public", path: "materials/data.csv", content: "a,b" },
      { repo: "public", path: "materials/handout.pdf", content: "%PDF" },
      { repo: "public", path: "materials/mystery.xyzzy", content: "?" },
    ]);

    const trees = await collectionTree(store, PKG, opts());
    const byName = new Map(trees[0]!.root.files.map((f) => [f.name, f]));

    // A .md.html leaf is class `document`.
    expect(byName.get("guide.md.html")!.class).toBe("document");
    // Carrier kind still passed through (ketcher), class insertable-image.
    expect(byName.get("benzene.ketcher.svg")!.class).toBe("insertable-image");
    expect(byName.get("benzene.ketcher.svg")!.kind).toBe("ketcher");
    expect(byName.get("data.csv")!.class).toBe("insertable-source");
    expect(byName.get("handout.pdf")!.class).toBe("opaque-download");
    // Unknown extension defaults to opaque-download (never rejected).
    expect(byName.get("mystery.xyzzy")!.class).toBe("opaque-download");
    // A file whose extension maps to no carrier kind carries none.
    expect(byName.get("mystery.xyzzy")!.kind).toBeUndefined();
  });

  it("honors the package's additive fileTypes for class annotation", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/model.step", content: "STEP" },
    ]);

    const trees = await collectionTree(
      store,
      PKG,
      opts({
        fileTypes: [{ extension: ".step", label: "CAD model", class: "opaque-download" }],
      }),
    );
    expect(trees[0]!.root.files[0]!.class).toBe("opaque-download");
  });

  it("splits course vs chapter scope into separate trees, course-first then by slug", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/chapters/02-step/fig.svg", content: SVG },
      { repo: "public", path: "materials/chapters/01-intro/fig.svg", content: SVG },
      { repo: "public", path: "materials/readme.md", content: "x" },
    ]);

    const trees = await collectionTree(store, PKG, opts());
    expect(trees.map((t) => t.scope)).toEqual([
      { kind: "course" },
      { kind: "chapter", slug: "01-intro" },
      { kind: "chapter", slug: "02-step" },
    ]);
    // Chapter root.path is the chapter prefix; the file sits at its root.
    const ch1 = trees[1]!;
    expect(ch1.root.path).toBe("materials/chapters/01-intro");
    expect(ch1.root.files.map((f) => f.path)).toEqual([
      "materials/chapters/01-intro/fig.svg",
    ]);
  });

  it("nests free folders below a chapter prefix", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/chapters/02-step/figs/a.svg", content: SVG },
    ]);

    const trees = await collectionTree(store, PKG, opts());
    const chapter = trees.find((t) => t.scope.kind === "chapter")!;
    expect(chapter.root.path).toBe("materials/chapters/02-step");
    const figs = chapter.root.folders.find((f) => f.name === "figs")!;
    expect(figs.path).toBe("materials/chapters/02-step/figs");
    expect(figs.files.map((f) => f.path)).toEqual([
      "materials/chapters/02-step/figs/a.svg",
    ]);
  });

  it("puts a chapters/<unknown-slug>/ file in the COURSE tree (never a phantom chapter)", async () => {
    // scopeForPath already resolves an unknown slug to course scope.
    expect(
      scopeForPath("materials", "materials/chapters/99-ghost/fig.svg", CHAPTERS),
    ).toEqual({ kind: "course" });

    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/chapters/99-ghost/fig.svg", content: SVG },
    ]);

    const trees = await collectionTree(store, PKG, opts());
    expect(trees).toHaveLength(1);
    expect(trees[0]!.scope).toEqual({ kind: "course" });
    // It appears as a nested `chapters/99-ghost` folder under the course root.
    const chaptersFolder = trees[0]!.root.folders.find((f) => f.name === "chapters")!;
    const ghost = chaptersFolder.folders.find((f) => f.name === "99-ghost")!;
    expect(ghost.files.map((f) => f.path)).toEqual([
      "materials/chapters/99-ghost/fig.svg",
    ]);
  });

  it("orders folders before files, each by name", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/zeta.md", content: "z" },
      { repo: "public", path: "materials/alpha.md", content: "a" },
      { repo: "public", path: "materials/zzz/x.md", content: "x" },
      { repo: "public", path: "materials/aaa/y.md", content: "y" },
    ]);

    const root = (await collectionTree(store, PKG, opts()))[0]!.root;
    expect(root.folders.map((f) => f.name)).toEqual(["aaa", "zzz"]);
    expect(root.files.map((f) => f.name)).toEqual(["alpha.md", "zeta.md"]);
  });

  it("ignores files in other repos/spaces", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/keep.md", content: "k" },
      { repo: "public", path: "other-space/skip.md", content: "s" },
      { repo: "private", path: "materials/skip.md", content: "s" },
    ]);
    const trees = await collectionTree(store, PKG, opts());
    expect(trees).toHaveLength(1);
    expect(trees[0]!.root.files.map((f) => f.name)).toEqual(["keep.md"]);
  });
});

describe("moveFile", () => {
  it("reads, rewrites at the target, and deletes the source", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/a.svg", content: SVG },
    ]);
    await moveFile(store, PKG, "public", "materials/a.svg", "materials/figs/a.svg");
    const paths = (await store.listFiles(PKG)).map((f) => f.path);
    expect(paths).toEqual(["materials/figs/a.svg"]);
  });

  it("allows a cross-scope move (course -> chapter) within the same space", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/a.svg", content: SVG },
    ]);
    await moveFile(
      store,
      PKG,
      "public",
      "materials/a.svg",
      "materials/chapters/02-step/a.svg",
    );
    const paths = (await store.listFiles(PKG)).map((f) => f.path);
    expect(paths).toEqual(["materials/chapters/02-step/a.svg"]);
  });

  it("is a no-op when from === to (never self-deletes)", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/a.svg", content: SVG },
    ]);
    await moveFile(store, PKG, "public", "materials/a.svg", "materials/a.svg");
    expect((await store.listFiles(PKG)).map((f) => f.path)).toEqual([
      "materials/a.svg",
    ]);
  });

  it("throws when the source file is absent", async () => {
    const store = new MemoryPackageStore();
    await expect(
      moveFile(store, PKG, "public", "materials/nope.svg", "materials/x.svg"),
    ).rejects.toBeInstanceOf(PathLayerError);
  });

  it("is fail-closed on `..`, absolute, empty, and a space change", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/a.svg", content: SVG },
    ]);
    await expect(
      moveFile(store, PKG, "public", "materials/a.svg", "materials/../b.svg"),
    ).rejects.toBeInstanceOf(PathLayerError);
    await expect(
      moveFile(store, PKG, "public", "materials/a.svg", "/abs/b.svg"),
    ).rejects.toBeInstanceOf(PathLayerError);
    await expect(
      moveFile(store, PKG, "public", "materials/a.svg", ""),
    ).rejects.toBeInstanceOf(PathLayerError);
    // Changing the space (first segment) is refused.
    await expect(
      moveFile(store, PKG, "public", "materials/a.svg", "other-space/a.svg"),
    ).rejects.toBeInstanceOf(PathLayerError);
  });
});

describe("moveFolder", () => {
  it("moves every file under the prefix, prefix-boundary aware (a/b never drags a/bc)", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/a/b/one.md", content: "1" },
      { repo: "public", path: "materials/a/b/deep/two.md", content: "2" },
      { repo: "public", path: "materials/a/bc/three.md", content: "3" },
    ]);
    const moved = await moveFolder(store, PKG, "public", "materials/a/b", "materials/x");
    expect(moved).toBe(2);
    const paths = (await store.listFiles(PKG)).map((f) => f.path).sort();
    expect(paths).toEqual([
      "materials/a/bc/three.md", // untouched — a/bc is not under a/b
      "materials/x/deep/two.md",
      "materials/x/one.md",
    ]);
  });

  it("allows a cross-scope folder move and returns 0 when nothing matches", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/figs/a.svg", content: SVG },
    ]);
    const moved = await moveFolder(
      store,
      PKG,
      "public",
      "materials/figs",
      "materials/chapters/02-step/figs",
    );
    expect(moved).toBe(1);
    expect((await store.listFiles(PKG)).map((f) => f.path)).toEqual([
      "materials/chapters/02-step/figs/a.svg",
    ]);

    const none = await moveFolder(store, PKG, "public", "materials/absent", "materials/z");
    expect(none).toBe(0);
  });

  it("is fail-closed on `..`, absolute, and a space change", async () => {
    const store = new MemoryPackageStore();
    await expect(
      moveFolder(store, PKG, "public", "materials/a", "materials/../b"),
    ).rejects.toBeInstanceOf(PathLayerError);
    await expect(
      moveFolder(store, PKG, "public", "/abs", "materials/b"),
    ).rejects.toBeInstanceOf(PathLayerError);
    await expect(
      moveFolder(store, PKG, "public", "materials/a", "other-space/a"),
    ).rejects.toBeInstanceOf(PathLayerError);
  });
});

describe("deleteFolder", () => {
  it("removes only files at or under the prefix, boundary aware", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/a/b/one.md", content: "1" },
      { repo: "public", path: "materials/a/b/deep/two.md", content: "2" },
      { repo: "public", path: "materials/a/bc/three.md", content: "3" },
      { repo: "public", path: "materials/a/keep.md", content: "k" },
    ]);
    const count = await deleteFolder(store, PKG, "public", "materials/a/b");
    expect(count).toBe(2);
    const paths = (await store.listFiles(PKG)).map((f) => f.path).sort();
    expect(paths).toEqual(["materials/a/bc/three.md", "materials/a/keep.md"]);
  });

  it("does not cross repos and returns 0 when nothing matches", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "private", path: "materials/a/x.md", content: "x" },
    ]);
    // public repo has nothing under the prefix.
    expect(await deleteFolder(store, PKG, "public", "materials/a")).toBe(0);
    // private file survives.
    expect((await store.listFiles(PKG)).map((f) => f.path)).toEqual([
      "materials/a/x.md",
    ]);
  });

  it("is fail-closed on `..`, absolute, and empty", async () => {
    const store = new MemoryPackageStore();
    await expect(
      deleteFolder(store, PKG, "public", "materials/../etc"),
    ).rejects.toBeInstanceOf(PathLayerError);
    await expect(
      deleteFolder(store, PKG, "public", "/abs"),
    ).rejects.toBeInstanceOf(PathLayerError);
    await expect(
      deleteFolder(store, PKG, "public", ""),
    ).rejects.toBeInstanceOf(PathLayerError);
  });
});
