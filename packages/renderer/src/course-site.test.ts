import { describe, expect, it } from "vitest";
import { buildCourseSite } from "./course-site";

const multi = {
  title: "General Chemistry",
  chapters: [
    { slug: "atoms", title: "Atoms", markdown: "## Atoms\n\nMatter is made of atoms." },
    {
      slug: "water",
      title: "Water",
      markdown: "## Water\n\nWater is H~2~O and $\\Delta H$ matters.",
    },
    { slug: "acids", title: "Acids", markdown: "## Acids\n\nHCl is strong." },
  ],
  worksheets: [
    { title: "Practice 1", slug: "practice-1", markdown: "1. Define an atom." },
  ],
  builtAt: "2026-06-15T08:00:00Z",
};

describe("buildCourseSite — multi-chapter", () => {
  it("emits an index TOC linking each chapter and the worksheets", () => {
    const files = buildCourseSite(multi);
    const index = files.find((f) => f.path === "index.html")!;
    expect(index.content).toContain("<h1>General Chemistry</h1>");
    expect(index.content).toContain('href="chapters/atoms.html"');
    expect(index.content).toContain('href="chapters/water.html"');
    expect(index.content).toContain('href="chapters/acids.html"');
    expect(index.content).toContain('href="worksheets/practice-1.html"');
    // The index is a TOC, not the chapter bodies inline.
    expect(index.content).not.toContain("Matter is made of atoms");
  });

  it("emits one page per chapter that renders content and links back to the index", () => {
    const files = buildCourseSite(multi);
    const water = files.find((f) => f.path === "chapters/water.html")!;
    expect(water.content).toContain("<sub>2</sub>"); // chemistry rendered
    expect(water.content).toContain("katex"); // math rendered
    expect(water.content).toContain('href="../index.html"');
    expect(files.some((f) => f.path === "chapters/atoms.html")).toBe(true);
    expect(files.some((f) => f.path === "chapters/acids.html")).toBe(true);
  });

  it("uses the chapter title as the page h1 (sourced from the manifest)", () => {
    const files = buildCourseSite(multi);
    const water = files.find((f) => f.path === "chapters/water.html")!;
    expect(water.content).toContain("<h1>Water</h1>");
  });

  it("wires prev/next nav by array order with relative slug links", () => {
    const files = buildCourseSite(multi);
    const water = files.find((f) => f.path === "chapters/water.html")!;
    // Middle chapter: both prev and next, links relative within chapters/.
    expect(water.content).toContain('href="atoms.html"');
    expect(water.content).toContain('href="acids.html"');
    expect(water.content).toContain("Previous: Atoms");
    expect(water.content).toContain("Next: Acids");
  });

  it("omits Previous on the first chapter and Next on the last", () => {
    const files = buildCourseSite(multi);
    const first = files.find((f) => f.path === "chapters/atoms.html")!;
    const last = files.find((f) => f.path === "chapters/acids.html")!;
    expect(first.content).not.toContain("Previous:");
    expect(first.content).toContain("Next: Water");
    expect(last.content).toContain("Previous: Water");
    expect(last.content).not.toContain("Next:");
  });

  it("renders worksheet pages with a back link", () => {
    const files = buildCourseSite(multi);
    const ws = files.find((f) => f.path === "worksheets/practice-1.html")!;
    expect(ws.content).toContain("Define an atom");
    expect(ws.content).toContain('href="../index.html"');
  });
});

describe("buildCourseSite — single chapter", () => {
  const single = {
    title: "Thermochemistry",
    chapters: [
      {
        slug: "enthalpy",
        title: "Enthalpy",
        markdown: "## Enthalpy\n\nWater is H~2~O and $\\Delta H$ matters.",
      },
    ],
    worksheets: [
      { title: "Practice 1", slug: "practice-1", markdown: "1. Define enthalpy." },
    ],
    builtAt: "2026-06-15T08:00:00Z",
  };

  it("renders the chapter inline on the index with no chapters/ pages", () => {
    const files = buildCourseSite(single);
    const index = files.find((f) => f.path === "index.html")!;
    expect(index.content).toContain("<h1>Thermochemistry</h1>");
    expect(index.content).toContain("<sub>2</sub>"); // chapter content inline
    expect(index.content).toContain("katex");
    expect(index.content).toContain('href="worksheets/practice-1.html"');
    expect(files.some((f) => f.path.startsWith("chapters/"))).toBe(false);
  });

  it("still emits worksheet pages with a back link", () => {
    const files = buildCourseSite(single);
    const ws = files.find((f) => f.path === "worksheets/practice-1.html")!;
    expect(ws.content).toContain("Define enthalpy");
    expect(ws.content).toContain('href="../index.html"');
  });
});

describe("buildCourseSite — edges and metadata", () => {
  it("emits an index with just the title when there are no chapters", () => {
    const files = buildCourseSite({
      title: "Empty Course",
      chapters: [],
      builtAt: "2026-06-15T08:00:00Z",
    });
    const index = files.find((f) => f.path === "index.html")!;
    expect(index.content).toContain("<h1>Empty Course</h1>");
    expect(files.some((f) => f.path.startsWith("chapters/"))).toBe(false);
    expect(files.some((f) => f.path.startsWith("worksheets/"))).toBe(false);
  });

  it("works with no worksheets", () => {
    const files = buildCourseSite({ ...multi, worksheets: undefined });
    const index = files.find((f) => f.path === "index.html")!;
    expect(index.content).not.toContain("worksheets/");
    expect(files.some((f) => f.path.startsWith("worksheets/"))).toBe(false);
  });

  it("stamps the renderer version in build-info and includes .nojekyll", () => {
    const files = buildCourseSite(multi);
    const info = files.find((f) => f.path === "build-info.json")!;
    expect(JSON.parse(info.content).renderer).toMatch(/^orz-markdown@/);
    expect(JSON.parse(info.content).builtAt).toBe(multi.builtAt);
    expect(files.some((f) => f.path === ".nojekyll")).toBe(true);
  });
});
