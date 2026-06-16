/**
 * Bounded, app-orchestrated Tier-B coherence agent (Roadmap Phase 3, M18.2).
 *
 * The agent is a *producer of reviewed changes*, never a writer. It examines a
 * course (chapters + blocks) for a given educator task — consistent
 * terminology, objective coverage, valid cross-references, sensible ordering —
 * and emits a `ProposedChangeSet` (pure typed data from
 * `@alembic/package-contract`). That set flows into the Tier-2 review queue and,
 * on educator accept, is applied through `packageOps` (the one validated write
 * path), so block-ID integrity (CLAUDE.md rule 7) and the two-repo invariant
 * hold exactly as for human edits. Nothing here writes files, talks to Git, or
 * renders HTML.
 *
 * The engine is hidden behind a `CoherenceHarness` boundary so it is swappable
 * (forward-compat: a Claude Code SDK harness could replace the provider-backed
 * one later without changing the produced data shape). The default
 * implementation is backed only by the single-call `AIProvider` interface, so it
 * stays provider-neutral (CLAUDE.md rule 6 — no provider/model name is
 * hardcoded; the governed provider injects the per-task model).
 */

import type { AIProvider } from "./provider";
import { stripBlockMarkers } from "./drafting";
import {
  PROPOSED_CHANGE_SET_VERSION,
  ProposedChangeSetSchema,
  type ProposedChangeSet,
} from "@alembic/package-contract";

// --- Harness boundary -------------------------------------------------------

export interface CoherenceContextBlock {
  id: string;
  title: string;
  body: string;
}

export interface CoherenceContextChapter {
  slug: string;
  title: string;
  blocks: CoherenceContextBlock[];
}

/** A learning objective from the hidden planning layer (alignment target). */
export interface CoherenceObjective {
  id: string;
  text: string;
  conceptIds: string[];
}

/** A concept from the hidden planning layer (prerequisites + correlations). */
export interface CoherenceConcept {
  id: string;
  label: string;
  prerequisites: string[];
  related: string[];
}

export interface CoherenceRunInput {
  /** What the educator asked, e.g. "make terminology consistent". */
  task: string;
  courseTitle?: string;
  chapters: CoherenceContextChapter[];
  /** Course-level learning objectives the content should cover, if defined. */
  objectives?: CoherenceObjective[];
  /** Course-level concept map (ordering/correlations), if defined. */
  concepts?: CoherenceConcept[];
}

/**
 * The swappable engine boundary. Any implementation must return a valid
 * `ProposedChangeSet` (or throw); callers surface a throw as `agent.run.failed`.
 */
export interface CoherenceHarness {
  run(input: CoherenceRunInput): Promise<ProposedChangeSet>;
}

// --- System prompt ----------------------------------------------------------

