import { describe, it, expect } from "vitest";
import type { QuestionTemplate } from "@alembic/package-contract";
import type { AIProvider, GenerateResult } from "./provider";
import {
  generateQuestions,
  stubGenerateQuestions,
  type GenerateQuestionsInput,
} from "./question-gen";

const TEMPLATE: QuestionTemplate = {
  id: "qt-abcd1234",
  prompt: "Balance the given combustion reaction.",
  context: "A lab scenario with hydrocarbons.",
  conceptIds: ["c-stoich"],
  objectiveIds: ["o-balance", "o-stoich"],
  difficulty: "core",
  representations: ["equation"],
  parameters: [{ name: "fuel", description: "the hydrocarbon to burn" }],
  misconceptionTargets: ["forgets to balance oxygen"],
};

const INPUT: GenerateQuestionsInput = {
  template: TEMPLATE,
  count: 2,
  courseTitle: "Intro Chemistry",
};

/** A fake provider whose generateText returns a fixed string. */
function fakeProvider(text: string): AIProvider {
  return {
    name: "fake",
    async generateText(): Promise<GenerateResult> {
      return { text, model: "fake-model" };
    },
  };
}

describe("generateQuestions", () => {
  it("parses fenced JSON, strips block markers, keeps answer separate from stem", async () => {
    const canned =
      "```json\n" +
      JSON.stringify({
        items: [
          {
            stem: "What is 2 + 2? {{attrs[#blk-x]}}",
            choices: ["3", "4", "5"],
            answer: "4",
            rationale: "Basic addition.",
            objectiveIds: ["o-balance"],
          },
          {
            stem: "Balance CH4 + O2.",
            choices: [],
            answer: "CH4 + 2 O2 -> CO2 + 2 H2O",
            rationale: "Conserve atoms.",
            objectiveIds: ["o-stoich"],
          },
        ],
      }) +
      "\n```";

    const { items } = await generateQuestions(fakeProvider(canned), INPUT);

    expect(items).toHaveLength(2);
    const [first, second] = items;
    // Marker stripped from the stem.
    expect(first?.stem).not.toContain("{{attrs");
    expect(first?.stem).toContain("What is 2 + 2?");
    // Answer present and held in its own field, separate from the public stem.
    expect(first?.answer).toBe("4");
    expect(first?.stem).not.toContain("4");
    expect(second?.answer).toBe("CH4 + 2 O2 -> CO2 + 2 H2O");
    expect(second?.stem).not.toContain(second?.answer ?? "");
    expect(second?.choices).toEqual([]);
  });

  it("throws on non-JSON output", async () => {
    await expect(
      generateQuestions(fakeProvider("sorry, I cannot do that"), INPUT),
    ).rejects.toThrow();
  });

  it("defaults objectiveIds to the template's when the model omits them", async () => {
    const canned = JSON.stringify({
      items: [{ stem: "A question.", choices: [], answer: "An answer." }],
    });

    const { items } = await generateQuestions(fakeProvider(canned), {
      ...INPUT,
      count: 1,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.objectiveIds).toEqual(TEMPLATE.objectiveIds);
  });

  it("throws when an item is missing a non-empty stem/answer", async () => {
    const canned = JSON.stringify({
      items: [{ stem: "", choices: [], answer: "x" }],
    });
    await expect(generateQuestions(fakeProvider(canned), INPUT)).rejects.toThrow();
  });
});

describe("stubGenerateQuestions", () => {
  it("returns count items with non-empty stems/answers and no network", () => {
    const { items } = stubGenerateQuestions(INPUT);
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.stem.length).toBeGreaterThan(0);
      expect(item.answer.length).toBeGreaterThan(0);
      expect(item.objectiveIds).toEqual(TEMPLATE.objectiveIds);
    }
  });

  it("defaults to one item when count is omitted", () => {
    const { items } = stubGenerateQuestions({ template: TEMPLATE });
    expect(items).toHaveLength(1);
  });
});
