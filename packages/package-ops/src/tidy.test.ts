import { describe, expect, it } from "vitest";
import type { StudyGuideDoc } from "./study-guide";
import { tidyStudyGuide } from "./tidy";

function doc(partial: Partial<StudyGuideDoc>): StudyGuideDoc {
  return {
    path: "study-guide/01-getting-started.md",
    preamble: "",
    blocks: [],
    ...partial,
  };
}

describe("tidyStudyGuide", () => {
  it("removes trailing whitespace from every line", () => {
    const input = doc({
      preamble: "intro line   \nsecond\t\n",
      blocks: [{ id: "blk-1", title: "T", body: "alpha \nbeta\t \ngamma" }],
    });
    const { doc: out, changed } = tidyStudyGuide(input);
    expect(changed).toBe(true);
    expect(out.preamble).toBe("intro line\nsecond");
    expect(out.blocks[0]!.body).toBe("alpha\nbeta\ngamma");
  });

  it("collapses 3+ consecutive blank lines to a single blank line", () => {
    const input = doc({
      preamble: "a\n\n\n\nb",
      blocks: [{ id: "blk-1", title: "T", body: "x\n\n\n\n\ny" }],
    });
    const { doc: out } = tidyStudyGuide(input);
    expect(out.preamble).toBe("a\n\nb");
    expect(out.blocks[0]!.body).toBe("x\n\ny");
  });

  it("preserves a single blank line (paragraph break)", () => {
    const input = doc({ preamble: "a\n\nb" });
    const { doc: out, changed } = tidyStudyGuide(input);
    expect(changed).toBe(false);
    expect(out.preamble).toBe("a\n\nb");
  });

  it("trims leading and trailing blank lines of each field", () => {
    const input = doc({
      preamble: "\n\n  \nhello\n\n  \n",
      blocks: [{ id: "blk-1", title: "T", body: "\n\nbody text\n\n" }],
    });
    const { doc: out } = tidyStudyGuide(input);
    expect(out.preamble).toBe("hello");
    expect(out.blocks[0]!.body).toBe("body text");
  });

  it("does not strip indentation of the first content line", () => {
    const input = doc({
      blocks: [{ id: "blk-1", title: "T", body: "\n\n    indented code\n\n" }],
    });
    const { doc: out } = tidyStudyGuide(input);
    expect(out.blocks[0]!.body).toBe("    indented code");
  });

  it("normalizes CRLF and lone CR to LF", () => {
    const input = doc({
      preamble: "a\r\nb\rc",
      blocks: [{ id: "blk-1", title: "T", body: "p\r\nq" }],
    });
    const { doc: out, changed } = tidyStudyGuide(input);
    expect(changed).toBe(true);
    expect(out.preamble).toBe("a\nb\nc");
    expect(out.blocks[0]!.body).toBe("p\nq");
  });

  it("preserves block ids, titles, order, and count", () => {
    const input = doc({
      blocks: [
        { id: "blk-1", title: "First", body: "one  " },
        { id: null, title: "Second", body: "two  " },
        { id: "blk-3", title: "Third", body: "three  " },
      ],
    });
    const { doc: out } = tidyStudyGuide(input);
    expect(out.blocks).toHaveLength(3);
    expect(out.blocks.map((b) => b.id)).toEqual(["blk-1", null, "blk-3"]);
    expect(out.blocks.map((b) => b.title)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
    expect(out.blocks.map((b) => b.body)).toEqual(["one", "two", "three"]);
  });

  it("preserves the doc path", () => {
    const input = doc({ path: "study-guide/02-other.md", preamble: "x  " });
    const { doc: out } = tidyStudyGuide(input);
    expect(out.path).toBe("study-guide/02-other.md");
  });

  it("does not mutate the input doc", () => {
    const input = doc({
      preamble: "x   ",
      blocks: [{ id: "blk-1", title: "T", body: "y   " }],
    });
    tidyStudyGuide(input);
    expect(input.preamble).toBe("x   ");
    expect(input.blocks[0]!.body).toBe("y   ");
  });

  it("returns a new doc and new block objects", () => {
    const input = doc({
      blocks: [{ id: "blk-1", title: "T", body: "y" }],
    });
    const { doc: out } = tidyStudyGuide(input);
    expect(out).not.toBe(input);
    expect(out.blocks[0]).not.toBe(input.blocks[0]);
  });

  it("is idempotent: tidy(tidy(x)) equals tidy(x)", () => {
    const input = doc({
      preamble: "  a   \n\n\n\nb  \n\n",
      blocks: [
        { id: "blk-1", title: "T", body: "p \r\n\r\n\r\n\r\nq  \n" },
        { id: "blk-2", title: "U", body: "\n\n  m\t\n" },
      ],
    });
    const once = tidyStudyGuide(input).doc;
    const twiceResult = tidyStudyGuide(once);
    expect(twiceResult.changed).toBe(false);
    expect(twiceResult.doc.preamble).toBe(once.preamble);
    expect(twiceResult.doc.blocks.map((b) => b.body)).toEqual(
      once.blocks.map((b) => b.body),
    );
  });

  it("reports changed === false on already-tidy input", () => {
    const input = doc({
      preamble: "title\n\nintro",
      blocks: [{ id: "blk-1", title: "T", body: "line one\n\nline two" }],
    });
    const { changed } = tidyStudyGuide(input);
    expect(changed).toBe(false);
  });

  it("reports changed === true when only a block body needs normalizing", () => {
    const input = doc({
      preamble: "clean",
      blocks: [
        { id: "blk-1", title: "T", body: "clean" },
        { id: "blk-2", title: "U", body: "dirty   " },
      ],
    });
    const { changed, doc: out } = tidyStudyGuide(input);
    expect(changed).toBe(true);
    expect(out.blocks[1]!.body).toBe("dirty");
  });

  it("handles a doc with no blocks", () => {
    const input = doc({ preamble: "only preamble  " });
    const { changed, doc: out } = tidyStudyGuide(input);
    expect(changed).toBe(true);
    expect(out.preamble).toBe("only preamble");
    expect(out.blocks).toEqual([]);
  });
});
