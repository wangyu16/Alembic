import { describe, expect, it } from "vitest";
import { CHAPTER_PARTS, chapterPartPath, chapterPartText } from "@alembic/package-ops";

type Kit = { readDocument(text: string): { lints?: Array<{ level: string; code: string; message: string }> } };

describe("starting a chapter's parts (no agent)", () => {
  it("[RC.26] every part starts as a document its editor accepts (no lint errors), at the path the course page expects", async () => {
    const kits: Record<string, Kit> = {
      md: (await import("orz-mdhtml-browser")) as unknown as Kit,
      slides: (await import("orz-slides-browser")) as unknown as Kit,
    };
    for (const { part } of CHAPTER_PARTS) {
      const text = chapterPartText(part, "Gases: {{odd}} title\nwith a break", "doc-abcdefgh23456789");
      const kind = part === "slides" ? "slides" : "md";
      const errors = (kits[kind]!.readDocument(text).lints ?? []).filter((l) => l.level === "error");
      expect(errors, `${part}: ${JSON.stringify(errors)}`).toEqual([]);
      expect(text).not.toContain("{{odd}}");
    }
    expect(chapterPartPath("slides", "gases")).toBe("slides/gases.slides.md");
    expect(chapterPartPath("concepts", "gases")).toBe("concepts/gases.md");
  });
});
