import { describe, expect, it } from "vitest";
import {
  BLOCK_ID_PATTERN,
  CHAPTER_SLOTS,
  chapterSlotPaths,
  parseManifest,
  parseStudyGuide,
} from "@alembic/package-contract";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";
import {
  ChapterNotFoundError,
  ChapterOperationError,
  createChapter,
  deleteChapter,
  listChapters,
  renameChapter,
  renameChapterPageName,
  reorderChapters,
  setUnitTerm,
} from "./chapters";
import { DEFAULT_STUDY_GUIDE_PATH, chapterStudyGuidePath } from "./study-guide";
import type { CommitPlanInput, Committer } from "./write-through";

/** Records every commit plan it is handed (mirrors write-through.test.ts). */
function recordingCommitter(): Committer & { plans: CommitPlanInput[] } {
  const plans: CommitPlanInput[] = [];
  return {
    plans,
    async commit(plan) {
      plans.push(plan);
      return { commitSha: `sha-${plans.length}` };
    },
  };
}

function paths(store: MemoryPackageStore, packageId: string) {
  return store.listFiles(packageId).then((fs) =>
    fs.filter((f) => f.repo === "public").map((f) => f.path),
  );
}

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

  it("seeds a '# Title' preamble line plus a real '##' section — not preamble-only", async () => {
    const { store, packageId } = await seeded();
    const created = await createChapter(store, packageId, { title: "Enthalpy" });
    const files = await store.listFiles(packageId);
    const file = files.find((f) => f.repo === "public" && f.path === created.path)!;
    expect(file.content.startsWith("# Enthalpy")).toBe(true);
    const parsed = parseStudyGuide(file.content);
    expect(parsed.blocks.length).toBeGreaterThan(0);
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

describe("renameChapterPageName", () => {
  it("moves the study-guide file and updates the slug, keeping the title", async () => {
    const { store, packageId } = await seeded();
    await createChapter(store, packageId, { title: "Acids and Bases" }); // slug "acids-and-bases"

    const before = await listChapters(store, packageId);
    const ch = before.find((c) => c.slug === "acids-and-bases")!;
    expect(ch.title).toBe("Acids and Bases");

    const res = await renameChapterPageName(store, packageId, "acids-and-bases", "ch2");
    expect(res.slug).toBe("ch2");

    const after = await listChapters(store, packageId);
    const renamed = after.find((c) => c.slug === "ch2")!;
    expect(renamed.title).toBe("Acids and Bases"); // title unchanged
    expect(after.some((c) => c.slug === "acids-and-bases")).toBe(false);

    const all = await paths(store, packageId);
    expect(all).toContain(chapterStudyGuidePath("ch2"));
    expect(all).not.toContain(chapterStudyGuidePath("acids-and-bases"));
  });

  it("moves chapter-scoped concept map and objectives files too", async () => {
    const { store, packageId } = await seeded();
    await createChapter(store, packageId, { title: "Kinetics", slug: "kin" });
    // Seed chapter-scoped planning files by raw path.
    await store.putFiles(packageId, [
      { repo: "public", path: "concepts/kin.json", content: '{"scope":"chapter","concepts":[]}' },
      { repo: "public", path: "objectives/kin.json", content: '{"scope":"chapter","objectives":[]}' },
    ]);

    await renameChapterPageName(store, packageId, "kin", "kinetics");

    const all = await paths(store, packageId);
    expect(all).toContain("concepts/kinetics.json");
    expect(all).toContain("objectives/kinetics.json");
    expect(all).not.toContain("concepts/kin.json");
    expect(all).not.toContain("objectives/kin.json");
  });

  it("renames the implicit chapter off the default file", async () => {
    const { store, packageId } = await seeded();
    const res = await renameChapterPageName(store, packageId, IMPLICIT_SLUG, "intro");
    expect(res.slug).toBe("intro");
    const all = await paths(store, packageId);
    expect(all).toContain(chapterStudyGuidePath("intro"));
    expect(all).not.toContain(DEFAULT_STUDY_GUIDE_PATH);
  });

  it("rejects a duplicate page name", async () => {
    const { store, packageId } = await seeded();
    await createChapter(store, packageId, { title: "Two", slug: "two" });
    await expect(
      renameChapterPageName(store, packageId, "two", IMPLICIT_SLUG),
    ).rejects.toThrow(ChapterOperationError);
  });

  it("rejects an invalid page name", async () => {
    const { store, packageId } = await seeded();
    await expect(
      renameChapterPageName(store, packageId, IMPLICIT_SLUG, "Not Valid!"),
    ).rejects.toThrow(ChapterOperationError);
  });

  it("throws when the chapter doesn't exist", async () => {
    const { store, packageId } = await seeded();
    await expect(
      renameChapterPageName(store, packageId, "nope", "x"),
    ).rejects.toThrow(ChapterNotFoundError);
  });
});

describe("setUnitTerm", () => {
  it("sets the unit term in the manifest without touching chapters", async () => {
    const { store, packageId } = await seeded();
    await setUnitTerm(store, packageId, "module");
    const m = await readManifest(store, packageId);
    expect(m.unitTerm).toBe("module");
    expect(m.chapters).toBeUndefined(); // single implicit chapter untouched
  });
});

describe("manifest patches based on the FILE manifest (TH1 regression)", () => {
  it("keeps a newly created chapter when an unrelated field is patched", async () => {
    const { store, packageId } = await seeded();
    const created = await createChapter(store, packageId, { title: "Enthalpy" });

    // Simulate the fixed server-action pattern (e.g. setCourseInfoAction):
    // read the FILE manifest — never a stale packages.manifest column copy —
    // patch an unrelated field, and write alembic.json back.
    const base = await readManifest(store, packageId);
    const patched = parseManifest({ ...base, description: "A term of thermo." });
    await store.putFiles(packageId, [
      {
        repo: "public",
        path: "alembic.json",
        content: JSON.stringify(patched, null, 2) + "\n",
      },
    ]);

    const chapters = await listChapters(store, packageId);
    expect(chapters.map((c) => c.slug)).toEqual([IMPLICIT_SLUG, created.slug]);
    const m = await readManifest(store, packageId);
    expect(m.description).toBe("A term of thermo.");
    expect(m.chapters).toHaveLength(2);
  });
});

describe("renameChapterPageName moves EVERY chapter document (T11 regression)", () => {
  /**
   * The bug: the move list was hand-written from three file families (study
   * guide + the two `.json` planning records), so renaming a page name left
   * the chapter's concept map, assessment guide, slides and practice
   * documents stranded at the old slug — four of five documents orphaned.
   * The list is now derived from the slot table, so it cannot drift again.
   */
  it("moves all five slot documents plus both planning records", async () => {
    const { store, packageId } = await seeded();
    await createChapter(store, packageId, { title: "Kinetics", slug: "kin" });

    const oldSlots = chapterSlotPaths("kin");
    const newSlots = chapterSlotPaths("kinetics");
    await store.putFiles(packageId, [
      ...CHAPTER_SLOTS.map((slot) => ({
        repo: "public" as const,
        path: oldSlots[slot],
        content: `${slot} body`,
      })),
      {
        repo: "public" as const,
        path: "concepts/kin.json",
        content: '{"scope":"chapter","concepts":[]}',
      },
      {
        repo: "public" as const,
        path: "objectives/kin.json",
        content: '{"scope":"chapter","objectives":[]}',
      },
    ]);

    const res = await renameChapterPageName(store, packageId, "kin", "kinetics");

    const all = await paths(store, packageId);
    const files = await store.listFiles(packageId);
    for (const slot of CHAPTER_SLOTS) {
      expect(all).toContain(newSlots[slot]);
      expect(all).not.toContain(oldSlots[slot]);
      // content travels with the move, byte for byte
      expect(
        files.find((f) => f.repo === "public" && f.path === newSlots[slot])!.content,
      ).toBe(`${slot} body`);
    }
    expect(all).toContain("concepts/kinetics.json");
    expect(all).toContain("objectives/kinetics.json");
    expect(all).not.toContain("concepts/kin.json");
    expect(all).not.toContain("objectives/kin.json");

    // Nothing whatsoever is left behind under the old slug.
    expect(all.filter((p) => /(^|\/)kin\.[a-z.]+$/.test(p))).toEqual([]);
    expect(res.moved).toHaveLength(CHAPTER_SLOTS.length + 2);
    expect(res.manifest?.chapters?.some((c) => c.slug === "kinetics")).toBe(true);
  });

  it("moves only the documents that exist (empty slots stay empty)", async () => {
    const { store, packageId } = await seeded();
    await createChapter(store, packageId, { title: "Optics", slug: "opt" });
    // Only slides exist alongside the seeded study guide.
    await store.putFiles(packageId, [
      {
        repo: "public",
        path: chapterSlotPaths("opt").slides,
        content: "deck",
      },
    ]);

    const res = await renameChapterPageName(store, packageId, "opt", "optics");
    expect(res.moved.map((m) => m.to).sort()).toEqual(
      [chapterSlotPaths("optics").slides, chapterStudyGuidePath("optics")].sort(),
    );
    const all = await paths(store, packageId);
    expect(all).not.toContain(chapterSlotPaths("optics")["concept-map"]);
  });
});

describe("chapter writes go through the permanent store when one is supplied", () => {
  it("commits the manifest and the seeded file on create", async () => {
    const { store, packageId } = await seeded();
    const committer = recordingCommitter();
    const created = await createChapter(
      store,
      packageId,
      { title: "Enthalpy" },
      committer,
    );

    const committed = committer.plans.flatMap((p) =>
      p.changes.map((c) => c.path),
    );
    expect(committed).toContain("alembic.json");
    expect(committed).toContain(created.path);
    expect(committer.plans.every((p) => p.repo === "public")).toBe(true);
  });

  it("commits every moved document on a page-name rename", async () => {
    const { store, packageId } = await seeded();
    await createChapter(store, packageId, { title: "Kinetics", slug: "kin" });
    const oldSlots = chapterSlotPaths("kin");
    await store.putFiles(
      packageId,
      CHAPTER_SLOTS.map((slot) => ({
        repo: "public" as const,
        path: oldSlots[slot],
        content: `${slot} body`,
      })),
    );

    const committer = recordingCommitter();
    await renameChapterPageName(store, packageId, "kin", "kinetics", committer);

    const committed = committer.plans.flatMap((p) =>
      p.changes.map((c) => `${c.path}=${c.content === null ? "DELETE" : "KEEP"}`),
    );
    for (const slot of CHAPTER_SLOTS) {
      expect(committed).toContain(`${chapterSlotPaths("kinetics")[slot]}=KEEP`);
      expect(committed).toContain(`${oldSlots[slot]}=DELETE`);
    }
    expect(committed).toContain("alembic.json=KEEP");
  });

  it("does not touch the store when the commit fails", async () => {
    const { store, packageId } = await seeded();
    const before = (await store.listFiles(packageId))
      .map((f) => `${f.repo}\t${f.path}\t${f.content}`)
      .sort()
      .join("\n");
    const failing: Committer = {
      async commit() {
        throw new Error("network down");
      },
    };

    await expect(
      createChapter(store, packageId, { title: "Enthalpy" }, failing),
    ).rejects.toThrow("network down");

    const after = (await store.listFiles(packageId))
      .map((f) => `${f.repo}\t${f.path}\t${f.content}`)
      .sort()
      .join("\n");
    expect(after).toBe(before);
  });
});
