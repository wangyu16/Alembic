import {
  assertPathAllowedInRepo,
  newBlockId,
  parseStudyGuide,
  serializeStudyGuide,
  validateBlockIds,
  type StudyGuideBlock,
} from "@alembic/package-contract";
import type { PackageStore } from "./store";

/** Default single-chapter study-guide path for v0.1 packages. */
export const DEFAULT_STUDY_GUIDE_PATH = "study-guide/01-getting-started.md";

export interface StudyGuideDoc {
  path: string;
  preamble: string;
  blocks: StudyGuideBlock[];
}

/** Load and parse a study-guide chapter into editable blocks. */
export async function loadStudyGuide(
  store: PackageStore,
  packageId: string,
  path: string = DEFAULT_STUDY_GUIDE_PATH,
): Promise<StudyGuideDoc> {
  const files = await store.listFiles(packageId);
  const file = files.find((f) => f.repo === "public" && f.path === path);
  if (!file) {
    return { path, preamble: "", blocks: [] };
  }
  const parsed = parseStudyGuide(file.content);
  return { path, preamble: parsed.preamble, blocks: parsed.blocks };
}

export class BlockIdIntegrityError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Block ID integrity check failed: ${errors.join("; ")}`);
    this.name = "BlockIdIntegrityError";
  }
}

/**
 * Save a study-guide chapter:
 *  1. mint IDs for new blocks (editing preserves existing IDs);
 *  2. validate ID integrity (well-formed, no duplicates) — reject, never repair;
 *  3. validate the path against the layer contract;
 *  4. serialize to canonical source and persist.
 * Returns the blocks with assigned IDs so the caller can sync its state.
 */
export async function saveStudyGuide(
  store: PackageStore,
  packageId: string,
  doc: StudyGuideDoc,
): Promise<{ blocks: StudyGuideBlock[] }> {
  const blocks: StudyGuideBlock[] = doc.blocks.map((b) => ({
    ...b,
    id: b.id ?? newBlockId(),
  }));

  const integrity = validateBlockIds(blocks.map((b) => ({ id: b.id! })));
  if (!integrity.ok) {
    throw new BlockIdIntegrityError(integrity.errors);
  }

  assertPathAllowedInRepo(doc.path, "public");

  const content = serializeStudyGuide(doc.preamble, blocks);
  await store.putFiles(packageId, [
    { repo: "public", path: doc.path, content },
  ]);

  return { blocks };
}
