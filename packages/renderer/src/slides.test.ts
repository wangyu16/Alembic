import { describe, expect, it } from "vitest";
import {
  SLIDES_FORMAT_VERSION,
  slidesSourceFromBlocks,
  splitSlides,
  buildSlidesHtml,
  extractSlides,
} from "./slides";

describe("slidesSourceFromBlocks", () => {
  it("turns each block into a slide, joined by a thematic break", () => {
    const source = slidesSourceFromBlocks([
      { title: "Intro", body: "Welcome to the course." },
      { title: "Kinetics", body: "Rate laws and orders." },
    ]);
    expect(source).toContain("# Intro");
    expect(source).toContain("# Kinetics");
    // Exactly one separator between the two slides.
    expect(source.match(/^---$/gm)?.length).toBe(1);
    expect(splitSlides(source)).toHaveLength(2);
  });

  it("skips blocks whose title and body are both empty", () => {
    const source = slidesSourceFromBlocks([
      { title: "Kept", body: "" },
      { title: "", body: "" },
      { title: "  ", body: "  " },
    ]);
    expect(splitSlides(source)).toHaveLength(1);
    expect(source).toContain("# Kept");
  });

  it("returns a single placeholder slide when no usable blocks exist", () => {
    const source = slidesSourceFromBlocks([{ title: "", body: "" }]);
    expect(splitSlides(source)).toHaveLength(1);
    expect(source.length).toBeGreaterThan(0);
  });
});

describe("splitSlides", () => {
  it("splits on a line that is exactly ---", () => {
    const chunks = splitSlides("# A\n\nbody a\n\n---\n\n# B\n\nbody b\n\n---\n\n# C");
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe("# A\n\nbody a");
    expect(chunks[2]).toBe("# C");
  });

  it("yields a single empty slide for empty source", () => {
    expect(splitSlides("")).toEqual([""]);
  });
});

describe("buildSlidesHtml", () => {
  const SOURCE = "# Intro\n\nWelcome.\n\n---\n\n# Kinetics\n\nRate $k$.\n\n---\n\n# End\n\nDone.";

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
