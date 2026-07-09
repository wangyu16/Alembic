import { describe, expect, it } from "vitest";
import { buildCourseSite } from "./course-site";

const course = {
  title: "General Chemistry",
  chapters: [
    { slug: "atoms", title: "Atoms", viewHref: "chapters/atoms.md.html" },
    {
      slug: "water",
      title: "Water",
      viewHref: "chapters/water.md.html",
      slidesHref: "slides/water.slides.html",
      practiceHref: "practice/water.md.html",
    },
    { slug: "acids", title: "Acids", viewHref: "chapters/acids.md.html" },
  ],
  builtAt: "2026-06-15T08:00:00Z",
};

describe("buildCourseSite — course home hub", () => {
  it("emits only the home + build metadata (chapter pages are added by the caller)", () => {
    const files = buildCourseSite(course);
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([".nojekyll", "build-info.json", "index.html"]);
  });

  it("links each chapter's self-contained view, slides, and practice pages", () => {
    const index = buildCourseSite(course).find((f) => f.path === "index.html")!;
    expect(index.content).toContain("<h1>General Chemistry</h1>");
    expect(index.content).toContain('href="chapters/atoms.md.html"');
    expect(index.content).toContain('href="chapters/water.md.html"');
    expect(index.content).toContain('href="chapters/acids.md.html"');
    // Slides/practice are per-chapter — only the chapter that authored them links out.
    expect(index.content).toContain('href="slides/water.slides.html"');
    expect(index.content).toContain('href="practice/water.md.html"');
    // The home is a hub — it does not inline chapter bodies.
    expect(index.content).not.toContain("chapters/atoms.html"); // no bare-render page
  });

  it("renders the course intro when a description is given", () => {
    const index = buildCourseSite({
      ...course,
      description: "A **first** course in chemistry.",
    }).find((f) => f.path === "index.html")!;
    expect(index.content).toContain('<div class="course-intro">');
    expect(index.content).toContain("<strong>first</strong>");
  });

  it("prefers the full description over the short one, with a toggle that starts hidden", () => {
    const index = buildCourseSite({
      ...course,
      description: "A short summary.",
      fullDescription: "A **much longer** version of the intro, with real detail.",
    }).find((f) => f.path === "index.html")!;
    expect(index.content).toContain("<strong>much longer</strong>");
    expect(index.content).not.toContain("A short summary.");
    // Runtime-checked (overflow depends on viewport/fonts) — starts hidden.
    expect(index.content).toContain('id="intro-toggle" hidden');
    expect(index.content).toContain('aria-controls="intro-body"');
  });

  it("falls back to the short description when no full description is given", () => {
    const index = buildCourseSite({
      ...course,
      description: "Just the short one.",
    }).find((f) => f.path === "index.html")!;
    expect(index.content).toContain("Just the short one.");
  });

  it("carries its own light/dark identity (not a reused orz-markdown theme)", () => {
    const dark = buildCourseSite(course).find((f) => f.path === "index.html")!;
    const light = buildCourseSite({ ...course, theme: "light" }).find(
      (f) => f.path === "index.html",
    )!;
    // Distinct canvas colors per scheme — proves theme actually threads through.
    expect(dark.content).toContain("--canvas:#0c0e16");
    expect(light.content).toContain("--canvas:#fbfbfd");
    expect(dark.content).not.toContain("--canvas:#fbfbfd");
    // Never the vendored orz-markdown theme CSS (dark-elegant / light-academic) —
    // the home has its own identity now, decoupled from any single content theme.
    for (const doc of [dark, light]) {
      expect(doc.content).not.toContain("Dark Elegant Theme");
      expect(doc.content).not.toContain("light-academic-1.css");
    }
    // Same display face in both — only the palette changes.
    expect(dark.content).toContain("Source Serif 4");
    expect(light.content).toContain("Source Serif 4");
  });

  it("inlines orz-markdown's browser runtime on the home (copy-as-source)", async () => {
    const { getBrowserRuntimeScript } = await import("orz-markdown/runtime");
    const index = buildCourseSite(course).find((f) => f.path === "index.html")!;
    expect(index.content).toContain(getBrowserRuntimeScript().slice(0, 48));
    expect(index.content).toContain('class="markdown-body"');
  });

  it("emits an LRMI JSON-LD block on the index when metadata is given", () => {
    const index = buildCourseSite({
      ...course,
      meta: { name: "General Chemistry", license: "CC-BY-4.0" },
    }).find((f) => f.path === "index.html")!;
    expect(index.content).toContain("application/ld+json");
    expect(index.content).toContain("LearningResource");
  });

  it("works with no chapters", () => {
    const files = buildCourseSite({ title: "Empty", chapters: [], builtAt: course.builtAt });
    const index = files.find((f) => f.path === "index.html")!;
    expect(index.content).toContain("<h1>Empty</h1>");
    expect(index.content).not.toContain('<ol class="module-list">');
    expect(index.content).toContain("No modules published yet.");
  });

  it("credits Alembic and orz-markdown in the footer, opening in a new tab", () => {
    const index = buildCourseSite(course).find((f) => f.path === "index.html")!;
    expect(index.content).toContain(
      '<a href="https://alembic.orz.how" target="_blank" rel="noreferrer">Published with Alembic</a>',
    );
    expect(index.content).toContain(
      '<a href="https://markdown.orz.how" target="_blank" rel="noreferrer">Powered by orz-markdown</a>',
    );
    // A single center-dot separator between the two links.
    expect(index.content).toContain('<span class="sep">·</span>');
    // The mark is inlined once as a <symbol> (no external image request) and
    // shown once, in front of both links — not duplicated per link.
    expect(index.content).toContain('<symbol id="orz-icon"');
    expect(index.content.match(/<use href="#orz-icon"\/>/g)).toHaveLength(1);
    expect(index.content).not.toContain("raw.githubusercontent.com");
  });

  it("stamps the renderer version in build-info and includes .nojekyll", () => {
    const files = buildCourseSite(course);
    const info = files.find((f) => f.path === "build-info.json")!;
    expect(JSON.parse(info.content).renderer).toMatch(/^orz-markdown@/);
    expect(JSON.parse(info.content).builtAt).toBe(course.builtAt);
    expect(files.some((f) => f.path === ".nojekyll")).toBe(true);
  });

  it("shows instructor / course number / department when given, omits the line when absent", () => {
    const withInfo = buildCourseSite({
      ...course,
      instructor: "Dr. Yu Wang",
      courseNumber: "CHEM 320",
      department: "Department of Chemistry",
    }).find((f) => f.path === "index.html")!;
    expect(withInfo.content).toContain('<p class="course-meta">');
    expect(withInfo.content).toContain("Dr. Yu Wang");
    expect(withInfo.content).toContain("CHEM 320");
    expect(withInfo.content).toContain("Department of Chemistry");

    const withoutInfo = buildCourseSite(course).find((f) => f.path === "index.html")!;
    expect(withoutInfo.content).not.toContain('<p class="course-meta">');

    // A single field is enough to show the line, with no stray separators
    // (scoped to the meta line itself — the footer has its own separator).
    const partial = buildCourseSite({ ...course, instructor: "Dr. Yu Wang" }).find(
      (f) => f.path === "index.html",
    )!;
    expect(partial.content).toContain("Dr. Yu Wang");
    const metaLine = partial.content.match(/<p class="course-meta">([\s\S]*?)<\/p>/)![1];
    expect(metaLine).not.toContain('<span class="sep">');
  });

  it("numbers modules in order and shows a count", () => {
    const index = buildCourseSite(course).find((f) => f.path === "index.html")!;
    expect(index.content).toContain('<span class="module-num" aria-hidden="true">01</span>');
    expect(index.content).toContain('<span class="module-num" aria-hidden="true">02</span>');
    expect(index.content).toContain('<span class="module-num" aria-hidden="true">03</span>');
    expect(index.content).toContain('<span class="modules-count">3 modules</span>');
  });

  it("includes a placeholder \"This term\" section", () => {
    const index = buildCourseSite(course).find((f) => f.path === "index.html")!;
    expect(index.content).toContain('<section class="current-term">');
    expect(index.content).toContain("This term");
  });
});
