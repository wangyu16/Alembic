import { describe, expect, it } from "vitest";
import { GeminiProvider } from "./gemini";
import type { AIProvider, GenerateOptions, GenerateResult } from "./provider";

/** Workflow code must run against any AIProvider — verified with a stub. */
class StubProvider implements AIProvider {
  readonly name = "stub";
  async generateText(options: GenerateOptions): Promise<GenerateResult> {
    return { text: `echo: ${options.prompt}`, model: "stub-1" };
  }
}

describe("AIProvider interface", () => {
  it("supports swappable implementations", async () => {
    const provider: AIProvider = new StubProvider();
    const result = await provider.generateText({ prompt: "hi" });
    expect(result.text).toBe("echo: hi");
  });
});

describe("GeminiProvider", () => {
  it("fails fast without an API key", () => {
    delete process.env["GEMINI_API_KEY"];
    expect(() => new GeminiProvider()).toThrow(/API key/);
  });

  it("constructs with an explicit key (no network call)", () => {
    const provider = new GeminiProvider({ apiKey: "test-key" });
    expect(provider.name).toBe("gemini");
  });
});
