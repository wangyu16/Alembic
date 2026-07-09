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
    selection: true,
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
    selection: true,
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
    id: "enrich-formatting",
    title: "Enrich formatting",
    summary:
      "Apply orz-markdown constructs — callouts, columns, tabs, TOC, highlights — where they aid readability.",
    appliesTo: ["content"],
    mode: "edit",
    surface: "assistant",
    routingKind: "editor-ai-edit",
    changeKind: "editor-ai-edit",
    event: "ai.edit.requested",
    skill: "enrich-formatting",
    entitlement: "ai",
    instruction:
      "Enrich the formatting of this orz-markdown using its native constructs where they genuinely aid comprehension: callout containers (`::: info`, `::: tip`, `::: warn`, `::: center`, `::: spoil Title`), multi-column (`:::: cols` / `::: col`), tabs (`:::: tabs` / `::: tab Label`), a table of contents (`{{toc}}`), and inline highlights (`{{sp[red] text}}`). Do NOT change the meaning, wording, headings, block-id markers (`{{attrs[#blk-…]}}`), math, code, or chemistry notation. Add structure only where it clarifies — never over-format. Return the whole passage.",
    selection: true,
    status: "available",
  },
  {
    id: "suggest-slide-layout",
    title: "Suggest slide layout",
    summary:
      "Restructure slides with orz-slides layout — slide markers, title bands, region splits, speaker notes.",
    appliesTo: ["slides"],
    mode: "edit",
    surface: "assistant",
    routingKind: "editor-ai-edit",
    changeKind: "editor-ai-edit",
    event: "ai.edit.requested",
    skill: "suggest-slide-layout",
    entitlement: "ai",
    instruction:
      "Improve this orz-slides source using its comment-based layout grammar. Slides are separated by `<!-- slide [template] [layout] -->` markers (there is NO bare `---`); an optional leading `<!-- deck … -->` sets deck config; a leading `## title` becomes the slide's title band. Split the content with region markers — e.g. `<!-- slide 2col -->` then `<!-- @left -->` / `<!-- @right -->`, or `row`/`col` splits — and `<!-- @notes -->` for speaker notes; `template=title` for a title slide. Keep one idea per slide, concise bullets over prose. Preserve meaning, math, code, and chemistry. Return the whole passage.",
    selection: true,
    status: "available",
  },
  {
    id: "suggest-page-settings",
    title: "Suggest page settings",
    summary:
      "Tune the orz-paged layout — template, page size, margins, headers/footers, page breaks.",
    appliesTo: ["paged"],
    mode: "edit",
    surface: "assistant",
    routingKind: "editor-ai-edit",
    changeKind: "editor-ai-edit",
    event: "ai.edit.requested",
    skill: "suggest-page-settings",
    entitlement: "ai",
    instruction:
      "Improve this orz-paged document's layout using its page model. Choose a fitting template (`article`, `report`, or `exam`, in a title-page or title-section variant) and page settings — page size (A4 / Letter), margins, running headers/footers, page numbers — via the leading config, plus `font_preset` / `decoration_color` / `page_background` where appropriate. Use page-break controls where a section should start on a new page. Preserve the content, headings, math, code, and chemistry. Return the whole document.",
    selection: true,
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
