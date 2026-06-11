import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./index";

describe("renderMarkdown", () => {
  it("renders headings", () => {
    expect(renderMarkdown("# Bonding")).toContain("<h1");
  });

  it("renders chemistry subscripts (H~2~O)", () => {
    expect(renderMarkdown("Water: H~2~O")).toContain("<sub>2</sub>");
  });

  it("renders KaTeX math", () => {
    expect(renderMarkdown("$E=mc^2$")).toContain("katex");
  });
});
