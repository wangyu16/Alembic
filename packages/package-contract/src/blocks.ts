/**
 * Block identity rules (package-contract primitives).
 *
 * IDs live in the plain-text orz-markdown source, are immutable, and are
 * never reused. Editing preserves the ID; replacing a block creates a new ID
 * with a provenance link. Copies into other packages get a new ID plus an
 * `adapted-from` reference.
 */

import { z } from "zod";

/**
 * Block ID format: `blk-` followed by 8+ lowercase base36 characters.
 * Generated once at block creation, then immutable.
 */
export const BLOCK_ID_PATTERN = /^blk-[a-z0-9]{8,}$/;

export const BlockIdSchema = z.string().regex(BLOCK_ID_PATTERN, {
  message: "Block IDs must match blk-<base36, 8+ chars>",
});

export type BlockId = z.infer<typeof BlockIdSchema>;

export const BlockKindSchema = z.enum([
  "section", // default unit: heading-bounded
  "figure",
  "equation",
  "structure", // chemical structure
  "question-template-item",
]);

export type BlockKind = z.infer<typeof BlockKindSchema>;

export const BlockSchema = z.object({
  id: BlockIdSchema,
  kind: BlockKindSchema,
  /** Heading text for sections; caption/label for anchored sub-elements. */
  title: z.string().min(1),
  /** orz-markdown source of the block, including its ID marker. */
  source: z.string(),
  /** Monotonic per-block revision, bumped on every content change. */
  revision: z.number().int().nonnegative(),
  /** Set when this block replaced an earlier one (new-ID rule). */
  replacesId: BlockIdSchema.optional(),
  /** Set when this block was copied from another package. */
  adaptedFrom: z
    .object({
      packageId: z.string(),
      blockId: BlockIdSchema,
      snapshot: z.string().optional(),
    })
    .optional(),
});

export type Block = z.infer<typeof BlockSchema>;

/**
 * Validate ID integrity for a block list, run on every save.
 *
 * Contract v2 (§4): block ids are OPTIONAL anchors — a section with no id is an
 * anonymous section and is legal. Validation rejects only *malformed* ids and
 * *duplicate* (non-null) ids; a null/absent id is simply skipped, never an
 * error. The parameter type is widened to `string | null` additively so
 * existing string-only callers (v1 `Block[]`) still typecheck unchanged.
 */
export function validateBlockIds(
  blocks: ReadonlyArray<{ id: string | null | undefined }>,
): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    // Anonymous section (no anchor): legal in v2, skip.
    if (block.id === null || block.id === undefined) {
      continue;
    }
    const parsed = BlockIdSchema.safeParse(block.id);
    if (!parsed.success) {
      errors.push(`Malformed block ID: "${block.id}"`);
      continue;
    }
    if (seen.has(block.id)) {
      errors.push(`Duplicate block ID: "${block.id}"`);
    }
    seen.add(block.id);
  }
  return { ok: errors.length === 0, errors };
}
