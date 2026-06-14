import { describe, expect, it } from "vitest";
import {
  buildMdHtml,
  extractMdHtml,
  MD_HTML_FORMAT_VERSION,
} from "./mdhtml";

const SAMPLE = `## Enthalpy{{attrs[#blk-aaaaaaaa]}}

Water is H~2~O and $\\Delta H$ matters.

\`\`\`js
console.log("</script> inside a code block");
\`\`\`
`;

describe("buildMdHtml", () => {
  it("produces a self-contained document with rendered body + embedded source", () => {
    const html = buildMdHtml({ title: "Thermo", markdown: SAMPLE });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<sub>2</sub>"); // rendered chemistry
    expect(html).toContain('id="md-source"');
    expect(html).toContain(`data-orz-format="${MD_HTML_FORMAT_VERSION}"`);
  });

  it("escapes embedded </script> so it cannot break out", () => {
    const html = buildMdHtml({ title: "T", markdown: SAMPLE });
    // The literal closing tag from the code block must be escaped in the embed.
    expect(html).toContain("<\\/script>");
  });
});

describe("extractMdHtml round-trip", () => {
  it("extracts byte-identical Markdown source", () => {
    const html = buildMdHtml({ title: "Thermo", markdown: SAMPLE });
    const extracted = extractMdHtml(html);
    expect(extracted?.formatVersion).toBe(MD_HTML_FORMAT_VERSION);
    expect(extracted?.markdown).toBe(SAMPLE);
  });

  it("records and returns the source hash when provided", () => {
    const html = buildMdHtml({ title: "T", markdown: "hi", sourceHash: "deadbeef" });
    expect(extractMdHtml(html)?.sourceHash).toBe("deadbeef");
  });

  it("returns null when there is no embedded source", () => {
    expect(extractMdHtml("<html><body>nothing</body></html>")).toBeNull();
  });

  it("extracts legacy format-0 files (no version marker)", () => {
    const legacy = `<html><body><script type="text/markdown" id="md-source">## Old{{attrs[#blk-bbbbbbbb]}}\n\nlegacy body</script></body></html>`;
    const extracted = extractMdHtml(legacy);
    expect(extracted?.formatVersion).toBe(0);
    expect(extracted?.markdown).toContain("legacy body");
  });
});
