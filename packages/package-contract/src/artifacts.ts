/**
 * Derived-artifact records (generate-then-own with drift tracking).
 *
 * A derived artifact (v0.1: worksheets) records which study-guide blocks — and
 * which version of each, by content hash — it was generated from. Staleness is
 * computed by comparing recorded hashes against current block hashes; it is
 * never guessed from content diffing. See docs/specs/package-contract-v1.md §8.
 */

import { z } from "zod";
import { BlockIdSchema } from "./blocks";
import type { StudyGuideBlock } from "./block-source";

export const ARTIFACT_ID_PATTERN = /^art-[a-z0-9]{8,}$/;

export const DerivedArtifactKindSchema = z.enum(["worksheet", "slides"]);
export type DerivedArtifactKind = z.infer<typeof DerivedArtifactKindSchema>;

/** A study-guide block this artifact was generated from, with its version. */
export const ArtifactSourceRefSchema = z.object({
  blockId: BlockIdSchema,
  /** Block content hash at generation time (see hashBlockContent). */
  contentHash: z.string().min(1),
});
export type ArtifactSourceRef = z.infer<typeof ArtifactSourceRefSchema>;

export const DerivedArtifactRecordSchema = z.object({
  artifactId: z.string().regex(ARTIFACT_ID_PATTERN),
  kind: DerivedArtifactKindSchema,
  /** Repository-relative path of the artifact file (public `materials/`). */
  path: z.string().min(1),
  title: z.string().min(1),
  sourceBlocks: z.array(ArtifactSourceRefSchema),
  /**
   * `fresh` — in sync (or just generated).
   * `divergent` — educator chose "keep mine"; stop flagging it stale.
   * Staleness itself is computed at read time, not stored here.
   */
  status: z.enum(["fresh", "divergent"]).default("fresh"),
  generatedAt: z.iso.datetime(),
  /** When the educator chose "keep mine" on a stale flag (status divergent). */
  divergedAt: z.iso.datetime().optional(),
});
export type DerivedArtifactRecord = z.infer<typeof DerivedArtifactRecordSchema>;

/** Deterministic, pure content hash (FNV-1a, 32-bit hex). */
export function hashContent(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime multiply, kept in 32-bit range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Content hash for a study-guide block (title + body). */
export function hashBlockContent(
  block: Pick<StudyGuideBlock, "title" | "body">,
): string {
  return hashContent(`${block.title}\n\n${block.body}`);
}

const BASE36 = "abcdefghijklmnopqrstuvwxyz0123456789";

/** New derived-artifact ID: `art-` + 10 base36 chars. */
export function newArtifactId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  let out = "art-";
  for (const byte of bytes) out += BASE36[byte % 36];
  return out;
}

/** Path of an artifact's record file under the platform-bookkeeping dir. */
export function artifactRecordPath(artifactId: string): string {
  return `.alembic/artifacts/${artifactId}.json`;
}
