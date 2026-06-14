import { describe, expect, it } from "vitest";
import { buildSite } from "./site";

const input = {
  title: "Thermochemistry",
  studyGuideMarkdown: "## Enthalpy\n\nWater is H~2~O and $\\Delta H$ matters.",
  worksheets: [
    { title: "Practice 1", slug: "practice-1", markdown: "1. Define enthalpy." },
  ],
  builtAt: "2026-06-14T08:00:00Z",
};

describe("buildSite", () => {
  it("emits an index page with the rendered study guide and worksheet nav", () => {
    const files = buildSite(input);
    const index = files.find((f) => f.path === "index.html")!;
    expect(index.content).toContain("<h1>Thermochemistry</h1>");
    expect(index.content).toContain("<sub>2</sub>"); // chemistry rendered
    expect(index.content).toContain("katex"); // math rendered
    expect(index.content).toContain('href="worksheets/practice-1.html"');
  });

  it("emits a page per worksheet that links back to the index", () => {
    const files = buildSite(input);
    const ws = files.find((f) => f.path === "worksheets/practice-1.html")!;
    expect(ws.content).toContain("Define enthalpy");
    expect(ws.content).toContain('href="../index.html"');
  });

  it("stamps the renderer version in build-info and includes .nojekyll", () => {
    const files = buildSite(input);
    const info = files.find((f) => f.path === "build-info.json")!;
    expect(JSON.parse(info.content).renderer).toMatch(/^orz-markdown@/);
    expect(JSON.parse(info.content).builtAt).toBe(input.builtAt);
    expect(files.some((f) => f.path === ".nojekyll")).toBe(true);
  });

  it("works with no worksheets", () => {
    const files = buildSite({ ...input, worksheets: [] });
    const index = files.find((f) => f.path === "index.html")!;
    expect(index.content).not.toContain("worksheets/");
    expect(files.some((f) => f.path.startsWith("worksheets/"))).toBe(false);
  });
});
