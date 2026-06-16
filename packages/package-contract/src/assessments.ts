/**
 * Assessment & question-template contract (Phase 4, goal.md §2 / Roadmap Phase 4).
 *
 * The assessment-support layer with a HARD public/private boundary:
 *   - Question *templates*, assessment *blueprints*, and generated question
 *     *items* (stems/choices) are public-safe → the public `assessment-support`
 *     layer.
 *   - Answer *keys* (and solutions) are instructor-only → the private
 *     `private-instructor` layer. They must NEVER reach the public repo; the
 *     path helpers place them under `private-instructor/`, and
 *     `assertPathAllowedInRepo` (CLAUDE.md rule 1) fails closed on any attempt to
 *     stage them public.
 *
 * Templates/blueprints/items align to the hidden planning layer by concept and
 * objective id (M9.6), so generated assessments are traceable to intent. Pure:
 * no IO, no framework imports.
 */

import { z } from "zod";
import { assertPathAllowedInRepo } from "./layers";

// --- ids --------------------------------------------------------------------

const BASE36 = "abcdefghijklmnopqrstuvwxyz0123456789";
function randomId(prefix: string, len = 10): string {
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  let out = `${prefix}-`;
  for (const byte of bytes) out += BASE36[byte % 36];
  return out;
}

export const QUESTION_TEMPLATE_ID_PATTERN = /^qt-[a-z0-9]{8,}$/;
export const BLUEPRINT_ID_PATTERN = /^bp-[a-z0-9]{8,}$/;
export const QUESTION_ITEM_ID_PATTERN = /^qi-[a-z0-9]{8,}$/;

/** New question-template id: `qt-` + 10 base36. */
export function newQuestionTemplateId(): string {
  return randomId("qt");
}
/** New assessment-blueprint id: `bp-` + 10 base36. */
export function newBlueprintId(): string {
  return randomId("bp");
}
/** New question-item id: `qi-` + 10 base36. */
export function newQuestionItemId(): string {
  return randomId("qi");
}

// --- shared enums -----------------------------------------------------------

export const DifficultySchema = z.enum(["intro", "core", "challenge"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

/** How a question is represented (chemistry-first; extensible by string). */
export const RepresentationSchema = z.enum([
  "prose",
  "equation",
  "structure",
  "graph",
  "table",
  "numeric",
]);
export type Representation = z.infer<typeof RepresentationSchema>;

// --- question template (PUBLIC: assessment-support) -------------------------

/** A named, parameterizable input the template exposes to generation. */
export const TemplateParameterSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
});
export type TemplateParameter = z.infer<typeof TemplateParameterSchema>;

/**
 * Instructor-defined RULES for generating items — never the answer. Aligns to
 * concepts/objectives (M9.6), carries difficulty, the representations to use,
 * parameterization, and the misconceptions an item should probe.
 */
export const QuestionTemplateSchema = z.object({
  id: z.string().regex(QUESTION_TEMPLATE_ID_PATTERN),
  /** Generation instructions / the template stem. */
  prompt: z.string().min(1),
  /** Optional scenario/context framing. */
  context: z.string().default(""),
  conceptIds: z.array(z.string()).default([]),
  objectiveIds: z.array(z.string()).default([]),
  difficulty: DifficultySchema,
  representations: z.array(RepresentationSchema).default([]),
  parameters: z.array(TemplateParameterSchema).default([]),
  /** Misconceptions a generated item should target/probe. */
  misconceptionTargets: z.array(z.string()).default([]),
});
export type QuestionTemplate = z.infer<typeof QuestionTemplateSchema>;

// --- assessment blueprint (PUBLIC: assessment-support) ----------------------

/**
 * Embargo metadata: an assessment may auto-release at `releaseAt`; before then
 * it is instructor-only. The owner can lift early (a Tier-3 operation, M24) —
 * that's an action, not stored state beyond clearing/altering this.
 */
export const EmbargoSchema = z.object({
  releaseAt: z.iso.datetime().optional(),
});
export type Embargo = z.infer<typeof EmbargoSchema>;

export const BlueprintEntrySchema = z.object({
  templateId: z.string().regex(QUESTION_TEMPLATE_ID_PATTERN),
  /** How many items to draw from this template. */
  count: z.number().int().positive().default(1),
  /** Relative weight in scoring. */
  weight: z.number().nonnegative().default(1),
});
export type BlueprintEntry = z.infer<typeof BlueprintEntrySchema>;

export const AssessmentBlueprintSchema = z.object({
  id: z.string().regex(BLUEPRINT_ID_PATTERN),
  title: z.string().min(1),
  entries: z.array(BlueprintEntrySchema).default([]),
  /** Objectives the assessment as a whole covers. */
  objectiveIds: z.array(z.string()).default([]),
  embargo: EmbargoSchema.optional(),
});
export type AssessmentBlueprint = z.infer<typeof AssessmentBlueprintSchema>;

// --- generated question item (PUBLIC stem) + answer key (PRIVATE) -----------

/** The public-safe part of a generated item — stem + optional choices, NO answer. */
export const QuestionItemSchema = z.object({
  id: z.string().regex(QUESTION_ITEM_ID_PATTERN),
  /** Provenance: the template this item was generated from. */
  templateId: z.string().regex(QUESTION_TEMPLATE_ID_PATTERN),
  objectiveIds: z.array(z.string()).default([]),
  /** The question text shown to students. */
  stem: z.string().min(1),
  /** Multiple-choice options (public-safe). Omit/empty for open response. */
  choices: z.array(z.string()).default([]),
});
export type QuestionItem = z.infer<typeof QuestionItemSchema>;

/** The instructor-only answer for an item. PRIVATE — never staged public. */
export const AnswerKeySchema = z.object({
  itemId: z.string().regex(QUESTION_ITEM_ID_PATTERN),
  /** Correct answer / worked solution. */
  answer: z.string().min(1),
  rationale: z.string().default(""),
});
export type AnswerKey = z.infer<typeof AnswerKeySchema>;

// --- placement (path helpers; the boundary is enforced by assertPathAllowedInRepo) ---

/** Public-safe question template record (assessment-support layer). */
export function questionTemplatePath(id: string): string {
  return `assessment-support/templates/${id}.json`;
}
/** Public-safe assessment blueprint record (assessment-support layer). */
export function blueprintPath(id: string): string {
  return `assessment-support/blueprints/${id}.json`;
}
/** Public-safe generated question item (assessment-support layer). */
export function questionItemPath(id: string): string {
  return `assessment-support/items/${id}.json`;
}
/** PRIVATE answer key (private-instructor layer) — never staged to public. */
export function answerKeyPath(itemId: string): string {
  return `private-instructor/answer-keys/${itemId}.json`;
}

/**
 * Assert that an answer-key path is private-only: it must be rejected for the
 * public repo and accepted for the private repo. A guard for save paths that
 * makes the "keys never touch the public repo" guarantee explicit and testable
 * (the underlying enforcement is the two-repo invariant in `layers.ts`).
 */
export function assertAnswerKeyPrivate(path: string): void {
  assertPathAllowedInRepo(path, "private"); // throws if not a private-layer path
  let publicAllowed = false;
  try {
    assertPathAllowedInRepo(path, "public");
    publicAllowed = true;
  } catch {
    // expected — an answer key must not be allowed in the public repo
  }
  if (publicAllowed) {
    throw new Error(`Answer-key path "${path}" must not be allowed in the public repo`);
  }
}
