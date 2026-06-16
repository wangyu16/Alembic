/**
 * AI question generation from a template (Phase 4, M23).
 *
 * Educators define question TEMPLATES (rules: aligned to concepts/objectives,
 * carrying difficulty, representations, parameters, and misconception targets).
 * This module generates question ITEMS that respect that design.
 *
 * HARD public/private boundary (mirrors `@alembic/package-contract`
 * `assessments.ts`): each generated item PAIRS a public-safe part (stem +
 * choices) with its PRIVATE answer (correct answer + rationale). This generator
 * keeps the answer in its own field and instructs the model never to leak it
 * into the stem/choices. The caller mints ids and SPLITS each `GeneratedItem`
 * into a public `QuestionItem` (id + templateId + objectiveIds + stem + choices)
 * and a private `AnswerKey` (itemId + answer + rationale). This module never
 * mints ids, writes files, talks to Git, or renders HTML.
 *
 * Provider-neutral (CLAUDE.md rule 6 — no provider/model name is hardcoded; the
 * governed provider injects the per-task model).
 */

import type { AIProvider } from "./provider";
import { stripBlockMarkers } from "./drafting";
import type { QuestionTemplate } from "@alembic/package-contract";

// --- public shapes ----------------------------------------------------------

/**
 * One generated question, pairing its public part with its private answer. The
 * caller mints ids and splits this into a public `QuestionItem` (stem/choices)
 * and a private `AnswerKey` (answer/rationale).
 */
export interface GeneratedItem {
  /** Public question text shown to students. */
  stem: string;
  /** Public MCQ options; empty means open response. */
  choices: string[];
  /** PRIVATE — the correct answer / worked solution. Never staged public. */
  answer: string;
  /** PRIVATE — why the answer is correct (and why distractors are wrong). */
  rationale: string;
  /** Alignment carried from the template. */
  objectiveIds: string[];
}

export interface GenerateQuestionsInput {
  /** The instructor-defined rules to generate from. */
  template: QuestionTemplate;
  /** How many items to produce. Default 1. */
  count?: number;
  courseTitle?: string;
}

// --- system prompt ----------------------------------------------------------

export const QUESTION_GEN_SYSTEM = `You are a question author for an open educational resource (OER) authoring platform. An educator gives you a QUESTION TEMPLATE — the rules for generating questions — and asks for a number of distinct question ITEMS that respect that design.

Respect the template's design exactly:
- DIFFICULTY: match the stated level (intro = recall/recognition; core = application; challenge = analysis/synthesis).
- REPRESENTATIONS: frame each item using the listed representations (e.g. prose, equation, structure, graph, table, numeric).
- PARAMETERS: vary the named parameters across items so the items are distinct, not duplicates.
- CONTEXT: honor the scenario/context framing if one is given.
- MISCONCEPTION TARGETS: for multiple-choice items, write plausible distractors that each probe one of the listed misconceptions. For open-response items, design the prompt so a common misconception would produce a wrong answer.
- ALIGNMENT: align every item to the template's objective ids; echo them back in each item's objectiveIds.

PUBLIC / PRIVATE SEPARATION (critical — violating this makes your output unusable):
- The "stem" and "choices" are PUBLIC and shown to students. They must NOT reveal, mark, hint at, or letter the correct answer in any way.
- Put the correct answer ONLY in the "answer" field. Put the explanation ONLY in the "rationale" field. Never place the answer or its justification inside "stem" or "choices".
- For multiple-choice items, the correct option's text still appears among "choices" (unmarked), and "answer" states which option is correct (and may restate it). For open-response items, leave "choices" empty and put the full correct answer/solution in "answer".

Do not emit any {{attrs[#blk-...]}} markers or any other platform identifiers inside any field; identifiers are managed by the platform.

Return STRICT JSON ONLY — no prose, no Markdown, no code fences — matching exactly this shape:

{
  "items": [
    {
      "stem": string,            // PUBLIC question text — no answer, no answer hints
      "choices": [string],       // PUBLIC MCQ options (unmarked); empty array for open response
      "answer": string,          // PRIVATE correct answer / worked solution
      "rationale": string,       // PRIVATE brief explanation of why it is correct
      "objectiveIds": [string]   // the template's objective ids this item aligns to
    }
  ]
}

Produce exactly the requested number of items. Each item must have a non-empty "stem" and a non-empty "answer".`;

// --- tolerant JSON parsing --------------------------------------------------

/**
 * Pull a JSON object out of a model response that may be wrapped in ``` or
 * ```json fences and/or surrounded by stray prose. Returns the substring from
 * the first `{` to the last `}` (inclusive), or the trimmed input if no braces
 * are found (so `JSON.parse` produces the actual parse error).
 */
