import { describe, expect, it } from "vitest";
import {
  newQuestionTemplateId,
  newBlueprintId,
  newQuestionItemId,
  answerKeyPath,
  type QuestionTemplate,
  type AssessmentBlueprint,
  type QuestionItem,
  type AnswerKey,
} from "@alembic/package-contract";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";
import {
  saveQuestionTemplate,
  loadQuestionTemplate,
  listQuestionTemplates,
  saveBlueprint,
  loadBlueprint,
  listBlueprints,
  saveQuestionItem,
  loadQuestionItem,
  listQuestionItems,
  saveAnswerKey,
  loadAnswerKey,
  isReleased,
} from "./assessments";
import { packageOps } from "./ops";

const input = {
  ownerId: "user-1",
  title: "Thermochemistry",
  license: "CC-BY-4.0" as const,
};

async function seeded() {
  const store = new MemoryPackageStore();
  const { packageId } = await createSandboxPackage(store, input);
  return { store, packageId };
}

function makeTemplate(overrides: Partial<QuestionTemplate> = {}): QuestionTemplate {
  return {
    id: newQuestionTemplateId(),
    prompt: "Compute the enthalpy change for the given reaction.",
    context: "",
    conceptIds: ["enthalpy"],
    objectiveIds: ["obj-1"],
    difficulty: "core",
    representations: ["equation"],
    parameters: [],
    misconceptionTargets: [],
    ...overrides,
  };
}

function makeItem(overrides: Partial<QuestionItem> = {}): QuestionItem {
  return {
    id: newQuestionItemId(),
    templateId: newQuestionTemplateId(),
    objectiveIds: [],
    stem: "What is the enthalpy change?",
    choices: ["-100 kJ", "+100 kJ"],
    ...overrides,
  };
}

