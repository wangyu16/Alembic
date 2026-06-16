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
  it("produces a self-contained document with rendered body + embedded carrier", () => {
    const html = buildMdHtml({ title: "Thermo", markdown: SAMPLE });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<sub>2</sub>"); // rendered chemistry
    // New codec uses the shared carrier island, not the legacy id="md-source".
    expect(html).toContain('id="orz-carrier"');
    expect(html).toContain(`data-orz-kind="md"`);
    expect(html).toContain(`data-orz-format="${MD_HTML_FORMAT_VERSION}"`);
  });

  it("escapes embedded </script> so it cannot break out", () => {
    const html = buildMdHtml({ title: "T", markdown: SAMPLE });
    // The literal closing tag from the code block must be escaped in the embed.
    expect(html).toContain("<\\/script>");
  });
});

describe("extractMdHtml round-trip (new carrier codec)", () => {
  it("extracts byte-identical Markdown source at format 1", () => {
    const html = buildMdHtml({ title: "Thermo", markdown: SAMPLE });
    const extracted = extractMdHtml(html);
    expect(extracted?.formatVersion).toBe(MD_HTML_FORMAT_VERSION);
    expect(extracted?.markdown).toBe(SAMPLE);
  });

  it("does not stamp a source hash into new files", () => {
    const html = buildMdHtml({ title: "T", markdown: "hi", sourceHash: "deadbeef" });
    expect(html).not.toContain("deadbeef");
    expect(extractMdHtml(html)?.sourceHash).toBeUndefined();
  });

  it("returns null when there is no embedded source", () => {
    expect(extractMdHtml("<html><body>nothing</body></html>")).toBeNull();
  });
});

describe("extractMdHtml legacy fallback", () => {
  it("extracts legacy format-0 files (no version marker)", () => {
    const legacy = `<html><body><script type="text/markdown" id="md-source">## Old{{attrs[#blk-bbbbbbbb]}}\n\nlegacy body</script></body></html>`;
    const extracted = extractMdHtml(legacy);
    expect(extracted?.formatVersion).toBe(0);
    expect(extracted?.markdown).toContain("legacy body");
  });

  it("extracts legacy files that recorded a source hash", () => {
    const legacy = `<html><body><script type="text/markdown" id="md-source" data-orz-format="1" data-orz-source-hash="deadbeef">\nhi\n</script></body></html>`;
    const extracted = extractMdHtml(legacy);
    expect(extracted?.formatVersion).toBe(1);
    expect(extracted?.markdown).toBe("hi");
    expect(extracted?.sourceHash).toBe("deadbeef");
  });
});
