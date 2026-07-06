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

  it("threads the selected render theme into every page (default dark)", () => {
    const dark = buildCourseSite(multi); // no theme → dark
    expect(dark.find((f) => f.path === "index.html")!.content).toContain("Cinzel"); // dark-elegant
    expect(dark.find((f) => f.path === "chapters/atoms.html")!.content).toContain("Cinzel");

    const light = buildCourseSite({ ...multi, theme: "light" });
    for (const f of light.filter((f) => f.path.endsWith(".html"))) {
      // Every emitted page carries the light-academic theme, not the dark one.
      expect(f.content, f.path).toContain("Alegreya"); // light-academic
      expect(f.content, f.path).not.toContain("Cinzel");
    }
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
    expect(water.content).toContain("← Atoms");
    expect(water.content).toContain("Acids →");
  });

  it("omits the previous link on the first chapter and next on the last", () => {
    const files = buildCourseSite(multi);
    const first = files.find((f) => f.path === "chapters/atoms.html")!;
    const last = files.find((f) => f.path === "chapters/acids.html")!;
    // First: a forward link to Water, no backward chapter link.
    expect(first.content).toContain('href="water.html"');
    expect(first.content).toContain("Water →");
    // Last: a backward link to Water, no forward arrow at all.
    expect(last.content).toContain('href="water.html"');
    expect(last.content).toContain("← Water");
    expect(last.content).not.toContain(" →");
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

  it("renders the course intro on the home page when a description is given", () => {
    const files = buildCourseSite({ ...multi, description: "A **first** course in chemistry." });
    const index = files.find((f) => f.path === "index.html")!;
    expect(index.content).toContain('<div class="course-intro">');
    expect(index.content).toContain("<strong>first</strong>");
  });

  it("links a chapter's offline download from the home card and the chapter page", () => {
    const withDl = {
      ...multi,
      chapters: multi.chapters.map((c) => ({ ...c, downloadHref: `downloads/${c.slug}.md.html` })),
    };
    const files = buildCourseSite(withDl);
    const index = files.find((f) => f.path === "index.html")!;
    // Home card: root-relative download link.
    expect(index.content).toContain('href="downloads/atoms.md.html" download');
    // Chapter page under chapters/: resolved one level up.
    const atoms = files.find((f) => f.path === "chapters/atoms.html")!;
    expect(atoms.content).toContain('href="../downloads/atoms.md.html" download');
    expect(atoms.content).toContain('<div class="resource-bar">');
  });

  it("omits the download link (and its resource bar) when no downloadHref", () => {
    const files = buildCourseSite(multi);
    expect(files.find((f) => f.path === "index.html")!.content).not.toContain("downloads/");
    expect(files.find((f) => f.path === "chapters/atoms.html")!.content).not.toContain(
      '<div class="resource-bar">',
    );
  });

  it("inlines orz-markdown's browser runtime on every page (copy-as-source)", async () => {
    // Copy-as-source is the orz runtime (select + Cmd/Ctrl-C → Markdown over
    // .markdown-body), the SAME mechanism .md.html uses — not a bespoke button.
    const { getBrowserRuntimeScript } = await import("orz-markdown/runtime");
    const marker = getBrowserRuntimeScript().slice(0, 48);
    const files = buildCourseSite(multi);
    for (const f of files.filter((f) => f.path.endsWith(".html"))) {
      expect(f.content, f.path).toContain(marker);
      expect(f.content, f.path).toContain('class="markdown-body"');
    }
  });
});
