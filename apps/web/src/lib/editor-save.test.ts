import { describe, expect, it } from "vitest";
import { parseStudyGuide, BLOCK_ID_PATTERN } from "@alembic/package-contract";
import {
  CommitFailedError,
  CommitUnavailableError,
} from "@alembic/package-ops";
import {
  EditorSaveValidationError,
  prepareEditorSave,
  prepareSlidesSave,
  prepareStudyGuideSave,
  saveFailureMessage,
  studyGuideHeadingWarning,
} from "./editor-save";

/**
 * These helpers are the VALIDATION half of an editor save, split out so the
 * commit can happen before the store projection (storage-and-write-paths §3).
 * The rule they must never break: a prepare call performs every check the old
 * fused `applyEditorEdit` / `saveStudyGuide` / `saveSlidesDeck` performed, and
 * writes nothing.
 */

const PRIVATE_LEAK = "See [the key](private-instructor/answer-keys/ch1.md).";

describe("prepareStudyGuideSave", () => {
  it("mints IDs for new blocks and returns canonical serialized content", () => {
    const { write, blocks } = prepareStudyGuideSave(
      "study-guide/01-intro.md",
      "# Intro",
      [{ id: null, title: "Energy", body: "Text." }],
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.id).toMatch(BLOCK_ID_PATTERN);
    expect(write.repo).toBe("public");
    expect(write.path).toBe("study-guide/01-intro.md");
    // The content is FINAL: reparsing it yields the same block with its new ID.
    const reparsed = parseStudyGuide(write.content);
    expect(reparsed.blocks[0]!.id).toBe(blocks[0]!.id);
  });

  it("preserves existing block IDs (rule 7: immutable, never reused)", () => {
    const { blocks } = prepareStudyGuideSave("study-guide/01-intro.md", "", [
      { id: "blk-abcdefgh", title: "Energy", body: "Text." },
    ]);
    expect(blocks[0]!.id).toBe("blk-abcdefgh");
  });

  it("rejects duplicate block IDs without writing anything", () => {
    expect(() =>
      prepareStudyGuideSave("study-guide/01-intro.md", "", [
        { id: "blk-abcdefgh", title: "One", body: "" },
        { id: "blk-abcdefgh", title: "Two", body: "" },
      ]),
    ).toThrow(EditorSaveValidationError);
  });

  it("rejects malformed block IDs", () => {
    expect(() =>
      prepareStudyGuideSave("study-guide/01-intro.md", "", [
        { id: "blk-BAD", title: "One", body: "" },
      ]),
    ).toThrow(EditorSaveValidationError);
  });

  it("fails closed on a private reference in public content", () => {
    expect(() =>
      prepareStudyGuideSave("study-guide/01-intro.md", "", [
        { id: null, title: "Energy", body: PRIVATE_LEAK },
      ]),
    ).toThrow(EditorSaveValidationError);
  });

  it("rejects a path that is not allowed in the public repo", () => {
    expect(() =>
      prepareStudyGuideSave("private-instructor/notes.md", "", []),
    ).toThrow(EditorSaveValidationError);
  });
});

describe("prepareSlidesSave", () => {
  it("stores the deck source verbatim", () => {
    const source = "<!-- deck\ntitle: T\n-->\n\n<!-- slide -->\n# Hello\n";
    expect(prepareSlidesSave("slides/01-intro.md", source)).toEqual({
      repo: "public",
      path: "slides/01-intro.md",
      content: source,
    });
  });

  it("refuses a deck that references a private file", () => {
    expect(() => prepareSlidesSave("slides/01-intro.md", PRIVATE_LEAK)).toThrow(
      EditorSaveValidationError,
    );
  });

  it("refuses a deck path outside the public repo", () => {
    expect(() => prepareSlidesSave("private-instructor/deck.md", "# ok")).toThrow(
      EditorSaveValidationError,
    );
  });
});

describe("prepareEditorSave", () => {
  it("routes study-guide markdown through the block-ID path", () => {
    const write = prepareEditorSave({
      path: "study-guide/01-intro.md",
      repo: "public",
      source: "# Chapter\n\n## Energy\n\nText.\n",
    });
    expect(parseStudyGuide(write.content).blocks[0]!.id).toMatch(
      BLOCK_ID_PATTERN,
    );
  });

  it("scans other public text carriers for private references", () => {
    expect(() =>
      prepareEditorSave({
        path: "materials/handout.md",
        repo: "public",
        source: PRIVATE_LEAK,
      }),
    ).toThrow(EditorSaveValidationError);
  });

  it("leaves private files byte-exact (path-validated only)", () => {
    const source = PRIVATE_LEAK; // legal INSIDE the private repo
    expect(
      prepareEditorSave({
        path: "private-instructor/answer-keys/ch1.md",
        repo: "private",
        source,
      }),
    ).toEqual({
      repo: "private",
      path: "private-instructor/answer-keys/ch1.md",
      content: source,
    });
  });

  it("rejects a private-layer path routed at the PUBLIC repo (two-repo invariant)", () => {
    expect(() =>
      prepareEditorSave({
        path: "private-instructor/answer-keys/ch1.md",
        repo: "public",
        source: "# Keys",
      }),
    ).toThrow(EditorSaveValidationError);
  });

  it("rejects a v2 private-space path routed at the public repo", () => {
    expect(() =>
      prepareEditorSave({
        path: "private/notes.md",
        repo: "public",
        source: "# Notes",
      }),
    ).toThrow(EditorSaveValidationError);
  });

  it("passes non-text public files through untouched", () => {
    const write = prepareEditorSave({
      path: "materials/notes.txt",
      repo: "public",
      source: PRIVATE_LEAK,
    });
    expect(write.content).toBe(PRIVATE_LEAK);
  });
});

describe("saveFailureMessage", () => {
  it("marks contract refusals as not retryable", () => {
    expect(saveFailureMessage(new EditorSaveValidationError("Nope."))).toEqual({
      message: "Nope.",
      retryable: false,
    });
  });

  it("passes the typed commit errors' educator-facing message through as retryable", () => {
    for (const err of [new CommitUnavailableError(), new CommitFailedError()]) {
      const out = saveFailureMessage(err);
      expect(out.retryable).toBe(true);
      expect(out.message).toBe(err.message);
      expect(out.message).not.toMatch(/commit|git|sha|repo/i);
    }
  });

  it("never leaks raw error text for an unexpected failure", () => {
    const out = saveFailureMessage(new Error("ECONNRESET at octokit.rest"));
    expect(out.message).not.toContain("ECONNRESET");
    expect(out.retryable).toBe(true);
  });
});

describe("studyGuideHeadingWarning", () => {
  it("warns when text saved without a '## Heading' became preamble", () => {
    expect(studyGuideHeadingWarning("Some text", [])).toMatch(/## Heading/);
  });

  it("stays quiet when there are sections, or nothing at all", () => {
    expect(
      studyGuideHeadingWarning("Some text", [
        { id: null, title: "S", body: "" },
      ]),
    ).toBeUndefined();
    expect(studyGuideHeadingWarning("   ", [])).toBeUndefined();
  });
});
