import { describe, expect, it } from "vitest";
import { embedSource } from "@alembic/carriers";
import { classifyImport, parseImportedMarkdown } from "./import";

describe("classifyImport", () => {
  it("classifies an asset carrier by extension", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    const carrier = embedSource({ kind: "ketcher", format: 1, payload: "svg", rendered: svg, source: "{}" });
    const r = classifyImport("benzene.ketcher.svg", carrier);
    expect(r.type).toBe("asset");
    if (r.type === "asset") expect(r.kind).toBe("ketcher");
  });

  it("extracts markdown from a document carrier", () => {
    const html = "<html><body><h1>x</h1></body></html>";
    const carrier = embedSource({ kind: "md", format: 1, payload: "html", rendered: html, source: "# Title\n\nBody." });
    const r = classifyImport("notes.md.html", carrier);
    expect(r.type).toBe("document");
    if (r.type === "document") expect(r.markdown).toContain("# Title");
  });

  it("passes plain markdown through", () => {
    const r = classifyImport("notes.md", "## A\n\nbody");
    expect(r.type).toBe("markdown");
    if (r.type === "markdown") expect(r.markdown).toContain("## A");
  });

  it("rejects unsupported binary types", () => {
    const r = classifyImport("paper.docx", "PKbinary");
    expect(r.type).toBe("unknown");
  });
});

describe("parseImportedMarkdown", () => {
  it("splits markdown into study-guide blocks", () => {
    const blocks = parseImportedMarkdown("## First\n\nAlpha.\n\n## Second\n\nBeta.");
    expect(blocks.length).toBe(2);
    expect(blocks[0]!.title).toBe("First");
  });
});
