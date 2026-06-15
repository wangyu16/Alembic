import { describe, expect, it } from "vitest";
import type { AIProvider, GenerateOptions, GenerateResult } from "./provider";
import { suggestA11yFix } from "./remediation";

class CannedProvider implements AIProvider {
  readonly name = "canned";
  lastOptions?: GenerateOptions;
  constructor(private readonly reply: string) {}
  async generateText(options: GenerateOptions): Promise<GenerateResult> {
    this.lastOptions = options;
    return { text: this.reply, model: "canned-1" };
  }
}

/** Records the system prompt for every call so we can compare across rules. */
class CapturingProvider implements AIProvider {
  readonly name = "capturing";
  readonly systems: string[] = [];
  constructor(private readonly reply: string) {}
  async generateText(options: GenerateOptions): Promise<GenerateResult> {
    this.systems.push(options.system ?? "");
    return { text: this.reply, model: "canned-1" };
  }
}

describe("suggestA11yFix", () => {
  it("returns concise alt text for img-alt, trimmed and unquoted", async () => {
    const provider = new CannedProvider(
      "A pH titration curve showing the equivalence point",
    );
    const out = await suggestA11yFix(provider, {
      rule: "img-alt",
      context: "Figure 3 plots pH against volume of added base.",
      target: "titration-curve.png",
    });
    expect(out.rule).toBe("img-alt");
    expect(out.suggestion).toBe(
      "A pH titration curve showing the equivalence point",
    );
  });

  it("returns descriptive link text for link-text as-is", async () => {
    const provider = new CannedProvider("the IUPAC nomenclature guide");
    const out = await suggestA11yFix(provider, {
      rule: "link-text",
      context: "For naming rules, see this resource.",
      target: "https://iupac.org/nomenclature",
    });
    expect(out.rule).toBe("link-text");
    expect(out.suggestion).toBe("the IUPAC nomenclature guide");
  });

  it("uses a low temperature for precision", async () => {
    const provider = new CannedProvider("alt text");
    await suggestA11yFix(provider, { rule: "img-alt", context: "x" });
    expect(provider.lastOptions?.temperature).toBe(0.3);
  });

  describe("sanitization", () => {
    it("strips wrapping double quotes", async () => {
      const provider = new CannedProvider('"A buffered solution diagram"');
      const out = await suggestA11yFix(provider, {
        rule: "img-alt",
        context: "x",
      });
      expect(out.suggestion).toBe("A buffered solution diagram");
    });

    it("strips stray block-ID markers the model emitted", async () => {
      const provider = new CannedProvider(
        "A reaction energy diagram{{attrs[#blk-abc]}}",
      );
      const out = await suggestA11yFix(provider, {
        rule: "img-alt",
        context: "x",
      });
      expect(out.suggestion).toBe("A reaction energy diagram");
    });

    it("trims leading and trailing whitespace and collapses newlines", async () => {
      const provider = new CannedProvider("  \n A molecular orbital\n diagram \n ");
      const out = await suggestA11yFix(provider, {
        rule: "img-alt",
        context: "x",
      });
      expect(out.suggestion).toBe("A molecular orbital diagram");
    });

    it("clips link text to the maximum length", async () => {
      const provider = new CannedProvider("x".repeat(200));
      const out = await suggestA11yFix(provider, {
        rule: "link-text",
        context: "x",
      });
      expect(out.suggestion.length).toBe(80);
    });
  });

  it("passes a different system prompt for img-alt vs link-text", async () => {
    const provider = new CapturingProvider("ok");
    await suggestA11yFix(provider, { rule: "img-alt", context: "x" });
    await suggestA11yFix(provider, { rule: "link-text", context: "x" });
    expect(provider.systems).toHaveLength(2);
    expect(provider.systems[0]).not.toBe(provider.systems[1]);
    expect(provider.systems[0]).toContain("alt");
    expect(provider.systems[1]).toContain("link");
  });
});
