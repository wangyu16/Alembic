import { describe, it, expect } from "vitest";
import { scopeForPath } from "@alembic/package-contract";
import { MemoryPackageStore } from "./memory-store";
import { collectionItemPath, listCollection } from "./collections";

const PKG = "pkg-collections";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
const CHAPTERS = ["01-intro", "02-step"] as const;

describe("listCollection (Assets, public materials)", () => {
  it("annotates course-root, named-folder, and chapter-scoped files", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/readme.md", content: "x" },
      { repo: "public", path: "materials/structures/benzene.ketcher.svg", content: SVG },
      { repo: "public", path: "materials/chapters/02-step/fig.svg", content: SVG },
    ]);

    const items = await listCollection(store, PKG, {
      spaceDir: "materials",
      repo: "public",
      chapterSlugs: CHAPTERS,
    });

    const byPath = new Map(items.map((i) => [i.path, i]));
    expect(byPath.get("materials/readme.md")!.scope).toEqual({ kind: "course" });
    expect(byPath.get("materials/structures/benzene.ketcher.svg")!.scope).toEqual({
      kind: "course",
    });
    expect(byPath.get("materials/chapters/02-step/fig.svg")!.scope).toEqual({
      kind: "chapter",
      slug: "02-step",
    });
    // Carrier kind is annotated where the extension maps to a registered kind.
    expect(byPath.get("materials/structures/benzene.ketcher.svg")!.kind).toBe(
      "ketcher",
    );
    // Plain (non-carrier) files carry no kind.
    expect(byPath.get("materials/readme.md")!.kind).toBeUndefined();
  });

  it("treats a chapters/<unknown-slug>/ file as COURSE scope, never a phantom chapter", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/chapters/99-ghost/fig.svg", content: SVG },
    ]);

    const items = await listCollection(store, PKG, {
      spaceDir: "materials",
      repo: "public",
      chapterSlugs: CHAPTERS,
    });

    expect(items).toHaveLength(1);
    expect(items[0]!.scope).toEqual({ kind: "course" });
  });

  it("excludes files that live in other spaces", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/keep.svg", content: SVG },
      { repo: "public", path: "study-guide/intro.md", content: "# hi" },
      { repo: "public", path: "materials-extra/decoy.svg", content: SVG }, // prefix, not the space
    ]);

    const items = await listCollection(store, PKG, {
      spaceDir: "materials",
      repo: "public",
      chapterSlugs: CHAPTERS,
    });

    expect(items.map((i) => i.path)).toEqual(["materials/keep.svg"]);
  });

  it("lists the private space from the private repo", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "private", path: "private-instructor/notes.md", content: "notes" },
      {
        repo: "private",
        path: "private-instructor/chapters/01-intro/key.md",
        content: "key",
      },
      // A public file in a differently-named space must not leak in.
      { repo: "public", path: "materials/pub.svg", content: SVG },
    ]);

    const items = await listCollection(store, PKG, {
      spaceDir: "private-instructor",
      repo: "private",
      chapterSlugs: CHAPTERS,
    });

    expect(items.map((i) => i.path)).toEqual([
      "private-instructor/notes.md",
      "private-instructor/chapters/01-intro/key.md",
    ]);
    expect(items[1]!.scope).toEqual({ kind: "chapter", slug: "01-intro" });
  });

  it("orders course-wide first, then by chapter slug, then by path", async () => {
    const store = new MemoryPackageStore();
    // Inserted deliberately out of order to prove the sort is not insertion order.
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/chapters/02-step/z.svg", content: SVG },
      { repo: "public", path: "materials/chapters/02-step/a.svg", content: SVG },
      { repo: "public", path: "materials/chapters/01-intro/fig.svg", content: SVG },
      { repo: "public", path: "materials/zeta.svg", content: SVG },
      { repo: "public", path: "materials/alpha.svg", content: SVG },
    ]);

    const items = await listCollection(store, PKG, {
      spaceDir: "materials",
      repo: "public",
      chapterSlugs: CHAPTERS,
    });

    expect(items.map((i) => i.path)).toEqual([
      "materials/alpha.svg",
      "materials/zeta.svg",
      "materials/chapters/01-intro/fig.svg",
      "materials/chapters/02-step/a.svg",
      "materials/chapters/02-step/z.svg",
    ]);
  });
});

