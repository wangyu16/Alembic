/**
 * Pure preparation of a study-guide chapter's bytes for the write path.
 *
 * `saveStudyGuide` (package-ops) mints IDs, checks their integrity and
 * serializes — and then writes to the store itself. Under the repo-first rule
 * (docs/specs/storage-and-write-paths.md §3) the store write must happen
 * *after* the commit, so the import action needs the first half on its own:
 * this helper does the minting/validation/serialization and hands back the
 * exact bytes `writeThrough` will commit and project.
 *
 * Rule 7 (block IDs immutable, never reused) is enforced here, before any IO,
 * exactly as `saveStudyGuide` does: existing IDs are preserved, only missing
 * ones are minted, and a malformed/duplicated set is rejected — never repaired.
 * The path and public-reference guards are `writeThrough`'s job.
 */

import {
  newBlockId,
  serializeStudyGuide,
  validateBlockIds,
  type StudyGuideBlock,
} from "@alembic/package-contract";
import { BlockIdIntegrityError } from "@alembic/package-ops";

export interface PreparedStudyGuide {
  /** The blocks with IDs assigned, so the caller can report/sync its state. */
  blocks: StudyGuideBlock[];
  /** Canonical serialized source — the bytes to commit and to project. */
  content: string;
}

/**
 * Mint IDs for new blocks, verify ID integrity, and serialize.
 * Throws `BlockIdIntegrityError` when the IDs are malformed or duplicated.
 */
export function prepareStudyGuide(doc: {
  preamble: string;
  blocks: StudyGuideBlock[];
}): PreparedStudyGuide {
  const blocks: StudyGuideBlock[] = doc.blocks.map((b) => ({
    ...b,
    id: b.id ?? newBlockId(),
  }));

  const integrity = validateBlockIds(blocks.map((b) => ({ id: b.id! })));
  if (!integrity.ok) throw new BlockIdIntegrityError(integrity.errors);

  return { blocks, content: serializeStudyGuide(doc.preamble, blocks) };
}
