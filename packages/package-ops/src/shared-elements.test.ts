import { describe, expect, it } from "vitest";
import { elementAvailable, newElementId, sectionText, shareablesOf } from "./shared-elements";

const page = [
  "# Buffers", "", "![pH curve](../assets/buffers/curve.svg)", "",
  "## 16.1 Buffer Solutions{{attrs[#blk-ch16sec01]}}", "", "A buffer resists change.", "", "### Detail", "more", "",
  "```", "## not a heading{{attrs[#blk-fake]}}", "```", "",
  "## 16.2 Titrations{{attrs[#blk-ch16sec02]}}", "", "Titration text.", "",
  "## Summary", "no id here", "",
].join("\n");

describe("shared elements (element-sharing-v3)", () => {
  it("[K1.28] a page's shareables are its course figures and its sections that have a block id (never one inside code)", () => {
    expect(shareablesOf("study-guide/buffers.md", page)).toEqual([
      { kind: "figure", path: "assets/buffers/curve.svg", title: "curve.svg" },
      { kind: "section", path: "study-guide/buffers.md", anchor: "blk-ch16sec01", title: "16.1 Buffer Solutions" },
      { kind: "section", path: "study-guide/buffers.md", anchor: "blk-ch16sec02", title: "16.2 Titrations" },
    ]);
  });
  it("[K1.28] a section runs from its heading to the next heading of the same level, sub-headings included", () => {
    expect(sectionText(page, "blk-ch16sec01")).toBe("## 16.1 Buffer Solutions{{attrs[#blk-ch16sec01]}}\n\nA buffer resists change.\n\n### Detail\nmore\n\n```\n## not a heading{{attrs[#blk-fake]}}\n```\n");
    expect(sectionText(page, "blk-missing")).toBeNull();
  });
  it("[K1.28] an element is available only while it is on the course website; stopped sharing never is", () => {
    const pub = new Set(["assets/buffers/curve.svg", "study-guide/buffers.md"]);
    expect(elementAvailable({ kind: "figure", path: "assets/buffers/curve.svg", anchor: null, stoppedAt: null }, pub)).toBe(true);
    expect(elementAvailable({ kind: "figure", path: "assets/buffers/curve.svg", anchor: null, stoppedAt: "2026-10-31" }, pub)).toBe(false);
    expect(elementAvailable({ kind: "figure", path: "assets/other.png", anchor: null, stoppedAt: null }, pub)).toBe(false);
    expect(elementAvailable({ kind: "section", path: "study-guide/buffers.md", anchor: "blk-ch16sec02", stoppedAt: null }, pub, page)).toBe(true);
    expect(elementAvailable({ kind: "section", path: "study-guide/buffers.md", anchor: "blk-gone", stoppedAt: null }, pub, page)).toBe(false);
    expect(newElementId()).toMatch(/^el-[a-z0-9]{12}$/);
  });
});

describe("element sharing step 2 (element-sharing-v3 §1–§3)", () => {
  const credit = { title: "The atom", course: "General Chemistry", authors: "Ada Lovelace", licence: "CC-BY-4.0", pageUrl: "https://x.github.io/gc/study-guide/atoms.md.html" };
  it("[K1.47] a used figure is shown from where it was copied, with its credit; a used section carries no source block id and its links point at the source website", async () => {
    const { usedElementText, relativePath } = await import("./shared-elements");
    expect(relativePath("study-guide/gases.md", "assets/gases/atom.svg")).toBe("../assets/gases/atom.svg");
    const fig = usedElementText({ kind: "figure", pagePath: "study-guide/gases.md", figurePath: "assets/gases/atom.svg", credit });
    expect(fig).toContain("![The atom](../assets/gases/atom.svg)");
    expect(fig).toContain("*From “The atom” in [General Chemistry](https://x.github.io/gc/study-guide/atoms.md.html) by Ada Lovelace, CC-BY-4.0.*");
    const sec = usedElementText({ kind: "section", pagePath: "study-guide/gases.md", credit, sectionMd: "## The atom{{attrs[#blk-abc12345]}}\n\nSee ![d](../assets/atoms/d.png) and [more](other.md).\n" });
    expect(sec).not.toContain("blk-abc12345");
    expect(sec).toContain("![d](https://x.github.io/gc/assets/atoms/d.png)");
    expect(sec).toContain("[more](https://x.github.io/gc/study-guide/other.md.html)");
    expect(sec.trimEnd().endsWith("CC-BY-4.0.*")).toBe(true);
  });
  it("[K1.47] a heading without an id can be given one, only while it is still that heading (never in code)", async () => {
    const { headingsWithoutId, addHeadingId, newBlockId } = await import("./shared-elements");
    const text = "# T\n\n## One\n\n```\n## not a heading\n```\n\n## Two{{attrs[#blk-zzzzzzzz]}}\n";
    expect(headingsWithoutId(text)).toEqual([{ line: 2, title: "One" }]);
    const id = newBlockId();
    expect(id).toMatch(/^blk-[a-z0-9]{10}$/);
    expect(addHeadingId(text, 2, id)).toContain(`## One{{attrs[#${id}]}}`);
    expect(addHeadingId(text, 5, id)).toBeNull(); // in code
    expect(addHeadingId(text, 9, id)).toBeNull(); // already has one
    expect(addHeadingId(text, 2, "blk-BAD")).toBeNull();
  });
});