describe("listCollection (multi-segment spaceDir — Current)", () => {
  it("restricts to current/<term-id> and resolves scope under it", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "current/2026-fall/announcements/a.md", content: "x" },
      { repo: "public", path: "current/2026-fall/chapters/02-step/hw.md.html", content: "x" },
      // Sibling term prefix — must NOT be captured by `current/2026-fall`.
      { repo: "public", path: "current/2026-fall-draft/misc/note.md", content: "x" },
      // A different term entirely.
      { repo: "public", path: "current/2027-spring/misc/x.md", content: "x" },
    ]);

    const items = await listCollection(store, PKG, {
      spaceDir: "current/2026-fall",
      repo: "public",
      chapterSlugs: CHAPTERS,
    });

    expect(items.map((i) => i.path).sort()).toEqual([
      "current/2026-fall/announcements/a.md",
      "current/2026-fall/chapters/02-step/hw.md.html",
    ]);
    const byPath = new Map(items.map((i) => [i.path, i]));
    expect(byPath.get("current/2026-fall/announcements/a.md")!.scope).toEqual({
      kind: "course",
    });
    expect(byPath.get("current/2026-fall/chapters/02-step/hw.md.html")!.scope).toEqual({
      kind: "chapter",
      slug: "02-step",
    });
  });

  it("single-segment spaceDir still excludes a sibling prefix (materials vs materials-x)", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "materials/a.svg", content: SVG },
      { repo: "public", path: "materials-backup/b.svg", content: SVG },
    ]);
    const items = await listCollection(store, PKG, {
      spaceDir: "materials",
      repo: "public",
      chapterSlugs: CHAPTERS,
    });
    expect(items.map((i) => i.path)).toEqual(["materials/a.svg"]);
  });
});

describe("collectionItemPath", () => {
  it("targets the space root for course scope", () => {
    expect(collectionItemPath("materials", { kind: "course" }, "cover.png")).toBe(
      "materials/cover.png",
    );
    // Nested rest (kindDir/file) is preserved.
    expect(
      collectionItemPath(
        "materials",
        { kind: "course" },
        "structures/benzene.ketcher.svg",
      ),
    ).toBe("materials/structures/benzene.ketcher.svg");
  });

  it("routes into chapters/<slug>/ for chapter scope", () => {
    expect(
      collectionItemPath("materials", { kind: "chapter", slug: "02-step" }, "fig.svg"),
    ).toBe("materials/chapters/02-step/fig.svg");
  });

  // A write-target builder must never hand back a path that escapes its space,
  // even though the writers reject `..` too. Both branches fail closed alike.
  it("refuses to build an escaping path, on BOTH scopes", () => {
    for (const scope of [
      { kind: "course" } as const,
      { kind: "chapter", slug: "02-step" } as const,
    ]) {
      expect(() =>
        collectionItemPath("materials", scope, "../private-instructor/keys.md"),
      ).toThrow();
      expect(() => collectionItemPath("materials", scope, "/etc/passwd")).toThrow();
      expect(() => collectionItemPath("materials", scope, "")).toThrow();
    }
  });

  it("round-trips through scopeForPath for both scopes", () => {
    const course = collectionItemPath("materials", { kind: "course" }, "x.svg");
    expect(scopeForPath("materials", course, CHAPTERS)).toEqual({ kind: "course" });

    const chapter = collectionItemPath(
      "materials",
      { kind: "chapter", slug: "01-intro" },
      "y.svg",
    );
    expect(scopeForPath("materials", chapter, CHAPTERS)).toEqual({
      kind: "chapter",
      slug: "01-intro",
    });
  });

  it("round-trips through listCollection's scope annotation", async () => {
    const store = new MemoryPackageStore();
    const coursePath = collectionItemPath("materials", { kind: "course" }, "root.svg");
    const chapterPath = collectionItemPath(
      "materials",
      { kind: "chapter", slug: "02-step" },
      "in-chapter.svg",
    );
    await store.putFiles(PKG, [
      { repo: "public", path: coursePath, content: SVG },
      { repo: "public", path: chapterPath, content: SVG },
    ]);

    const items = await listCollection(store, PKG, {
      spaceDir: "materials",
      repo: "public",
      chapterSlugs: CHAPTERS,
    });
    const byPath = new Map(items.map((i) => [i.path, i.scope]));
    expect(byPath.get(coursePath)).toEqual({ kind: "course" });
    expect(byPath.get(chapterPath)).toEqual({ kind: "chapter", slug: "02-step" });
  });
});
