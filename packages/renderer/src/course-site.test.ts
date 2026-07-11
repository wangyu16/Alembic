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

  it("renders the course intro as escaped plain text, not markdown", () => {
    const index = buildCourseSite({
      ...course,
      description: "A course on *acids* & bases.",
    }).find((f) => f.path === "index.html")!;
    expect(index.content).toContain('<div class="course-intro">');
    // Literal asterisks/ampersand — not rendered as markdown emphasis.
    expect(index.content).toContain("A course on *acids* &amp; bases.");
    expect(index.content).not.toContain("<em>acids</em>");
    // Runtime-checked (overflow depends on viewport/fonts) — starts hidden.
    expect(index.content).toContain('id="intro-toggle" hidden');
    expect(index.content).toContain('aria-controls="intro-body"');
  });

  it("collapses internal newlines to a single paragraph", () => {
    const index = buildCourseSite({
      ...course,
      description: "Line one.\nLine two.",
    }).find((f) => f.path === "index.html")!;
    expect(index.content).toContain("Line one. Line two.");
  });

  it("omits the intro entirely when there is no description", () => {
    const index = buildCourseSite({ ...course, description: undefined }).find(
      (f) => f.path === "index.html",
    )!;
    expect(index.content).not.toContain('class="course-intro"');
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

  it("omits the \"This term\" section entirely when there is no current term", () => {
    const index = buildCourseSite(course).find((f) => f.path === "index.html")!;
    expect(index.content).not.toContain('class="current-term"');
    // No empty "This term" box for a course with no current term.
    expect(index.content).not.toContain("This term");
  });
});

describe("buildCourseSite — \"This term\" (current collection)", () => {
  const index = (extra: Parameters<typeof buildCourseSite>[0]) =>
    buildCourseSite(extra).find((f) => f.path === "index.html")!.content;

  const term = {
    label: "Fall 2026",
    announcements: [
      {
        title: "Welcome to the course",
        date: "July 11, 2026",
        bodyHtml: "<p>Read <strong>chapter 1</strong> before class.</p>",
      },
      {
        title: "Office hours moved",
        bodyHtml: "<p>Now Tuesdays at 2pm.</p>",
      },
    ],
    assignments: [
      { title: "Problem set 1", href: "current/2026-fall/assignments/ps1.md.html" },
    ],
    misc: [{ title: "Syllabus", href: "current/2026-fall/misc/syllabus.md.html" }],
  };

  it("renders the section with the term label shown tastefully in the heading", () => {
    const html = index({ ...course, currentTerm: term });
    expect(html).toContain('<section class="current-term"');
    expect(html).toContain('id="current-term-heading">This term');
    expect(html).toContain('<span class="term-label">Fall 2026</span>');
  });

  it("lists announcements newest-first with optional date and pre-rendered body", () => {
    const html = index({ ...course, currentTerm: term });
    // Titles escaped; body HTML placed verbatim.
    expect(html).toContain("Welcome to the course");
    expect(html).toContain("<strong>chapter 1</strong>");
    expect(html).toContain('<span class="term-ann-date">July 11, 2026</span>');
    // Newest first: the first announcement appears before the second.
    expect(html.indexOf("Welcome to the course")).toBeLessThan(
      html.indexOf("Office hours moved"),
    );
    // The second announcement carries no date span of its own.
    const second = html.slice(html.indexOf("Office hours moved"));
    expect(second.slice(0, 120)).not.toContain("term-ann-date");
  });

  it("renders assignments and other materials as labelled link lists", () => {
    const html = index({ ...course, currentTerm: term });
    expect(html).toContain("Assignments");
    expect(html).toContain('href="current/2026-fall/assignments/ps1.md.html"');
    expect(html).toContain("Other materials");
    expect(html).toContain('href="current/2026-fall/misc/syllabus.md.html"');
  });

  it("omits empty sub-sections individually", () => {
    const html = index({
      ...course,
      currentTerm: { ...term, assignments: [], misc: [] },
    });
    expect(html).toContain("Welcome to the course"); // announcements still shown
    expect(html).not.toContain("Assignments");
    expect(html).not.toContain("Other materials");
    expect(html).not.toContain("No announcements yet.");
  });

  it("shows the label + a gentle empty line for a fully-empty current term", () => {
    const html = index({
      ...course,
      currentTerm: { label: "Spring 2027", announcements: [], assignments: [], misc: [] },
    });
    expect(html).toContain('<section class="current-term"');
    expect(html).toContain('<span class="term-label">Spring 2027</span>');
    expect(html).toContain("No announcements yet.");
  });

  it("escapes caller strings but not the announcement body", () => {
    const html = index({
      ...course,
      currentTerm: {
        label: "<b>x</b>",
        announcements: [
          { title: "<script>t</script>", bodyHtml: "<p>Safe <em>body</em></p>" },
        ],
        assignments: [],
        misc: [],
      },
    });
    // Label + title escaped.
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("&lt;script&gt;t&lt;/script&gt;");
    expect(html).not.toContain("<script>t</script>");
    // Body HTML is intentional — placed verbatim.
    expect(html).toContain("<p>Safe <em>body</em></p>");
  });
});

