import { describe, expect, it } from "vitest";
import {
  SLIDES_FORMAT_VERSION,
  slidesSourceFromBlocks,
  splitSlides,
  buildSlidesHtml,
  extractSlides,
  deckThemeFromSource,
} from "./slides";

describe("deckThemeFromSource", () => {
  it("reads theme: from a leading deck config block", () => {
    const source = "<!-- deck\ntitle: Demo\ntheme: paper\nratio: 16:9\n-->\n\n<!-- slide -->\n## A\n";
    expect(deckThemeFromSource(source)).toBe("paper");
  });

  it("finds theme: regardless of its position in the block", () => {
    const source = "<!-- deck\ntheme: dark-elegant-1\ntitle: Demo\n-->\n";
    expect(deckThemeFromSource(source)).toBe("dark-elegant-1");
  });

  it("returns undefined when the deck block has no theme: line", () => {
    const source = "<!-- deck\ntitle: Demo\nratio: 16:9\n-->\n";
    expect(deckThemeFromSource(source)).toBeUndefined();
  });

  it("returns undefined when there is no deck block at all", () => {
    expect(deckThemeFromSource("<!-- slide -->\n## A\n")).toBeUndefined();
    expect(deckThemeFromSource("")).toBeUndefined();
  });
});

describe("slidesSourceFromBlocks", () => {
  it("turns each block into an orz-slides slide (marker + ## title)", () => {
    const source = slidesSourceFromBlocks([
      { title: "Intro", body: "Welcome to the course." },
      { title: "Kinetics", body: "Rate laws and orders." },
    ]);
    // Titles become the slide title band (## h2), not # h1.
    expect(source).toContain("## Intro");
    expect(source).toContain("## Kinetics");
    // Every slide begins with a `<!-- slide -->` marker — one per slide.
    expect(source.match(/<!--\s*slide\b[^>]*-->/g)?.length).toBe(2);
    // No bare `---` separators (that is not the orz-slides grammar).
    expect(source).not.toMatch(/^---$/m);
    expect(splitSlides(source)).toHaveLength(2);
  });

  it("skips blocks whose title and body are both empty", () => {
    const source = slidesSourceFromBlocks([
      { title: "Kept", body: "" },
      { title: "", body: "" },
      { title: "  ", body: "  " },
    ]);
    expect(splitSlides(source)).toHaveLength(1);
    expect(source).toContain("## Kept");
  });

  it("returns a single placeholder slide when no usable blocks exist", () => {
    const source = slidesSourceFromBlocks([{ title: "", body: "" }]);
    expect(splitSlides(source)).toHaveLength(1);
    expect(source).toContain("<!-- slide -->");
  });
});

describe("splitSlides", () => {
  it("splits on a `<!-- slide -->` marker line and drops the marker", () => {
    const chunks = splitSlides(
      "<!-- slide -->\n## A\n\nbody a\n<!-- slide -->\n## B\n\nbody b\n<!-- slide -->\n## C",
    );
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe("## A\n\nbody a");
    expect(chunks[2]).toBe("## C");
  });

  it("still honors a bare --- line for legacy decks", () => {
    const chunks = splitSlides("# A\n\nbody a\n\n---\n\n# B\n\nbody b\n\n---\n\n# C");
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe("# A\n\nbody a");
    expect(chunks[2]).toBe("# C");
  });

  it("yields no slides for empty source", () => {
    expect(splitSlides("")).toEqual([]);
  });
});

describe("buildSlidesHtml", () => {
  const SOURCE =
    "<!-- slide -->\n## Intro\n\nWelcome.\n<!-- slide -->\n## Kinetics\n\nRate $k$.\n<!-- slide -->\n## End\n\nDone.";

  it("renders one <section> per slide chunk", () => {
    const html = buildSlidesHtml({ title: "Deck", source: SOURCE });
    expect(html.match(/<section\b/g)).toHaveLength(3);
    expect(html).toContain("<!doctype html>");
  });

  it("round-trips the deck source via the carrier codec", () => {
    const html = buildSlidesHtml({ title: "Deck", source: SOURCE });
    const extracted = extractSlides(html);
    expect(extracted?.source).toBe(SOURCE);
    expect(extracted?.formatVersion).toBe(SLIDES_FORMAT_VERSION);
  });

  it("is self-contained: no external <script src> or <link href=http...>", () => {
    const html = buildSlidesHtml({ title: "Deck", source: SOURCE });
    expect(html).not.toMatch(/<script[^>]*\bsrc\s*=\s*["']?https?:/i);
    expect(html).not.toMatch(/<link[^>]*\bhref\s*=\s*["']?https?:/i);
  });
});

describe("extractSlides", () => {
  it("returns null for a string with no carrier island", () => {
    expect(extractSlides("<html><body>just a page</body></html>")).toBeNull();
  });
});