export const COHERENCE_SYSTEM = `You are a coherence reviewer for an open educational resource (OER) authoring platform. An educator gives you a TASK and the full text of a course, organized into chapters; each chapter has a slug, and each block within it has an id, a title, and a Markdown body.

Your job is to review the course for coherence and pedagogy — consistent terminology, objectives matched to supporting content, valid cross-references, and a sensible learning sequence — and propose a small, reviewable set of changes. You OPTIMIZE for coherence; you do not enforce correctness. A human educator reviews and approves everything you propose; nothing is applied automatically.

When a CONCEPT MAP and LEARNING OBJECTIVES are provided (the course's hidden planning layer), use them as the source of truth for intent: flag objectives with no supporting content as 'objective-coverage' findings, and topics sequenced against their stated prerequisites as 'ordering' findings. Cite the relevant concept/objective ids in the finding summary. Never propose changing the planning layer itself — only the study-guide blocks.

BLOCK IDENTITY RULES (critical — violating these makes your output unusable):
- You may ONLY reference block ids that appear verbatim in the input.
- NEVER invent, alter, renumber, reformat, or reuse a block id.
- 'update-block' and 'reorder-blocks' must reference existing ids exactly as given.
- 'create-block' carries NO id — a fresh id is minted later when the educator accepts; you only say where to insert it.
- You may NOT delete blocks; deletion is a deliberate human action, not a suggestion.
- Do not emit any {{attrs[#blk-...]}} markers inside titles or bodies; identifiers are managed by the platform.

Every finding and every operation MUST include a clear, educator-facing rationale written in plain language (no Git or developer jargon).

Return STRICT JSON ONLY — no prose, no Markdown, no code fences — matching exactly this shape (do NOT include a "version" field; it is stamped by the platform):

{
  "task": string,           // restate the educator's task
  "summary": string,        // overall plain-language explanation of what you propose
  "findings": [
    {
      "kind": "terminology" | "objective-coverage" | "cross-reference" | "stale-artifact" | "ordering" | "other",
      "summary": string,    // educator-facing description of the issue
      "locations": [ { "chapterSlug": string, "blockId"?: string } ]
    }
  ],
  "operations": [ <operation> ]
}

Each <operation> is exactly ONE of these three JSON variants:

1. Edit an existing block (id preserved):
   {
     "op": "update-block",
     "chapterSlug": string,
     "blockId": string,     // an existing id, exactly as given
     "title"?: string,      // new heading text, only if the title changes
     "body"?: string,       // new Markdown body, only if the content changes
     "rationale": string
   }
   At least one of "title" or "body" must be present.

2. Add a new block (NO id — minted on accept):
   {
     "op": "create-block",
     "chapterSlug": string,
     "afterBlockId": string | null,  // insert after this existing id; null prepends
     "title": string,
     "body": string,
     "rationale": string
   }

3. Reorder a chapter's blocks (no content change):
   {
     "op": "reorder-blocks",
     "chapterSlug": string,
     "orderedBlockIds": [string],  // every one of the chapter's existing ids, each once, in the new order
     "rationale": string
   }

If the course is already coherent for the task, return empty "findings" and "operations" arrays and explain that in "summary". Keep the change set small and focused on the task.`;

// --- Tolerant JSON parsing --------------------------------------------------

/**
 * Pull a JSON object out of a model response that may be wrapped in ``` or
 * ```json fences and/or surrounded by stray prose. Returns the substring from
 * the first `{` to the last `}` (inclusive), or the trimmed input if no braces
 * are found (so `JSON.parse` produces the actual parse error).
 */
function extractJsonObject(raw: string): string {
  let text = raw.trim();
  // Strip a leading ```json / ``` fence and a trailing ``` fence if present.
  text = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return text;
  return text.slice(start, end + 1);
}

/** Run block-id markers out of every title/body in the raw operations array. */
function sanitizeOperations(operations: unknown): unknown {
  if (!Array.isArray(operations)) return operations;
  return operations.map((op) => {
    if (op === null || typeof op !== "object") return op;
    const next: Record<string, unknown> = { ...(op as Record<string, unknown>) };
    if (typeof next.title === "string") next.title = stripBlockMarkers(next.title);
    if (typeof next.body === "string") next.body = stripBlockMarkers(next.body);
    return next;
  });
}

// --- User-prompt serialization ----------------------------------------------

function serializeCourse(input: CoherenceRunInput): string {
  const parts: string[] = [];
  if (input.courseTitle?.trim()) parts.push(`Course: ${input.courseTitle.trim()}`);
  parts.push(`Task: ${input.task}`);

  if (input.concepts?.length) {
    parts.push("");
    parts.push("Concept map (prerequisites = must come first; related = correlated topics):");
    for (const c of input.concepts) {
      const pre = c.prerequisites.length ? ` — after: ${c.prerequisites.join(", ")}` : "";
      const rel = c.related.length ? ` — related: ${c.related.join(", ")}` : "";
      parts.push(`- [${c.id}] ${c.label}${pre}${rel}`);
    }
  }
  if (input.objectives?.length) {
    parts.push("");
    parts.push("Learning objectives (each should be supported by the study guide):");
    for (const o of input.objectives) {
      const concepts = o.conceptIds.length ? ` (concepts: ${o.conceptIds.join(", ")})` : "";
      parts.push(`- [${o.id}] ${o.text}${concepts}`);
    }
  }

  parts.push("");
  parts.push("Course content (address blocks by their given id):");

  for (const chapter of input.chapters) {
    parts.push("");
    parts.push(`# Chapter [slug: ${chapter.slug}] — ${chapter.title}`);
    if (chapter.blocks.length === 0) {
      parts.push("(no blocks)");
      continue;
    }
    for (const block of chapter.blocks) {
      parts.push("");
      parts.push(`## Block [id: ${block.id}] — ${block.title}`);
      parts.push(block.body);
    }
  }

  return parts.join("\n");
}

