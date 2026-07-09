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

  it("threads the selected render theme (default dark)", () => {
    expect(buildCourseSite(course).find((f) => f.path === "index.html")!.content).toContain(
      "Cinzel",
    ); // dark-elegant
    const light = buildCourseSite({ ...course, theme: "light" }).find(
      (f) => f.path === "index.html",
    )!;
    expect(light.content).toContain("Alegreya"); // light-academic
    expect(light.content).not.toContain("Cinzel");
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

    // A single field is enough to show the line, with no stray separators.
    const partial = buildCourseSite({ ...course, instructor: "Dr. Yu Wang" }).find(
      (f) => f.path === "index.html",
    )!;
    expect(partial.content).toContain("Dr. Yu Wang");
    expect(partial.content).not.toContain('<span class="sep">');
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
