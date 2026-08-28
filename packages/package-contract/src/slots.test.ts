import { describe, expect, it } from "vitest";
import { assertPathAllowedInRepo, RepoBoundaryViolation } from "./layers";
import { assertPathAllowedInRepoV2 } from "./spaces";
import {
  CHAPTER_SLOTS,
  CHAPTER_SLOT_SPECS,
  InvalidChapterSlugError,
  PUBLISHED_CHAPTER_SLOTS,
  SPINE_CHAPTER_SLOTS,
  chapterSlotPaths,
  isChapterSlug,
  isPublishedSlot,
  isSlotPath,
  slotForPath,
  slotPath,
  slotRepo,
  type ChapterSlot,
} from "./slots";

/** Valid chapter slugs, including the implicit-chapter default. */
const SLUGS = [
  "01-getting-started",
  "acids",
  "ch2",
  "02-thermochemistry",
  "a",
  "1",
  "kinetics-and-equilibrium",
];

describe("CHAPTER_SLOTS", () => {
  it("declares the five per-chapter documents", () => {
    expect(CHAPTER_SLOTS).toEqual([
      "concept-map",
      "study-guide",
      "slides",
      "assessment-guide",
      "practice",
    ]);
  });

  it("gives every slot a complete spec", () => {
    for (const slot of CHAPTER_SLOTS) {
      const spec = CHAPTER_SLOT_SPECS[slot];
      expect(spec.dir).toBeTruthy();
      expect(spec.extension).toBe(".md");
      expect(spec.repo).toBe("public");
      expect(typeof spec.published).toBe("boolean");
      expect(spec.label).toBeTruthy();
    }
  });

  it("uses a distinct directory per slot (the classifier depends on it)", () => {
    const dirs = CHAPTER_SLOTS.map((s) => CHAPTER_SLOT_SPECS[s].dir);
    expect(new Set(dirs).size).toBe(dirs.length);
  });

  it("splits into published documents and the unpublished spine", () => {
    expect(PUBLISHED_CHAPTER_SLOTS).toEqual(["study-guide", "slides", "practice"]);
    expect(SPINE_CHAPTER_SLOTS).toEqual(["concept-map", "assessment-guide"]);
    for (const slot of CHAPTER_SLOTS) {
      expect(isPublishedSlot(slot)).toBe(PUBLISHED_CHAPTER_SLOTS.includes(slot));
    }
  });

  it("keeps the spine public-repo but off the student site", () => {
    // document-model.md §2 rows 1 & 4: unpublished, NOT private.
    for (const slot of SPINE_CHAPTER_SLOTS) {
      expect(slotRepo(slot)).toBe("public");
      expect(isPublishedSlot(slot)).toBe(false);
    }
  });
});

describe("slotPath", () => {
  it("matches the canonical paths already produced by package-ops", () => {
    expect(slotPath("study-guide", "01-getting-started")).toBe(
      "study-guide/01-getting-started.md",
    );
    expect(slotPath("practice", "acids")).toBe("practice/acids.md");
    expect(slotPath("slides", "acids")).toBe("slides/acids.md");
    expect(slotPath("concept-map", "acids")).toBe("concepts/acids.md");
    expect(slotPath("assessment-guide", "acids")).toBe("assessment-support/acids.md");
  });

  it("rejects a malformed chapter slug (fail closed)", () => {
    for (const bad of ["", "Acids", "acids/../x", "a b", "acids-", "-acids", "a--b", "x.md"]) {
      expect(() => slotPath("study-guide", bad)).toThrow(InvalidChapterSlugError);
    }
  });

  it("chapterSlotPaths returns all five canonical paths", () => {
    const paths = chapterSlotPaths("acids");
    expect(paths).toEqual({
      "concept-map": "concepts/acids.md",
      "study-guide": "study-guide/acids.md",
      slides: "slides/acids.md",
      "assessment-guide": "assessment-support/acids.md",
      practice: "practice/acids.md",
    });
    for (const slot of CHAPTER_SLOTS) {
      expect(paths[slot]).toBe(slotPath(slot, "acids"));
    }
  });
});

