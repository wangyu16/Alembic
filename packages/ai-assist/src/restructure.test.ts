import { describe, expect, it } from "vitest";
import type { AIProvider, GenerateOptions, GenerateResult } from "./provider";
import { RESTRUCTURE_SYSTEM } from "./prompts";
import { restructureToBlocks } from "./restructure";

class CannedProvider implements AIProvider {
  readonly name = "canned";
  lastOptions?: GenerateOptions;
  constructor(private readonly reply: string) {}
  async generateText(options: GenerateOptions): Promise<GenerateResult> {
    this.lastOptions = options;
    return { text: this.reply, model: "canned-1" };
  }
}

describe("restructureToBlocks", () => {
  it("splits two level-2 headings into two blocks", async () => {
    const provider = new CannedProvider(
      "## Intro\n\nAlpha.\n\n## Methods\n\nBeta.",
    );
    const { blocks } = await restructureToBlocks(provider, { text: "raw" });
    expect(blocks).toEqual([
      { title: "Intro", body: "Alpha." },
      { title: "Methods", body: "Beta." },
    ]);
  });

  it("captures leading prose before the first heading as an Overview block", async () => {
    const provider = new CannedProvider(
      "Some intro prose.\n\n## Topic\n\nDetails here.",
    );
    const { blocks } = await restructureToBlocks(provider, { text: "raw" });
    expect(blocks[0]).toEqual({ title: "Overview", body: "Some intro prose." });
    expect(blocks[1]).toEqual({ title: "Topic", body: "Details here." });
  });

  it("returns a single block when there are no headings", async () => {
    const provider = new CannedProvider("just a wall of text, no headings");
    const { blocks } = await restructureToBlocks(provider, {
      text: "raw",
      context: "Organic Chemistry",
    });
    expect(blocks).toEqual([
      { title: "Organic Chemistry", body: "just a wall of text, no headings" },
    ]);
  });

  it("falls back to 'Imported content' when no headings and no context", async () => {
    const provider = new CannedProvider("loose notes");
    const { blocks } = await restructureToBlocks(provider, { text: "raw" });
    expect(blocks).toEqual([{ title: "Imported content", body: "loose notes" }]);
  });

  it("strips stray block markers from titles and bodies", async () => {
    const provider = new CannedProvider(
      "## Topic{{attrs[#blk-abc123]}}\n\nbody {{attrs[#blk-def456]}}text.",
    );
    const { blocks } = await restructureToBlocks(provider, { text: "raw" });
    expect(blocks).toEqual([{ title: "Topic", body: "body text." }]);
  });

  it("uses RESTRUCTURE_SYSTEM and includes the context in the prompt", async () => {
    const provider = new CannedProvider("## A\n\nx");
    await restructureToBlocks(provider, {
      text: "raw source",
      context: "Thermodynamics Unit",
    });
    expect(provider.lastOptions?.system).toBe(RESTRUCTURE_SYSTEM);
    expect(provider.lastOptions?.prompt).toContain("Thermodynamics Unit");
    expect(provider.lastOptions?.prompt).toContain("raw source");
    expect(provider.lastOptions?.temperature).toBe(0.4);
  });
});
