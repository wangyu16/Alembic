import {
  assertPathAllowedInRepo,
  assertPublicMarkdownReferences,
  newBlockId,
  parseStudyGuide,
  serializeStudyGuide,
  validateBlockIds,
  type StudyGuideBlock,
} from "@alembic/package-contract";
import type { PackageStore } from "./store";

/**
 * Repo path for a chapter's study guide. One chapter == one file == one
 * student webpage. Centralizes the convention so multi-chapter courses are an
 * additive extension (see docs/specs/course-structure.md); v0.1 uses a single
 * chapter via DEFAULT_STUDY_GUIDE_PATH.
 */
export function chapterStudyGuidePath(slug: string): string {
  return `study-guide/${slug}.md`;
}

/** Repo path for a chapter's practice-questions document (the `practice` space).
 *  Sibling of the chapter's study guide; same block-structured markdown, edited
 *  through the same hosted `.md.html` framework. */
export function chapterPracticePath(slug: string): string {
  return `practice/${slug}.md`;
}

/** Default single-chapter study-guide path for v0.1 packages. */
export const DEFAULT_STUDY_GUIDE_PATH =
  chapterStudyGuidePath("01-getting-started");

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
  // Fail closed if the content references a private file (two-repo invariant).
  // This is the chokepoint for human edits, AI edits, and the coherence agent.
  assertPublicMarkdownReferences(content);
  await store.putFiles(packageId, [
    { repo: "public", path: doc.path, content },
  ]);

  return { blocks };
}
