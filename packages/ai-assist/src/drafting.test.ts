import { describe, expect, it } from "vitest";
import type { AIProvider, GenerateOptions, GenerateResult } from "./provider";
import { draftSection, generateWorksheet, stripBlockMarkers } from "./drafting";

class CannedProvider implements AIProvider {
  readonly name = "canned";
  lastOptions?: GenerateOptions;
  constructor(private readonly reply: string) {}
  async generateText(options: GenerateOptions): Promise<GenerateResult> {
    this.lastOptions = options;
    return { text: this.reply, model: "canned-1" };
  }
}

describe("stripBlockMarkers", () => {
  it("removes stray block-ID markers", () => {
    expect(stripBlockMarkers("## T{{attrs[#blk-aaaaaaaa]}}\n\nx")).toBe(
      "## T\n\nx",
    );
  });
});

describe("draftSection", () => {
  it("parses title and body from a heading + body reply", async () => {
    const provider = new CannedProvider(
      "## Acid–Base Equilibria\n\nAcids donate H~2~O… and $K_a$ matters.",
    );
    const out = await draftSection(provider, { instruction: "acid-base" });
    expect(out.title).toBe("Acid–Base Equilibria");
    expect(out.body).toContain("$K_a$");
  });

  it("strips any block marker the model emitted", async () => {
    const provider = new CannedProvider(
      "## Sneaky{{attrs[#blk-deadbeef]}}\n\nbody",
    );
    const out = await draftSection(provider, { instruction: "x" });
    expect(out.title).toBe("Sneaky");
    expect(out.body).toBe("body");
  });

  it("falls back to the instruction when no heading is returned", async () => {
    const provider = new CannedProvider("just prose, no heading");
    const out = await draftSection(provider, { instruction: "buffers" });
    expect(out.title).toBe("buffers");
    expect(out.body).toBe("just prose, no heading");
  });
});

describe("generateWorksheet", () => {
  it("extracts the H1 title and keeps the worksheet markdown", async () => {
    const provider = new CannedProvider(
      "# Thermochemistry Worksheet\n\n1. Define enthalpy.\n2. Compute ΔH.",
    );
    const out = await generateWorksheet(provider, {
      packageTitle: "Thermo",
      sections: [{ title: "Enthalpy", body: "..." }],
    });
    expect(out.title).toBe("Thermochemistry Worksheet");
    expect(out.markdown).toContain("1. Define enthalpy.");
  });

  it("passes section content into the prompt", async () => {
    const provider = new CannedProvider("# W\n\nq1");
    await generateWorksheet(provider, {
      sections: [{ title: "Calorimetry", body: "q = mcΔT" }],
    });
    expect(provider.lastOptions?.prompt).toContain("Calorimetry");
    expect(provider.lastOptions?.prompt).toContain("q = mcΔT");
  });
});
