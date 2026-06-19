import { describe, expect, it } from "vitest";
import { embedSource } from "@alembic/carriers";
import type { StudyGuideBlock } from "@alembic/package-contract";
import {
  classifyImport,
  parseImportedMarkdown,
  reconcileImportedBlocks,
} from "./import";

const blk = (id: string | null, title: string, body: string): StudyGuideBlock => ({
  id,
  title,
  body,
});

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

describe("reconcileImportedBlocks", () => {
  it("round-trip: re-imported sections replace in place, IDs preserved, no duplication", () => {
    const existing = [blk("blk-aaa11111", "Intro", "old A"), blk("blk-bbb22222", "Acids", "old B")];
    const incoming = [blk("blk-aaa11111", "Intro", "edited A"), blk("blk-bbb22222", "Acids", "edited B")];
    const r = reconcileImportedBlocks(existing, incoming);
    expect(r.blocks.map((b) => b.id)).toEqual(["blk-aaa11111", "blk-bbb22222"]); // same IDs, no dupes
    expect(r.blocks.map((b) => b.body)).toEqual(["edited A", "edited B"]);
    expect(r).toMatchObject({ updated: 2, added: 0 });
  });

  it("appends ID-less incoming as new sections (minted on save)", () => {
    const existing = [blk("blk-aaa11111", "Intro", "A")];
    const incoming = [blk(null, "Fresh", "new outside")];
    const r = reconcileImportedBlocks(existing, incoming);
    expect(r.blocks.length).toBe(2);
    expect(r.blocks[1]).toMatchObject({ id: null, title: "Fresh" });
    expect(r).toMatchObject({ updated: 0, added: 1 });
  });

  it("mixes replace + append (one matching ID, one fresh)", () => {
    const existing = [blk("blk-aaa11111", "Intro", "A")];
    const incoming = [blk("blk-aaa11111", "Intro", "A2"), blk(null, "More", "B")];
    const r = reconcileImportedBlocks(existing, incoming);
    expect(r.blocks.map((b) => b.id)).toEqual(["blk-aaa11111", null]);
    expect(r.blocks[0]!.body).toBe("A2");
    expect(r).toMatchObject({ updated: 1, added: 1 });
  });

  it("keeps existing blocks absent from the import (non-destructive)", () => {
    const existing = [blk("blk-aaa11111", "Intro", "A"), blk("blk-bbb22222", "Acids", "B")];
    const incoming = [blk("blk-aaa11111", "Intro", "A2")]; // Acids omitted
    const r = reconcileImportedBlocks(existing, incoming);
    expect(r.blocks.map((b) => b.id)).toEqual(["blk-aaa11111", "blk-bbb22222"]); // Acids kept
    expect(r).toMatchObject({ updated: 1, added: 0 });
  });

  it("appends an incoming block with a new ID, preserving that ID", () => {
    const existing = [blk("blk-aaa11111", "Intro", "A")];
    const incoming = [blk("blk-ccc33333", "Bases", "C")];
    const r = reconcileImportedBlocks(existing, incoming);
    expect(r.blocks.map((b) => b.id)).toEqual(["blk-aaa11111", "blk-ccc33333"]);
    expect(r).toMatchObject({ updated: 0, added: 1 });
  });
});
