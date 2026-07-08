import type { AIOperation, OperationCategory } from "./operation";
import { appliesToCategory } from "./operation";

/**
 * The AI operations catalog — the single source of truth for which AI actions
 * exist, where they're offered, and the rules each follows. Add an operation by
 * adding one row here + a skill under `skills/ai-operations/<id>` (+ a durable
 * function in `@alembic/ai-assist` if the capability is new). Never a parallel
 * mechanism (architecture rule 9).
 *
 * First-pass wiring: the three universal `edit`-mode aids run through the
 * existing propose → diff → apply path (`proposeEditAction` with the op's
 * `instruction`). `generate`/`analyze` ops are declared here and surfaced in the
 * menu, but marked `planned` until their execution + change-tier routing land.
 */
export const AI_OPERATIONS: readonly AIOperation[] = [
  {
    id: "check-spelling-grammar",
    title: "Check spelling & grammar",
    summary:
      "Fix spelling, grammar, and punctuation without changing meaning or structure.",
    appliesTo: "*",
    mode: "edit",
    surface: "assistant",
    routingKind: "spelling-grammar",
    changeKind: "editor-ai-edit",
    event: "ai.edit.requested",
    skill: "check-spelling-grammar",
    entitlement: "ai",
    instruction:
      "Correct spelling, grammar, and punctuation only. Do not change meaning, wording style, structure, or formatting beyond what is required for correctness. Preserve all Markdown, block-id attributes, links, and math verbatim.",
    status: "available",
  },
  {
    id: "improve-language",
    title: "Improve language",
    summary:
      "Improve clarity and flow while preserving meaning and the author's voice.",
    appliesTo: "*",
    mode: "edit",
    surface: "assistant",
    routingKind: "editor-ai-edit",
    changeKind: "editor-ai-edit",
    event: "ai.edit.requested",
    skill: "improve-language",
    entitlement: "ai",
    instruction:
      "Improve clarity, flow, and readability while preserving the meaning and the author's voice. Do not add or remove content. Preserve all Markdown, block-id attributes, links, and math.",
    status: "available",
  },
  {
    id: "check-accessibility",
    title: "Check accessibility",
    summary:
      "Add missing alt text, fix heading order and link text, ensure table headers.",
    appliesTo: "*",
    mode: "edit",
    surface: "assistant",
    routingKind: "editor-ai-edit",
    changeKind: "editor-ai-edit",
    event: "ai.edit.requested",
    skill: "check-accessibility",
    entitlement: "ai",
    instruction:
      "Improve accessibility only: ensure every image has meaningful alt text, headings form a logical order without skipped levels, links have descriptive text (never 'click here'), and tables have header rows. Preserve meaning and all Markdown, block-id attributes, and math. Make accessibility-related changes only.",
    status: "available",
  },
  {
    id: "draft-description",
    title: "Draft description",
    summary:
      "Draft the course description from the course title and chapter outline.",
    appliesTo: ["course"],
    mode: "generate",
    surface: "assistant",
    routingKind: "course-metadata",
    changeKind: "draft-section",
    event: "ai.draft.requested",
    skill: "draft-description",
    entitlement: "ai",
    status: "available",
  },
  {
    id: "generate-concept-map",
    title: "Generate concept map",
    summary:
      "Draft the course concept map from the chapter concept maps, or from a provided draft.",
    appliesTo: ["course"],
    mode: "generate",
    surface: "assistant",
    routingKind: "course-metadata",
    changeKind: "draft-section",
    event: "ai.draft.requested",
    skill: "generate-concept-map",
    entitlement: "ai",
    gate: (ctx) =>
      ctx.conceptMapsReady || ctx.draftProvided
        ? true
        : "Available once every chapter has a concept map, or you provide a draft (Word, PDF…).",
    status: "planned",
  },
];

/** The operations offered on a given page category, in registry order. */
export function operationsForCategory(category: OperationCategory): AIOperation[] {
  return AI_OPERATIONS.filter((op) => appliesToCategory(op, category));
}

/** Look up an operation by its stable id. */
export function operationById(id: string): AIOperation | undefined {
  return AI_OPERATIONS.find((op) => op.id === id);
}
