/**
 * Plan-driven study-guide drafting (M9.6d).
 *
 * The original authoring flow is concept-map-first: an educator sketches the
 * hidden planning layer (concept map + learning objectives), and the study
 * guide is drafted *according to that map*. This turns a set of objectives +
 * concepts into ordered study-guide sections. Output is sanitized of block-ID
 * markers (the platform mints IDs on save) and routed into the Tier-2 review
 * queue by the caller — never applied directly.
 */

import type { AIProvider } from "./provider";
import { stripBlockMarkers } from "./drafting";
import { splitIntoBlocks, type RestructuredBlock } from "./restructure";

export interface PlanObjective {
  id: string;
  text: string;
  conceptIds: string[];
}

export interface PlanConcept {
  id: string;
  label: string;
  prerequisites: string[];
  related: string[];
}

export interface DraftFromPlanInput {
  objectives: PlanObjective[];
  concepts: PlanConcept[];
  /** Course/chapter title for context. */
  context?: string;
}

const PLAN_DRAFT_SYSTEM = `You are helping an educator draft a study guide from its planning layer: a concept map (topics with prerequisites and correlations) and a set of learning objectives. Produce clear, accurate, student-facing study-guide sections that, together, cover every objective. Sequence the sections so prerequisite topics come before the topics that depend on them. Use a level-2 Markdown heading ("## ") for each section title, followed by its explanatory prose. Do not write answer keys or assessments. Do not invent facts beyond the objectives' scope. Output only the Markdown sections — no preamble, no block-id markers.`;

/**
 * Draft ordered study-guide sections (title + Markdown body) that cover the
 * given objectives, sequenced by the concept map's prerequisites. The caller
 * mints block IDs on accept; output is sanitized of any stray markers.
 */
export async function draftOutlineFromPlan(
  provider: AIProvider,
  input: DraftFromPlanInput,
): Promise<{ blocks: RestructuredBlock[] }> {
  const lines: string[] = [];
  if (input.context?.trim()) lines.push(`Course: ${input.context.trim()}`);

  if (input.concepts.length) {
    lines.push("", "Concept map (prerequisites = must come first):");
    for (const c of input.concepts) {
      const pre = c.prerequisites.length ? ` — after: ${c.prerequisites.join(", ")}` : "";
      const rel = c.related.length ? ` — related: ${c.related.join(", ")}` : "";
      lines.push(`- [${c.id}] ${c.label}${pre}${rel}`);
    }
  }

  lines.push("", "Learning objectives to cover:");
  for (const o of input.objectives) {
    const concepts = o.conceptIds.length ? ` (concepts: ${o.conceptIds.join(", ")})` : "";
    lines.push(`- ${o.text}${concepts}`);
  }
  lines.push("", "Draft the study-guide sections now.");

  const { text } = await provider.generateText({
    system: PLAN_DRAFT_SYSTEM,
    prompt: lines.join("\n"),
    temperature: 0.4,
  });

  const clean = stripBlockMarkers(text).trim();
  return { blocks: splitIntoBlocks(clean, input.context) };
}
