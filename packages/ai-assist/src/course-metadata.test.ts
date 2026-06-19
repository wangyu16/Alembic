import { describe, expect, it } from "vitest";
import type { AIProvider, GenerateOptions, GenerateResult } from "./provider";
import { COURSE_METADATA_SYSTEM } from "./prompts";
import { generateCourseDescription } from "./course-metadata";

class CannedProvider implements AIProvider {
  readonly name = "canned";
  lastOptions?: GenerateOptions;
  constructor(private readonly reply: string) {}
  async generateText(options: GenerateOptions): Promise<GenerateResult> {
    this.lastOptions = options;
    return { text: this.reply, model: "canned-1" };
  }
}

describe("generateCourseDescription", () => {
  it("returns the model's markdown, stripped of stray block markers", async () => {
    const provider = new CannedProvider(
      "A general chemistry course.{{attrs[#blk-abc12345]}}\n\n## Topics\n\n- Atoms",
    );
    const { markdown } = await generateCourseDescription(provider, {
      title: "General Chemistry",
    });
    expect(markdown).toBe("A general chemistry course.\n\n## Topics\n\n- Atoms");
  });

  it("uses COURSE_METADATA_SYSTEM and includes title + discipline + content", async () => {
    const provider = new CannedProvider("desc");
    await generateCourseDescription(provider, {
      title: "Thermo",
      discipline: "chemistry",
      content: "## Enthalpy\n## Entropy",
      scope: "course",
    });
    expect(provider.lastOptions?.system).toBe(COURSE_METADATA_SYSTEM);
    expect(provider.lastOptions?.prompt).toContain("Thermo");
    expect(provider.lastOptions?.prompt).toContain("chemistry");
    expect(provider.lastOptions?.prompt).toContain("Enthalpy");
  });

  it("describes from the title alone when no content is provided", async () => {
    const provider = new CannedProvider("desc");
    await generateCourseDescription(provider, { title: "Organic Chemistry" });
    expect(provider.lastOptions?.prompt).toContain("No content yet");
  });
});