describe("slotForPath / slotPath round trip", () => {
  it("is an exact inverse for every slot × slug", () => {
    for (const slot of CHAPTER_SLOTS) {
      for (const slug of SLUGS) {
        const path = slotPath(slot, slug);
        expect(slotForPath(path)).toEqual({ slot, chapterSlug: slug });
        expect(isSlotPath(path)).toBe(true);
      }
    }
  });

  it("round-trips back to the same path", () => {
    for (const slot of CHAPTER_SLOTS) {
      for (const slug of SLUGS) {
        const path = slotPath(slot, slug);
        const parsed = slotForPath(path)!;
        expect(slotPath(parsed.slot, parsed.chapterSlug)).toBe(path);
      }
    }
  });

  it("tolerates leading slashes and backslash separators", () => {
    expect(slotForPath("/study-guide/acids.md")).toEqual({
      slot: "study-guide",
      chapterSlug: "acids",
    });
    expect(slotForPath("study-guide\\acids.md")).toEqual({
      slot: "study-guide",
      chapterSlug: "acids",
    });
  });
});

describe("slotForPath — non-slot paths return null (never throw)", () => {
  const NON_SLOTS = [
    // other spaces / repos
    "assets/x.png",
    "materials/diagram.svg",
    "alembic.json",
    "README.md",
    "private-instructor/notes/y.md",
    "private/exam-1.paged.html",
    "current/2026-spring/quiz.pdf",
    "metadata/course.md",
    "provenance/log.json",
    ".github/workflows/pages.yml",
    // nested under a slot directory (slots are flat, one file per chapter)
    "study-guide/x/y.md",
    "concepts/chapter/acids.md",
    "assessment-support/templates/t1.json",
    "assessment-support/blueprints/b1.json",
    "practice/a/b/c.md",
    // generated surfaces are never committed, never slots
    "slides/x.md.html",
    "study-guide/acids.md.html",
    "slides/acids.slides.html",
    "practice/acids.md.html",
    // near-miss directories
    "study-guideX/x.md",
    "concept/x.md",
    "concepts-map/x.md",
    "slide/x.md",
    "practices/x.md",
    "assessment-support-2/x.md",
    // wrong or missing extension
    "concepts/course.json",
    "concepts/acids.json",
    "study-guide/acids",
    "study-guide/acids.markdown",
    "study-guide/.md",
    // malformed slugs
    "study-guide/Acids.md",
    "study-guide/my chapter.md",
    "study-guide/acids-.md",
    "study-guide/-acids.md",
    "study-guide/a--b.md",
    "study-guide/acids_1.md",
    // traversal and empties
    "study-guide/../private/exam.md",
    "../study-guide/acids.md",
    "",
    "study-guide/",
    "/",
  ];

  it("classifies each as not-a-slot", () => {
    for (const path of NON_SLOTS) {
      expect(slotForPath(path), path).toBeNull();
      expect(isSlotPath(path), path).toBe(false);
    }
  });
});

describe("two-repo invariant", () => {
  it("every slot path is allowed in the repo its spec declares (v1 layers)", () => {
    for (const slot of CHAPTER_SLOTS) {
      for (const slug of SLUGS) {
        expect(() =>
          assertPathAllowedInRepo(slotPath(slot, slug), slotRepo(slot)),
        ).not.toThrow();
      }
    }
  });

  it("every slot path is allowed in the same repo under v2 spaces", () => {
    for (const slot of CHAPTER_SLOTS) {
      for (const slug of SLUGS) {
        expect(() =>
          assertPathAllowedInRepoV2(slotPath(slot, slug), slotRepo(slot)),
        ).not.toThrow();
      }
    }
  });

  it("no slot path may be written to the private repo", () => {
    for (const slot of CHAPTER_SLOTS) {
      expect(() => assertPathAllowedInRepo(slotPath(slot, "acids"), "private")).toThrow(
        RepoBoundaryViolation,
      );
    }
  });

  it("no private-repo path is ever classified as a slot", () => {
    for (const path of [
      "private/acids.md",
      "private-instructor/acids.md",
      "private/answers/acids.md",
    ]) {
      expect(slotForPath(path)).toBeNull();
    }
  });
});

describe("isChapterSlug", () => {
  it("accepts contract slugs and rejects everything else", () => {
    for (const slug of SLUGS) expect(isChapterSlug(slug)).toBe(true);
    for (const bad of ["", "Acids", "a_b", "a b", "a--b", "a-", "-a", "a/b", "a.md"]) {
      expect(isChapterSlug(bad), bad).toBe(false);
    }
  });
});

describe("type surface", () => {
  it("ChapterSlot is exactly the declared union", () => {
    const slots: ChapterSlot[] = [...CHAPTER_SLOTS];
    expect(slots).toHaveLength(5);
  });
});
