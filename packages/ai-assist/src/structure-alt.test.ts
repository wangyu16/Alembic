import { describe, expect, it } from "vitest";
import type { AIProvider, GenerateOptions, GenerateResult } from "./provider";
import { A11Y_STRUCTURE_ALT_SYSTEM } from "./prompts";
import { suggestStructureAltText } from "./structure-alt";

class CannedProvider implements AIProvider {
  readonly name = "canned";
  lastOptions?: GenerateOptions;
  constructor(private readonly reply: string) {}
  async generateText(options: GenerateOptions): Promise<GenerateResult> {
    this.lastOptions = options;
    return { text: this.reply, model: "canned-1" };
  }
}

describe("suggestStructureAltText", () => {
  it("returns concise alt text, trimmed and unquoted", async () => {
    const provider = new CannedProvider(
      "Benzene, a six-membered aromatic ring",
    );
    const out = await suggestStructureAltText(provider, {
      source: "c1ccccc1",
    });
    expect(out.altText).toBe("Benzene, a six-membered aromatic ring");
  });

  it("uses a low temperature for precision", async () => {
    const provider = new CannedProvider("Methane");
    await suggestStructureAltText(provider, { source: "C" });
    expect(provider.lastOptions?.temperature).toBe(0.3);
  });

  it("passes the structure system prompt to the provider", async () => {
    const provider = new CannedProvider("Ethanol");
    await suggestStructureAltText(provider, { source: "CCO" });
    expect(provider.lastOptions?.system).toBe(A11Y_STRUCTURE_ALT_SYSTEM);
  });

  it("includes the context string in the prompt when provided", async () => {
    const provider = new CannedProvider("Glucose ring");
    const context = "This is the open-chain form discussed in Section 4.";
    await suggestStructureAltText(provider, {
      source: "OCC(O)C(O)C(O)C(O)C=O",
      context,
    });
    expect(provider.lastOptions?.prompt).toContain(context);
  });

  it("omits the context block when no context is given", async () => {
    const provider = new CannedProvider("Water");
    await suggestStructureAltText(provider, { source: "O" });
    expect(provider.lastOptions?.prompt).not.toContain(
      "Surrounding study-guide content",
    );
  });

  describe("sanitization", () => {
    it("strips wrapping double quotes", async () => {
      const provider = new CannedProvider('"Acetic acid carboxyl group"');
      const out = await suggestStructureAltText(provider, { source: "CC(=O)O" });
      expect(out.altText).toBe("Acetic acid carboxyl group");
    });

    it("strips wrapping backticks", async () => {
      const provider = new CannedProvider("`Ammonia`");
      const out = await suggestStructureAltText(provider, { source: "N" });
      expect(out.altText).toBe("Ammonia");
    });

    it("strips stray block-ID markers the model emitted", async () => {
      const provider = new CannedProvider(
        "Cyclohexane chair conformation{{attrs[#blk-x]}}",
      );
      const out = await suggestStructureAltText(provider, {
        source: "C1CCCCC1",
      });
      expect(out.altText).toBe("Cyclohexane chair conformation");
    });

    it("trims whitespace and collapses newlines to a single line", async () => {
      const provider = new CannedProvider(
        "  \n Benzene, a six-membered\n aromatic ring \n ",
      );
      const out = await suggestStructureAltText(provider, {
        source: "c1ccccc1",
      });
      expect(out.altText).toBe("Benzene, a six-membered aromatic ring");
    });

    it("clips alt text to the maximum length", async () => {
      const provider = new CannedProvider("x".repeat(400));
      const out = await suggestStructureAltText(provider, { source: "C" });
      expect(out.altText.length).toBe(200);
    });
  });
});
