import { describe, expect, it } from "vitest";
import { BLOCK_ID_PATTERN, parseManifest } from "@alembic/package-contract";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";
import {
  ChapterNotFoundError,
  ChapterOperationError,
  createChapter,
  deleteChapter,
  listChapters,
  renameChapter,
  reorderChapters,
} from "./chapters";
import { DEFAULT_STUDY_GUIDE_PATH, chapterStudyGuidePath } from "./study-guide";

const input = {
  ownerId: "user-1",
  title: "Thermochemistry",
  license: "CC-BY-4.0" as const,
};

const IMPLICIT_SLUG = "01-getting-started";

async function seeded() {
  const store = new MemoryPackageStore();
  const { packageId } = await createSandboxPackage(store, input);
  return { store, packageId };
}

/** Read the manifest the same way the implementation does (source of truth). */
async function readManifest(store: MemoryPackageStore, packageId: string) {
  const files = await store.listFiles(packageId);
  const file = files.find((f) => f.repo === "public" && f.path === "alembic.json");
  return parseManifest(JSON.parse(file!.content));
}

describe("listChapters", () => {
  it("returns exactly one implicit chapter for a freshly seeded package", async () => {
    const { store, packageId } = await seeded();
    const chapters = await listChapters(store, packageId);
    expect(chapters).toEqual([
      {
        slug: IMPLICIT_SLUG,
        title: input.title,
        path: DEFAULT_STUDY_GUIDE_PATH,
      },
    ]);
  });

  it("does not write chapters to the manifest just by listing", async () => {
    const { store, packageId } = await seeded();
    await listChapters(store, packageId);
    const manifest = await readManifest(store, packageId);
    expect(manifest.chapters).toBeUndefined();
  });
});