describe("question templates — round trip (public)", () => {
  it("reloads a saved template exactly, and missing → null", async () => {
    const { store, packageId } = await seeded();
    const t = makeTemplate();
    await saveQuestionTemplate(store, packageId, t);

    const reloaded = await loadQuestionTemplate(store, packageId, t.id);
    expect(reloaded).toEqual(t);

    const missing = await loadQuestionTemplate(store, packageId, newQuestionTemplateId());
    expect(missing).toBeNull();
  });

  it("lands templates under assessment-support/templates/ in the PUBLIC repo", async () => {
    const { store, packageId } = await seeded();
    const t = makeTemplate();
    await saveQuestionTemplate(store, packageId, t);
    const files = await store.listFiles(packageId);
    const file = files.find((f) => f.path === `assessment-support/templates/${t.id}.json`);
    expect(file).toBeDefined();
    expect(file!.repo).toBe("public");
  });

  it("listQuestionTemplates returns all saved templates", async () => {
    const { store, packageId } = await seeded();
    const a = makeTemplate();
    const b = makeTemplate();
    await saveQuestionTemplate(store, packageId, a);
    await saveQuestionTemplate(store, packageId, b);
    const list = await listQuestionTemplates(store, packageId);
    expect(list).toHaveLength(2);
    expect(list.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("rejects a malformed template and writes nothing", async () => {
    const { store, packageId } = await seeded();
    const bad = { id: "not-a-qt-id", prompt: "x", difficulty: "core" } as unknown as QuestionTemplate;
    await expect(saveQuestionTemplate(store, packageId, bad)).rejects.toThrow();
    const list = await listQuestionTemplates(store, packageId);
    expect(list).toHaveLength(0);
  });
});

describe("blueprints — round trip (public)", () => {
  it("reloads a saved blueprint exactly, and missing → null", async () => {
    const { store, packageId } = await seeded();
    const b: AssessmentBlueprint = {
      id: newBlueprintId(),
      title: "Midterm",
      entries: [{ templateId: newQuestionTemplateId(), count: 3, weight: 1 }],
      objectiveIds: ["obj-1"],
    };
    await saveBlueprint(store, packageId, b);
    const reloaded = await loadBlueprint(store, packageId, b.id);
    expect(reloaded).toEqual(b);

    const missing = await loadBlueprint(store, packageId, newBlueprintId());
    expect(missing).toBeNull();
  });

  it("listBlueprints returns saved blueprints from the PUBLIC repo", async () => {
    const { store, packageId } = await seeded();
    const b: AssessmentBlueprint = { id: newBlueprintId(), title: "Quiz", entries: [], objectiveIds: [] };
    await saveBlueprint(store, packageId, b);
    const files = await store.listFiles(packageId);
    const file = files.find((f) => f.path === `assessment-support/blueprints/${b.id}.json`);
    expect(file!.repo).toBe("public");
    const list = await listBlueprints(store, packageId);
    expect(list.map((x) => x.id)).toEqual([b.id]);
  });
});

describe("question items — round trip (public)", () => {
  it("reloads a saved item exactly, and missing → null", async () => {
    const { store, packageId } = await seeded();
    const item = makeItem();
    await saveQuestionItem(store, packageId, item);
    const reloaded = await loadQuestionItem(store, packageId, item.id);
    expect(reloaded).toEqual(item);

    const missing = await loadQuestionItem(store, packageId, newQuestionItemId());
    expect(missing).toBeNull();
  });

  it("listQuestionItems returns saved items from the PUBLIC repo", async () => {
    const { store, packageId } = await seeded();
    const item = makeItem();
    await saveQuestionItem(store, packageId, item);
    const files = await store.listFiles(packageId);
    const file = files.find((f) => f.path === `assessment-support/items/${item.id}.json`);
    expect(file!.repo).toBe("public");
    const list = await listQuestionItems(store, packageId);
    expect(list.map((x) => x.id)).toEqual([item.id]);
  });
});

describe("answer keys — ADVERSARIAL: must land PRIVATE, never public", () => {
  it("writes the answer key to the PRIVATE partition under private-instructor/", async () => {
    const { store, packageId } = await seeded();
    const itemId = newQuestionItemId();
    const key: AnswerKey = {
      itemId,
      answer: "TOP-SECRET-ANSWER-42",
      rationale: "Worked solution applying Hess's law.",
    };
    await saveAnswerKey(store, packageId, key);

    const files = await store.listFiles(packageId);
    const keyFile = files.find((f) => f.path === answerKeyPath(itemId));
    expect(keyFile).toBeDefined();
    // The answer key file is PRIVATE and lives under private-instructor/.
    expect(keyFile!.repo).toBe("private");
    expect(keyFile!.path.startsWith("private-instructor/")).toBe(true);

    // No file in the PUBLIC partition exists for this answer-key path...
    expect(files.some((f) => f.repo === "public" && f.path === answerKeyPath(itemId))).toBe(false);
    // ...and crucially, the secret answer never appears in ANY public file.
    const publicLeak = files.some(
      (f) => f.repo === "public" && f.content.includes("TOP-SECRET-ANSWER-42"),
    );
    expect(publicLeak).toBe(false);
  });

  it("loadAnswerKey round-trips from the private partition; missing → null", async () => {
    const { store, packageId } = await seeded();
    const itemId = newQuestionItemId();
    const key: AnswerKey = { itemId, answer: "42", rationale: "" };
    await saveAnswerKey(store, packageId, key);

    const reloaded = await loadAnswerKey(store, packageId, itemId);
    expect(reloaded).toEqual(key);

    const missing = await loadAnswerKey(store, packageId, newQuestionItemId());
    expect(missing).toBeNull();
  });

  it("rejects a malformed answer key and writes nothing", async () => {
    const { store, packageId } = await seeded();
    const bad = { itemId: newQuestionItemId(), answer: "" } as unknown as AnswerKey;
    await expect(saveAnswerKey(store, packageId, bad)).rejects.toThrow();
    const files = await store.listFiles(packageId);
    expect(files.some((f) => f.path.startsWith("private-instructor/answer-keys/"))).toBe(false);
  });
});

describe("isReleased — embargo time check (pure)", () => {
  const base: AssessmentBlueprint = { id: newBlueprintId(), title: "X", entries: [], objectiveIds: [] };

  it("no embargo → released", () => {
    expect(isReleased(base, new Date("2026-06-16T00:00:00Z"))).toBe(true);
  });

  it("embargo without releaseAt → released", () => {
    expect(isReleased({ ...base, embargo: {} }, new Date("2026-06-16T00:00:00Z"))).toBe(true);
  });

  it("future releaseAt → NOT released", () => {
    const bp = { ...base, embargo: { releaseAt: "2030-01-01T00:00:00Z" } };
    expect(isReleased(bp, new Date("2026-06-16T00:00:00Z"))).toBe(false);
  });

  it("past releaseAt → released", () => {
    const bp = { ...base, embargo: { releaseAt: "2020-01-01T00:00:00Z" } };
    expect(isReleased(bp, new Date("2026-06-16T00:00:00Z"))).toBe(true);
  });
});

describe("facade — assessment ops", () => {
  it("round-trips a template and an answer key through packageOps", async () => {
    const { store, packageId } = await seeded();
    const ops = packageOps(store, packageId);
    const t = makeTemplate();
    await ops.saveQuestionTemplate(t);
    expect(await ops.loadQuestionTemplate(t.id)).toEqual(t);

    const key: AnswerKey = { itemId: newQuestionItemId(), answer: "secret", rationale: "" };
    await ops.saveAnswerKey(key);
    expect(await ops.loadAnswerKey(key.itemId)).toEqual(key);

    // facade isReleased delegates to the pure check
    expect(ops.isReleased(makeBlueprint(), new Date())).toBe(true);
  });
});

function makeBlueprint(): AssessmentBlueprint {
  return { id: newBlueprintId(), title: "BP", entries: [], objectiveIds: [] };
}