// --- Provider-backed harness ------------------------------------------------

/**
 * The default harness: backed only by the single-call `AIProvider`. Builds the
 * strict system + user prompts, parses the response tolerantly, sanitizes any
 * stray id markers out of operation content, stamps the schema version, and
 * validates with `ProposedChangeSetSchema`. Throws a clear Error on any parse or
 * validation failure (the caller surfaces it as `agent.run.failed`).
 */
export function createProviderCoherenceHarness(
  provider: AIProvider,
  opts?: { model?: string },
): CoherenceHarness {
  return {
    async run(input: CoherenceRunInput): Promise<ProposedChangeSet> {
      const { text } = await provider.generateText({
        system: COHERENCE_SYSTEM,
        prompt: serializeCourse(input),
        // Do NOT default a model name — the governed provider injects one.
        ...(opts?.model ? { model: opts.model } : {}),
        temperature: 0.2,
      });

      let parsed: unknown;
      try {
        parsed = JSON.parse(extractJsonObject(text));
      } catch (cause) {
        throw new Error(
          `Coherence agent returned invalid JSON: ${(cause as Error).message}`,
          { cause },
        );
      }

      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Coherence agent returned a non-object JSON value.");
      }

      const candidate: Record<string, unknown> = {
        ...(parsed as Record<string, unknown>),
        operations: sanitizeOperations((parsed as Record<string, unknown>).operations),
        version: PROPOSED_CHANGE_SET_VERSION,
      };

      const result = ProposedChangeSetSchema.safeParse(candidate);
      if (!result.success) {
        throw new Error(
          `Coherence agent produced an invalid change set: ${result.error.message}`,
        );
      }
      return result.data;
    },
  };
}

// --- Deterministic stub -----------------------------------------------------

/**
 * A no-network harness for tests and offline/dev. Returns a valid
 * `ProposedChangeSet` derived from its input (one `update-block` on the first
 * block of the first non-empty chapter), unless `canned` overrides the shape.
 * Proves the boundary is swappable without any provider call.
 */
export function createStubCoherenceHarness(
  canned?: Partial<ProposedChangeSet>,
): CoherenceHarness {
  return {
    async run(input: CoherenceRunInput): Promise<ProposedChangeSet> {
      const firstChapter = input.chapters.find((c) => c.blocks.length > 0);
      const firstBlock = firstChapter?.blocks[0];

      const base: ProposedChangeSet = {
        version: PROPOSED_CHANGE_SET_VERSION,
        task: input.task,
        summary:
          firstBlock !== undefined
            ? `Reviewed ${input.chapters.length} chapter(s) for: ${input.task}.`
            : `No editable content found for: ${input.task}.`,
        findings:
          firstChapter && firstBlock
            ? [
                {
                  kind: "other",
                  summary: `Proposed a clarity pass on "${firstBlock.title}".`,
                  locations: [
                    { chapterSlug: firstChapter.slug, blockId: firstBlock.id },
                  ],
                },
              ]
            : [],
        operations:
          firstChapter && firstBlock
            ? [
                {
                  op: "update-block",
                  chapterSlug: firstChapter.slug,
                  blockId: firstBlock.id,
                  body: stripBlockMarkers(firstBlock.body),
                  rationale: `Clarified wording in "${firstBlock.title}" for the task: ${input.task}.`,
                },
              ]
            : [],
      };

      // Apply caller overrides, then re-validate so the stub can never hand
      // back a set that would fail downstream.
      const merged: ProposedChangeSet = {
        ...base,
        ...canned,
        version: PROPOSED_CHANGE_SET_VERSION,
      };
      return ProposedChangeSetSchema.parse(merged);
    },
  };
}