describe("createChapter", () => {
  it("materializes the implicit chapter on first create", async () => {
    const { store, packageId } = await seeded();
    await createChapter(store, packageId, { title: "Enthalpy" });

    const manifest = await readManifest(store, packageId);
    expect(manifest.chapters).toHaveLength(2);
    expect(manifest.chapters?.[0]).toEqual({
      slug: IMPLICIT_SLUG,
      title: input.title,
    });
    expect(manifest.chapters?.[1]?.slug).toBe("enthalpy");
  });

  it("seeds a study-guide file carrying a valid block id", async () => {
    const { store, packageId } = await seeded();
    const created = await createChapter(store, packageId, { title: "Enthalpy" });

    expect(created.path).toBe(chapterStudyGuidePath("enthalpy"));
    const files = await store.listFiles(packageId);
    const file = files.find((f) => f.repo === "public" && f.path === created.path);
    expect(file).toBeDefined();
    const match = file!.content.match(/\{\{attrs\[#([^\]]+)\]\}\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(BLOCK_ID_PATTERN);
  });

  it("derives a slug from the title", async () => {
    const { store, packageId } = await seeded();
    const created = await createChapter(store, packageId, {
      title: "Acids & Bases!",
    });
    expect(created.slug).toBe("acids-bases");
  });

  it("uses a provided slug when given", async () => {
    const { store, packageId } = await seeded();
    const created = await createChapter(store, packageId, {
      title: "Equilibrium",
      slug: "chem-eq",
    });
    expect(created.slug).toBe("chem-eq");
  });

  it("mints unique slugs on collision", async () => {
    const { store, packageId } = await seeded();
    const a = await createChapter(store, packageId, { title: "Kinetics" });
    const b = await createChapter(store, packageId, { title: "Kinetics" });
    const c = await createChapter(store, packageId, { title: "Kinetics" });
    expect(a.slug).toBe("kinetics");
    expect(b.slug).toBe("kinetics-2");
    expect(c.slug).toBe("kinetics-3");
  });

  it("rejects a title that yields no valid slug", async () => {
    const { store, packageId } = await seeded();
    await expect(
      createChapter(store, packageId, { title: "!!!" }),
    ).rejects.toBeInstanceOf(ChapterOperationError);
  });

  it("appends without re-materializing once chapters exist", async () => {
    const { store, packageId } = await seeded();
    await createChapter(store, packageId, { title: "One" });
    await createChapter(store, packageId, { title: "Two" });
    const chapters = await listChapters(store, packageId);
    expect(chapters.map((c) => c.slug)).toEqual([
      IMPLICIT_SLUG,
      "one",
      "two",
    ]);
  });
});

describe("renameChapter", () => {
  it("changes the title and keeps the slug stable", async () => {
    const { store, packageId } = await seeded();
    await createChapter(store, packageId, { title: "Enthalpy" });
    await renameChapter(store, packageId, "enthalpy", "Enthalpy & Entropy");

    const chapters = await listChapters(store, packageId);
    const ch = chapters.find((c) => c.slug === "enthalpy");
    expect(ch?.title).toBe("Enthalpy & Entropy");
    expect(ch?.path).toBe(chapterStudyGuidePath("enthalpy"));
  });

  it("can rename the implicit chapter (materializing it)", async () => {
    const { store, packageId } = await seeded();
    await renameChapter(store, packageId, IMPLICIT_SLUG, "Intro");
    const manifest = await readManifest(store, packageId);
    expect(manifest.chapters).toHaveLength(1);
    expect(manifest.chapters?.[0]?.title).toBe("Intro");
  });

  it("throws ChapterNotFoundError for an unknown slug", async () => {
    const { store, packageId } = await seeded();
    await expect(
      renameChapter(store, packageId, "nope", "X"),
    ).rejects.toBeInstanceOf(ChapterNotFoundError);
  });
});

describe("reorderChapters", () => {
  it("rewrites chapters in the given order", async () => {
    const { store, packageId } = await seeded();
    await createChapter(store, packageId, { title: "One" });
    await createChapter(store, packageId, { title: "Two" });

    await reorderChapters(store, packageId, ["two", "one", IMPLICIT_SLUG]);
    const chapters = await listChapters(store, packageId);
    expect(chapters.map((c) => c.slug)).toEqual([
      "two",
      "one",
      IMPLICIT_SLUG,
    ]);
  });

  it("rejects a non-permutation", async () => {
    const { store, packageId } = await seeded();
    await createChapter(store, packageId, { title: "One" });

    await expect(
      reorderChapters(store, packageId, ["one"]),
    ).rejects.toBeInstanceOf(ChapterOperationError);
    await expect(
      reorderChapters(store, packageId, ["one", "one"]),
    ).rejects.toBeInstanceOf(ChapterOperationError);
    await expect(
      reorderChapters(store, packageId, [IMPLICIT_SLUG, "ghost"]),
    ).rejects.toBeInstanceOf(ChapterOperationError);
  });
});

describe("deleteChapter", () => {
  it("removes the manifest entry and the study-guide file", async () => {
    const { store, packageId } = await seeded();
    const created = await createChapter(store, packageId, { title: "Enthalpy" });

    await deleteChapter(store, packageId, "enthalpy");

    const manifest = await readManifest(store, packageId);
    expect(manifest.chapters?.map((c) => c.slug)).toEqual([IMPLICIT_SLUG]);

    const files = await store.listFiles(packageId);
    expect(files.find((f) => f.path === created.path)).toBeUndefined();
  });

  it("throws when deleting the only chapter", async () => {
    const { store, packageId } = await seeded();
    await expect(
      deleteChapter(store, packageId, IMPLICIT_SLUG),
    ).rejects.toBeInstanceOf(ChapterOperationError);
  });

  it("throws ChapterNotFoundError for an unknown slug", async () => {
    const { store, packageId } = await seeded();
    await createChapter(store, packageId, { title: "Enthalpy" });
    await expect(
      deleteChapter(store, packageId, "nope"),
    ).rejects.toBeInstanceOf(ChapterNotFoundError);
  });
});

describe("listChapters reflects all changes end-to-end", () => {
  it("tracks create, rename, reorder, delete", async () => {
    const { store, packageId } = await seeded();
    await createChapter(store, packageId, { title: "Alpha" });
    await createChapter(store, packageId, { title: "Beta" });
    await renameChapter(store, packageId, "alpha", "Alpha Prime");
    await reorderChapters(store, packageId, ["beta", "alpha", IMPLICIT_SLUG]);
    await deleteChapter(store, packageId, IMPLICIT_SLUG);

    const chapters = await listChapters(store, packageId);
    expect(chapters).toEqual([
      { slug: "beta", title: "Beta", path: chapterStudyGuidePath("beta") },
      {
        slug: "alpha",
        title: "Alpha Prime",
        path: chapterStudyGuidePath("alpha"),
      },
    ]);
  });
});