describe("buildCourseSite — rights notice", () => {
  const index = (extra: Parameters<typeof buildCourseSite>[0]) =>
    buildCourseSite(extra).find((f) => f.path === "index.html")!.content;

  it("shows a copyright line and the license deed for the CC BY family", () => {
    const html = index({ ...course, license: "CC-BY-4.0", instructor: "Dr. Yu Wang" });
    expect(html).toContain("© 2026 Dr. Yu Wang");
    expect(html).toContain("Licensed under");
    expect(html).toContain("CC BY 4.0");
    expect(html).toContain('href="https://creativecommons.org/licenses/by/4.0/"');
    expect(html).toContain('rel="license noreferrer"');
  });

  it("NEVER prints a copyright symbol for CC0 — the dedication waives it", () => {
    // A "© 2026 Dr. Yu Wang" beside a CC0 mark would assert exactly the right
    // the dedication gives up. This is the regression this test exists for.
    const html = index({ ...course, license: "CC0-1.0", instructor: "Dr. Yu Wang" });
    expect(html).not.toContain("©");
    expect(html).not.toContain("Licensed under");
    expect(html).toContain("Dedicated to the public domain under");
    expect(html).toContain("CC0 1.0");
    expect(html).toContain('href="https://creativecommons.org/publicdomain/zero/1.0/"');
  });

  it("omits the copyright line, but keeps the license, when no holder is known", () => {
    const html = index({ ...course, license: "CC-BY-SA-4.0" });
    expect(html).not.toContain("©");
    expect(html).toContain("Licensed under");
    expect(html).toContain("CC BY-SA 4.0");
  });

  it("prefers an explicit copyrightHolder over the instructor", () => {
    const html = index({
      ...course,
      license: "CC-BY-4.0",
      instructor: "Dr. Yu Wang",
      copyrightHolder: "University of Louisiana at Lafayette",
    });
    expect(html).toContain("© 2026 University of Louisiana at Lafayette");
    expect(html).not.toContain("© 2026 Dr. Yu Wang");
  });

  it("dates the copyright from publication, not from the rebuild", () => {
    // Otherwise every republish silently rewrites the copyright year.
    const html = index({
      ...course,
      license: "CC-BY-4.0",
      instructor: "Dr. Yu Wang",
      builtAt: "2030-01-02T00:00:00Z",
      meta: { name: "General Chemistry", license: "CC-BY-4.0", datePublished: "2026-09-01" },
    });
    expect(html).toContain("© 2026 Dr. Yu Wang");
    expect(html).not.toContain("© 2030");
  });

  it("escapes a holder name rather than injecting markup", () => {
    const html = index({ ...course, license: "CC-BY-4.0", instructor: '<script>x</script>' });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("emits no notice at all when the caller has no license", () => {
    const html = index(course);
    // The `.site-license` CSS rule ships unconditionally (a handful of bytes);
    // what must be absent is the notice ELEMENT and any rights claim.
    expect(html).not.toContain('<p class="site-license">');
    expect(html).not.toContain("©");
    expect(html).not.toContain("Licensed under");
  });
});
