import { describe, expect, it } from "vitest";
import {
  AnswerKeySchema,
  AssessmentBlueprintSchema,
  QuestionItemSchema,
  QuestionTemplateSchema,
  answerKeyPath,
  assertAnswerKeyPrivate,
  blueprintPath,
  newBlueprintId,
  newQuestionItemId,
  newQuestionTemplateId,
  questionItemPath,
  questionTemplatePath,
} from "./assessments";
import { assertPathAllowedInRepo } from "./layers";

describe("assessment ids", () => {
  it("mints prefixed, well-formed ids", () => {
    expect(newQuestionTemplateId()).toMatch(/^qt-[a-z0-9]{8,}$/);
    expect(newBlueprintId()).toMatch(/^bp-[a-z0-9]{8,}$/);
    expect(newQuestionItemId()).toMatch(/^qi-[a-z0-9]{8,}$/);
  });
});

describe("schemas", () => {
  it("parses a question template aligned to concepts/objectives", () => {
    const t = QuestionTemplateSchema.parse({
      id: newQuestionTemplateId(),
      prompt: "Ask the student to balance a redox half-reaction.",
      conceptIds: ["redox"],
      objectiveIds: ["obj-1"],
      difficulty: "core",
      representations: ["equation"],
      parameters: [{ name: "species" }],
      misconceptionTargets: ["forgetting to balance charge"],
    });
    expect(t.difficulty).toBe("core");
    expect(t.context).toBe(""); // defaulted
  });

  it("rejects an unknown difficulty", () => {
    const r = QuestionTemplateSchema.safeParse({
      id: newQuestionTemplateId(),
      prompt: "x",
      difficulty: "impossible",
    });
    expect(r.success).toBe(false);
  });

  it("parses a blueprint with entries + embargo", () => {
    const tid = newQuestionTemplateId();
    const bp = AssessmentBlueprintSchema.parse({
      id: newBlueprintId(),
      title: "Quiz 1",
      entries: [{ templateId: tid, count: 3, weight: 2 }],
      objectiveIds: ["obj-1"],
      embargo: { releaseAt: "2026-09-01T00:00:00Z" },
    });
    expect(bp.entries[0]!.count).toBe(3);
  });

  it("question item carries no answer; answer lives only in the key", () => {
    const item = QuestionItemSchema.parse({
      id: newQuestionItemId(),
      templateId: newQuestionTemplateId(),
      stem: "Which species is oxidized?",
      choices: ["A", "B"],
    });
    expect(item).not.toHaveProperty("answer");
    const key = AnswerKeySchema.parse({ itemId: item.id, answer: "A", rationale: "loses electrons" });
    expect(key.answer).toBe("A");
  });
});

describe("placement & the public/private boundary", () => {
  it("templates, blueprints, items are allowed in the public repo", () => {
    expect(() => assertPathAllowedInRepo(questionTemplatePath("qt-aaaaaaaa"), "public")).not.toThrow();
    expect(() => assertPathAllowedInRepo(blueprintPath("bp-aaaaaaaa"), "public")).not.toThrow();
    expect(() => assertPathAllowedInRepo(questionItemPath("qi-aaaaaaaa"), "public")).not.toThrow();
  });

  it("answer keys are PRIVATE-only: rejected for public, accepted for private", () => {
    const path = answerKeyPath("qi-aaaaaaaa");
    expect(path.startsWith("private-instructor/")).toBe(true);
    expect(() => assertPathAllowedInRepo(path, "public")).toThrow();
    expect(() => assertPathAllowedInRepo(path, "private")).not.toThrow();
  });

  it("assertAnswerKeyPrivate passes for a key path and throws for a public path", () => {
    expect(() => assertAnswerKeyPrivate(answerKeyPath("qi-aaaaaaaa"))).not.toThrow();
    // A path that IS allowed in public must be rejected as an answer-key location.
    expect(() => assertAnswerKeyPrivate(questionItemPath("qi-aaaaaaaa"))).toThrow();
  });
});
