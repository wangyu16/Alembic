import { describe, it, expect } from "vitest";
import { extractSource, hasCarrier } from "@alembic/carriers";
import { generateSelfContained, KIND_EXTENSION, type SelfContainedKind } from "./index";

// Each kind's source island is readable by @alembic/carriers (the codec was
// taught the upstream orz-src / orz-deck islands). This proves the full chain:
// Alembic-generated file → carrier extractSource → original source back.
const cases: Array<{ kind: SelfContainedKind; markdown: string }> = [
  { kind: "md", markdown: "# Study guide\n\nA concept, with a tag `</script>` and `</div>`.\n" },
  { kind: "slides", markdown: "# Slide one\n\n---\n\n# Slide two\n" },
  { kind: "paged", markdown: "# Handout\n\nBody paragraph.\n" },
];

describe("generateSelfContained", () => {
  for (const { kind, markdown } of cases) {
    it(`${kind}: produces a self-contained carrier whose source round-trips`, async () => {
      const html = await generateSelfContained({ kind, markdown, title: "T" });
      expect(html.startsWith("<!DOCTYPE html")).toBe(true);
      // The in-file editor + host protocol travel with the file.
      expect(html.includes("orz-host-save")).toBe(true);
      // The codec finds and extracts the embedded source.
      expect(hasCarrier(html)).toBe(true);
      // Round-trips modulo surrounding whitespace: orz-slides / orz-paged wrap
      // the island body in "\n…\n" (orz-mdhtml does not). Surrounding blank
      // lines are semantically null in markdown, and the longevity guarantee
      // requires *recoverability*, not byte-identity. Consumers `.trim()`
      // extracted source before hashing / regenerating so padding can't accrete.
      expect(extractSource(html).source.trim()).toBe(markdown.trim());
    });
  }

  it("KIND_EXTENSION maps each kind to its dual extension", () => {
    expect(KIND_EXTENSION).toEqual({
      md: ".md.html",
      slides: ".slides.html",
      paged: ".paged.html",
    });
  });
});

// M5: host-injected document metadata reaches each format's <head>. Runs
// against the real published orz builders — this is the end-to-end proof that
// the license/author actually land in a generated file.
describe("generateSelfContained — document metadata", () => {
  const metadata = {
    title: "Intro to Polymers",
    author: "Dr. Yu Wang",
    description: "Chain growth and step growth.",
    license: { spdx: "CC-BY-4.0", name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    source: "https://github.com/wangyu16/chem320-oer",
  };
  const sources: Record<SelfContainedKind, string> = {
    md: "# Intro\n\nText.",
    slides: "<!-- deck\ntitle: Intro\n-->\n\n# Slide 1\n\nText\n",
    paged: "# Intro\n\nText.",
  };

  for (const kind of ["md", "slides", "paged"] as SelfContainedKind[]) {
    it(`${kind}: emits rel=license, author, and the metadata island in <head>`, async () => {
      const html = await generateSelfContained({ kind, markdown: sources[kind], title: "T", metadata });
      const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
      expect(head).toContain('<link rel="license" href="https://creativecommons.org/licenses/by/4.0/">');
      expect(head).toContain('<meta name="author" content="Dr. Yu Wang">');
      expect(head).toContain("application/orz-meta+json");
    });

    it(`${kind}: emits no metadata tags when none are supplied`, async () => {
      // Sources with no metadata at all — note a slides deck TITLE is itself
      // metadata, so the empty case must use a deck with no config block.
      const empty: Record<SelfContainedKind, string> = {
        md: "# Hi\n\nx\n",
        slides: "# Slide 1\n\nx\n",
        paged: "# Hi\n\nx\n",
      };
      const html = await generateSelfContained({ kind, markdown: empty[kind], title: "T" });
      const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
      expect(head).not.toContain('<link rel="license"');
      expect(head).not.toContain("application/orz-meta+json");
    });
  }
});
