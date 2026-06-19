/**
 * Proposed change sets — the typed output of the Tier-B coherence agent
 * (Roadmap Phase 3, goal.md §3 "Agent Harness").
 *
 * The agent is a *producer of reviewed changes*, never a writer: it emits a
 * `ProposedChangeSet` (block-level patches + an educator-facing explanation) as
 * pure typed data. That data flows into the existing Tier-2 review queue
 * (`coherence-edit` change kind); on accept, the operations are applied through
 * `packageOps` — the one validated write path — so block-ID integrity and the
 * two-repo invariant hold exactly as for human edits. Nothing here renders HTML
 * or touches IO (forward-compatibility.md: durable artifacts carry typed data).
 *
 * Versioned and additive: bump `PROPOSED_CHANGE_SET_VERSION` and migrate
 * forward; never break old proposals.
 */

import { z } from "zod";
import { BlockIdSchema } from "./blocks";

/** Schema version for the proposal envelope (additive, forward-only). */
export const PROPOSED_CHANGE_SET_VERSION = 1;

/**
 * The operations the coherence agent may propose. Deliberately small and
 * non-destructive in v1:
 *   - `update-block`   edit an existing block's title/body (ID preserved).
 *   - `create-block`   add a new block (ID minted on accept, never by the agent).
 *   - `reorder-blocks` reorder a chapter's blocks (no content change).
 * Block *deletion* is intentionally excluded — it is higher-stakes and stays a
 * deliberate human action, not an agent suggestion.
 */
export const PROPOSAL_OP_KINDS = [
  "update-block",
  "create-block",
  "reorder-blocks",
] as const;

export type ProposalOpKind = (typeof PROPOSAL_OP_KINDS)[number];

const RationaleSchema = z
  .string()
  .min(1, { message: "Every proposed operation needs an educator-facing rationale." });

export const UpdateBlockOpSchema = z.object({
  op: z.literal("update-block"),
  chapterSlug: z.string().min(1),
  /** Must reference an existing, immutable block ID. */
  blockId: BlockIdSchema,
  /** New heading text, when the title changes. */
  title: z.string().min(1).optional(),
  /** New markdown body, when the content changes. */
  body: z.string().optional(),
  rationale: RationaleSchema,
});

export const CreateBlockOpSchema = z.object({
  op: z.literal("create-block"),
  chapterSlug: z.string().min(1),
  /** Insert after this block; `null` prepends. References an existing ID. */
  afterBlockId: BlockIdSchema.nullable(),
  title: z.string().min(1),
  body: z.string(),
  rationale: RationaleSchema,
});

export const ReorderBlocksOpSchema = z.object({
  op: z.literal("reorder-blocks"),
  chapterSlug: z.string().min(1),
  /** The chapter's block IDs in their proposed new order. */
  orderedBlockIds: z.array(BlockIdSchema).min(1),
  rationale: RationaleSchema,
});

export const ProposalOpSchema = z.discriminatedUnion("op", [
  UpdateBlockOpSchema,
  CreateBlockOpSchema,
  ReorderBlocksOpSchema,
]);

export type UpdateBlockOp = z.infer<typeof UpdateBlockOpSchema>;
export type CreateBlockOp = z.infer<typeof CreateBlockOpSchema>;
export type ReorderBlocksOp = z.infer<typeof ReorderBlocksOpSchema>;
export type ProposalOp = z.infer<typeof ProposalOpSchema>;

/**
 * Coherence finding categories — advisory, not enforced (teaching docs have no
 * hard oracle; see ai-architecture.md). Surfaced to the educator alongside the
 * proposed operations.
 */
export const COHERENCE_FINDING_KINDS = [
  "terminology", // same concept named inconsistently across modules
  "symbols", // a symbol/notation/unit used inconsistently (e.g. ΔH vs dH, mol vs mole)
  "narrative-drift", // content has drifted from the planned concept-map/objective structure
  "objective-coverage", // an objective with no supporting content (or vice versa)
  "cross-reference", // a reference to a missing/renamed section
  "stale-artifact", // a derived artifact out of sync with its source blocks
  "ordering", // prerequisite/sequence problem
  "other",
] as const;

export type CoherenceFindingKind = (typeof COHERENCE_FINDING_KINDS)[number];

export const CoherenceFindingSchema = z.object({
  kind: z.enum(COHERENCE_FINDING_KINDS),
  /** Educator-facing description of the issue. */
  summary: z.string().min(1),
  /** Where in the course the finding applies. */
  locations: z
    .array(
      z.object({
        chapterSlug: z.string().min(1),
        blockId: BlockIdSchema.optional(),
      }),
    )
    .default([]),
});

export type CoherenceFinding = z.infer<typeof CoherenceFindingSchema>;

export const ProposedChangeSetSchema = z.object({
  version: z.literal(PROPOSED_CHANGE_SET_VERSION),
  /** What the educator asked the agent to do. */
  task: z.string().min(1),
  /** Overall educator-facing explanation of the proposed changes. */
  summary: z.string().min(1),
  findings: z.array(CoherenceFindingSchema).default([]),
  operations: z.array(ProposalOpSchema).default([]),
});

export type ProposedChangeSet = z.infer<typeof ProposedChangeSetSchema>;

export interface ValidateProposalContext {
  /** Existing immutable block IDs, keyed by chapter slug. */
  blockIdsByChapter: Record<string, ReadonlyArray<string>>;
}

/**
 * Validate a proposed change set against the live package, BEFORE it enters the
 * review queue. Enforces the block-identity invariant (CLAUDE.md rule 7):
 *   - `update-block` / `reorder-blocks` may only reference IDs that exist.
 *   - `reorder-blocks` must list each of the chapter's blocks exactly once
 *     (a reorder neither adds nor drops blocks).
 *   - `create-block.afterBlockId` (when set) must reference an existing ID.
 * The agent never mints or reuses IDs — new blocks get a fresh ID on accept.
 *
 * Returns collected issues; an empty list means the set is safe to queue.
 */
export function validateProposedChangeSet(
  set: ProposedChangeSet,
  ctx: ValidateProposalContext,
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const known = (slug: string): Set<string> =>
    new Set(ctx.blockIdsByChapter[slug] ?? []);

  set.operations.forEach((op, i) => {
    const where = `operation ${i + 1} (${op.op})`;
    const ids = known(op.chapterSlug);
    if (!(op.chapterSlug in ctx.blockIdsByChapter)) {
      issues.push(`${where}: unknown chapter "${op.chapterSlug}".`);
      return;
    }

    if (op.op === "update-block") {
      if (!ids.has(op.blockId)) {
        issues.push(`${where}: references missing block "${op.blockId}".`);
      }
      if (op.title === undefined && op.body === undefined) {
        issues.push(`${where}: changes nothing (no title or body).`);
      }
    } else if (op.op === "create-block") {
      if (op.afterBlockId !== null && !ids.has(op.afterBlockId)) {
        issues.push(`${where}: inserts after missing block "${op.afterBlockId}".`);
      }
    } else {
      // reorder-blocks: must be a permutation of the chapter's blocks.
      const seen = new Set<string>();
      for (const id of op.orderedBlockIds) {
        if (!ids.has(id)) {
          issues.push(`${where}: reorders unknown block "${id}".`);
        }
        if (seen.has(id)) {
          issues.push(`${where}: lists block "${id}" more than once.`);
        }
        seen.add(id);
      }
      for (const id of ids) {
        if (!seen.has(id)) {
          issues.push(`${where}: omits existing block "${id}".`);
        }
      }
    }
  });

  return { ok: issues.length === 0, issues };
}
