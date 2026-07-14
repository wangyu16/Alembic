import { describe, expect, it } from "vitest";
import {
  SLIDES_FORMAT_VERSION,
  slidesSourceFromBlocks,
  splitSlides,
  buildSlidesHtml,
  extractSlides,
  deckThemeFromSource,
  withDeckTheme,
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

describe("withDeckTheme", () => {
  it("replaces an existing theme: line, leaving the rest of the block intact", () => {
    const source = "<!-- deck\ntitle: Demo\ntheme: paper\nratio: 16:9\n-->\n\n<!-- slide -->\n## A\n";
    const next = withDeckTheme(source, "dark-elegant-1");
    expect(deckThemeFromSource(next)).toBe("dark-elegant-1");
    expect(next).toContain("title: Demo");
    expect(next).toContain("ratio: 16:9");
    expect(next).toContain("<!-- slide -->\n## A\n");
  });

  it("inserts a theme: line into a deck block that has none", () => {
    const source = "<!-- deck\ntitle: Demo\n-->\n\n<!-- slide -->\n## A\n";
    const next = withDeckTheme(source, "paper");
    expect(deckThemeFromSource(next)).toBe("paper");
    expect(next).toContain("title: Demo");
  });

  it("prepends a deck block when the source has none at all", () => {
    const source = "<!-- slide -->\n## A\n";
    const next = withDeckTheme(source, "paper");
    expect(deckThemeFromSource(next)).toBe("paper");
    expect(next).toContain("<!-- slide -->\n## A\n");
  });

  it("preserves everything after the deck block byte-for-byte", () => {
    const body = "\n\n<!-- slide -->\n## A\n\nBody text.\n";
    const source = `<!-- deck\ntheme: paper\n-->${body}`;
    const next = withDeckTheme(source, "dark-elegant-1");
    expect(next.endsWith(body)).toBe(true);
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

  it("drops the leading `<!-- deck … -->` config block (no phantom first slide)", () => {
    // An orz-slides–authored deck always opens with this block; it must not
    // become a blank first slide in the fallback renderer.
    const chunks = splitSlides(
      "<!-- deck\ntitle: Demo\ntheme: paper\n-->\n\n<!-- slide -->\n## A\n\nbody a\n<!-- slide -->\n## B",
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe("## A\n\nbody a");
    expect(chunks[1]).toBe("## B");
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
