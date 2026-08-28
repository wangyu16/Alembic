import { describe, expect, it } from "vitest";
import {
  CHAPTER_SLOTS,
  CHAPTER_SLOT_SPECS,
  chapterSlotPaths,
  slotPath,
} from "@alembic/package-contract";
import { placementNote, resolveReplaceTarget } from "./slot-upsert";

const SLUG = "03-energy";

describe("resolveReplaceTarget — chapter document slots", () => {
  it("treats every one of the five chapter documents as an upsert", () => {
    const paths = chapterSlotPaths(SLUG);
    for (const slot of CHAPTER_SLOTS) {
      const target = resolveReplaceTarget(paths[slot]);
      expect(target).toMatchObject({
        path: paths[slot],
        mode: "upsert",
        slot,
        chapterSlug: SLUG,
      });
    }
  });

  it("writes to the canonical path whatever the picked file is called (C5)", () => {
    const target = resolveReplaceTarget(slotPath("slides", SLUG), "my-energy-slides.md");
    expect(target.path).toBe("slides/03-energy.md");
    expect(target.mode).toBe("upsert");
    expect(target.renamed).toBe(true);
  });

  it("does not call it a rename when the picked name already matches", () => {
    const target = resolveReplaceTarget(slotPath("slides", SLUG), "03-energy.md");
    expect(target.renamed).toBe(false);
  });

  it("compares only the picked file's name, not the folder it came from", () => {
    // A browser gives just the basename, but a caller passing a path must not
    // be reported as a rename when the file itself is canonically named.
    expect(resolveReplaceTarget(slotPath("slides", SLUG), "Downloads/03-energy.md").renamed).toBe(
      false,
    );
    expect(
      resolveReplaceTarget(slotPath("slides", SLUG), "C:\\Users\\me\\03-energy.md").renamed,
    ).toBe(false);
  });

  it("says nothing about a rename when no filename was supplied", () => {
    expect(resolveReplaceTarget(slotPath("practice", SLUG)).renamed).toBe(false);
  });

  it("normalizes a leading slash and backslashes before classifying", () => {
    const target = resolveReplaceTarget("/slides/03-energy.md");
    expect(target.mode).toBe("upsert");
    expect(target.path).toBe("slides/03-energy.md");
  });

  it("carries a downloaded carrier's name without changing the destination", () => {
    // C3: the educator may pick the self-contained `.md.html` download. It
    // still belongs in the slot's plain markdown path — the action extracts
    // the source at the door.
    const target = resolveReplaceTarget(slotPath("study-guide", SLUG), "03-energy.md.html");
    expect(target.path).toBe("study-guide/03-energy.md");
    expect(target.renamed).toBe(true);
  });
});

describe("resolveReplaceTarget — everything that is not a slot", () => {
  const notSlots = [
    "assets/course/diagram.png",
    "materials/course/notes.md",
    "private-instructor/answers.md",
    "current/2026-fall/syllabus.md",
    "alembic.json",
    // Nested under a slot directory, but not a slot file.
    "slides/extra/03-energy.md",
    // A generated surface is never the committed slot file.
    "slides/03-energy.slides.html",
    // Malformed chapter slug.
    "slides/03 Energy.md",
  ];

  it("keeps replace-only semantics and the path untouched", () => {
    for (const path of notSlots) {
      const target = resolveReplaceTarget(path, "anything.md");
      expect(target).toEqual({
        path,
        mode: "replace-only",
        slot: null,
        chapterSlug: null,
        renamed: false,
      });
    }
  });
});

describe("placementNote", () => {
  it("names the document and the chapter when the picked name didn't match", () => {
    const target = resolveReplaceTarget(slotPath("slides", SLUG), "my-energy-slides.md");
    expect(placementNote({ target, created: false, chapterTitle: "Energy Basics" })).toBe(
      "Saved as the slides for “Energy Basics”.",
    );
  });

  it("falls back to the chapter's name when the course has no title for it", () => {
    const target = resolveReplaceTarget(slotPath("practice", SLUG), "questions.md");
    expect(placementNote({ target, created: false })).toBe(
      "Saved as the practice questions for chapter “03-energy”.",
    );
    expect(placementNote({ target, created: false, chapterTitle: "   " })).toBe(
      "Saved as the practice questions for chapter “03-energy”.",
    );
  });

  it("confirms placement when the document had no file yet (C4)", () => {
    // Even a perfectly-named file deserves the note here: the educator never
    // opened this document, so nothing on screen would otherwise show that it
    // now exists.
    const target = resolveReplaceTarget(slotPath("study-guide", SLUG), "03-energy.md");
    expect(placementNote({ target, created: true, chapterTitle: "Energy Basics" })).toBe(
      "Saved as the study guide for “Energy Basics”.",
    );
  });

  it("stays quiet on an ordinary same-name replacement", () => {
    const target = resolveReplaceTarget(slotPath("slides", SLUG), "03-energy.md");
    expect(placementNote({ target, created: false })).toBeNull();
  });

  it("stays quiet for non-slot files, created or not", () => {
    const target = resolveReplaceTarget("assets/course/diagram.png", "other.png");
    expect(placementNote({ target, created: false })).toBeNull();
    expect(placementNote({ target, created: true })).toBeNull();
  });

  it("uses the contract's own label for every slot, never a hardcoded name", () => {
    for (const slot of CHAPTER_SLOTS) {
      const target = resolveReplaceTarget(slotPath(slot, SLUG), "whatever.md");
      const note = placementNote({ target, created: false, chapterTitle: "Energy" });
      expect(note).toBe(
        `Saved as the ${CHAPTER_SLOT_SPECS[slot].label.toLowerCase()} for “Energy”.`,
      );
      // Never a path, a filename, or Git vocabulary in an educator message.
      expect(note).not.toMatch(/\.md|\/|commit|repo|path/i);
    }
  });
});
