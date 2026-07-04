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
