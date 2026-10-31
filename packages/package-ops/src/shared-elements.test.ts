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