function extractJsonObject(raw: string): string {
  let text = raw.trim();
  text = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

// --- user-prompt serialization ----------------------------------------------

function serializeTemplate(input: GenerateQuestionsInput): string {
  const { template } = input;
  const count = input.count ?? 1;
  const parts: string[] = [];

  if (input.courseTitle?.trim()) parts.push(`Course: ${input.courseTitle.trim()}`);
  parts.push(`Generate ${count} distinct question item(s) from this template.`);
  parts.push("");
  parts.push(`Difficulty: ${template.difficulty}`);
  parts.push(`Template prompt (generation instructions): ${template.prompt}`);

  if (template.context.trim()) {
    parts.push(`Context / scenario framing: ${template.context.trim()}`);
  }
  parts.push(
    `Representations to use: ${
      template.representations.length ? template.representations.join(", ") : "(none specified)"
    }`,
  );

  if (template.parameters.length) {
    parts.push("");
    parts.push("Parameters to vary across items:");
    for (const p of template.parameters) {
      const desc = p.description.trim() ? ` — ${p.description.trim()}` : "";
      parts.push(`- ${p.name}${desc}`);
    }
  }

  if (template.misconceptionTargets.length) {
    parts.push("");
    parts.push("Misconceptions to probe (write distractors / prompts that target these):");
    for (const m of template.misconceptionTargets) parts.push(`- ${m}`);
  }

  parts.push("");
  parts.push(
    `Objective ids to align each item to (echo these back in objectiveIds): ${
      template.objectiveIds.length ? template.objectiveIds.join(", ") : "(none)"
    }`,
  );

  return parts.join("\n");
}

// --- normalization ----------------------------------------------------------

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Validate and normalize one raw item from the model. Strips stray block-id
 * markers from every text field, coerces choices/objectiveIds to string arrays,
 * defaults objectiveIds to the template's when omitted/empty, and enforces a
 * non-empty stem + answer. Returns null if the shape is unusable.
 */
function normalizeItem(raw: unknown, template: QuestionTemplate): GeneratedItem | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  if (typeof obj.stem !== "string" || typeof obj.answer !== "string") return null;

  const stem = stripBlockMarkers(obj.stem).trim();
  const answer = stripBlockMarkers(obj.answer).trim();
  if (stem === "" || answer === "") return null;

  const choices = asStringArray(obj.choices).map((c) => stripBlockMarkers(c).trim());
  const rationale =
    typeof obj.rationale === "string" ? stripBlockMarkers(obj.rationale).trim() : "";

  const modelObjectiveIds = asStringArray(obj.objectiveIds);
  const objectiveIds =
    modelObjectiveIds.length > 0 ? modelObjectiveIds : [...template.objectiveIds];

  return { stem, choices, answer, rationale, objectiveIds };
}

// --- generation -------------------------------------------------------------

/**
 * Generate question items from a template via the single-call `AIProvider`.
 * Builds the strict system + user prompts, parses the response tolerantly,
 * strips stray id markers, validates each item (non-empty stem + answer), and
 * defaults objectiveIds to the template's when the model omits them. Throws a
 * clear Error on any parse/validation failure.
 */
export async function generateQuestions(
  provider: AIProvider,
  input: GenerateQuestionsInput,
  opts?: { model?: string },
): Promise<{ items: GeneratedItem[] }> {
  const { text } = await provider.generateText({
    system: QUESTION_GEN_SYSTEM,
    prompt: serializeTemplate(input),
    // Do NOT default a model name — the governed provider injects one.
    ...(opts?.model ? { model: opts.model } : {}),
    temperature: 0.3,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(text));
  } catch (cause) {
    throw new Error(
      `Question generator returned invalid JSON: ${(cause as Error).message}`,
      { cause },
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Question generator returned a non-object JSON value.");
  }

  const rawItems = (parsed as Record<string, unknown>).items;
  if (!Array.isArray(rawItems)) {
    throw new Error('Question generator response is missing an "items" array.');
  }

  const items: GeneratedItem[] = [];
  for (const raw of rawItems) {
    const item = normalizeItem(raw, input.template);
    if (item === null) {
      throw new Error(
        "Question generator produced an item missing a non-empty stem and answer.",
      );
    }
    items.push(item);
  }

  if (items.length === 0) {
    throw new Error("Question generator returned no usable items.");
  }

  return { items };
}

// --- deterministic stub -----------------------------------------------------

/**
 * A no-network generator for tests and offline/dev. Returns `count` items
 * derived from the template — each stem references the template prompt, with a
 * placeholder answer — so callers can exercise the split/mint path without a
 * provider call. objectiveIds carry over from the template.
 */
export function stubGenerateQuestions(input: GenerateQuestionsInput): { items: GeneratedItem[] } {
  const count = input.count ?? 1;
  const { template } = input;
  const items: GeneratedItem[] = [];

  for (let i = 0; i < count; i++) {
    const n = i + 1;
    items.push({
      stem: `[${template.difficulty}] ${template.prompt} (variant ${n})`,
      choices: [],
      answer: "See solution.",
      rationale: `Generated from template ${template.id} (variant ${n}).`,
      objectiveIds: [...template.objectiveIds],
    });
  }

  return { items };
}
