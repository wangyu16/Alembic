import { describe, expect, it } from "vitest";
import type { AIProvider, GenerateOptions, GenerateResult } from "./provider";
import { SPELLING_GRAMMAR_SYSTEM } from "./prompts";
import { proofread } from "./proofread";

class CannedProvider implements AIProvider {
  readonly name = "canned";
  lastOptions?: GenerateOptions;
  constructor(private readonly reply: string) {}
  async generateText(options: GenerateOptions): Promise<GenerateResult> {
    this.lastOptions = options;
    return { text: this.reply, model: "canned-1" };
  }
}

describe("proofread", () => {
  it("returns corrected text and flags that it changed", async () => {
    const provider = new CannedProvider("The reaction is exothermic.");
    const r = await proofread(provider, { text: "The reaction is exothermicc." });
    expect(r.corrected).toBe("The reaction is exothermic.");
    expect(r.changed).toBe(true);
  });

  it("reports no change when the model returns the same text", async () => {
    const provider = new CannedProvider("Already correct.");
    const r = await proofread(provider, { text: "Already correct." });
    expect(r.changed).toBe(false);
  });

  it("uses SPELLING_GRAMMAR_SYSTEM at temperature 0 (deterministic copy-edit)", async () => {
    const provider = new CannedProvider("x");
    await proofread(provider, { text: "y" });
    expect(provider.lastOptions?.system).toBe(SPELLING_GRAMMAR_SYSTEM);
    expect(provider.lastOptions?.temperature).toBe(0);
  });
});
