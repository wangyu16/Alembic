import { describe, expect, it } from "vitest";
import type { AIProvider, GenerateOptions, GenerateResult } from "./provider";
import { EDIT_FILE_SYSTEM } from "./prompts";
import { editFile } from "./edit-file";

class CannedProvider implements AIProvider {
  readonly name = "canned";
  lastOptions?: GenerateOptions;
  constructor(private readonly reply: string) {}
  async generateText(options: GenerateOptions): Promise<GenerateResult> {
    this.lastOptions = options;
    return { text: this.reply, model: "canned-1" };
  }
}

describe("editFile", () => {
  it("returns the full proposed content", async () => {
    const provider = new CannedProvider("## A{{attrs[#blk-x1]}}\n\nConcise.");
    const { proposed } = await editFile(provider, {
      source: "## A{{attrs[#blk-x1]}}\n\nVerbose original.",
      instruction: "make it concise",
    });
    expect(proposed).toBe("## A{{attrs[#blk-x1]}}\n\nConcise.");
  });

  it("sends EDIT_FILE_SYSTEM, the instruction, and the file", async () => {
    const provider = new CannedProvider("x");
    await editFile(provider, { source: "FILE BODY", instruction: "fix grammar" });
    expect(provider.lastOptions?.system).toBe(EDIT_FILE_SYSTEM);
    expect(provider.lastOptions?.prompt).toContain("fix grammar");
    expect(provider.lastOptions?.prompt).toContain("FILE BODY");
  });
});
