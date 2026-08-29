import {
  assertPathAllowedInRepo,
  assertPublicMarkdownReferences,
  newBlockId,
  parseStudyGuide,
  serializeStudyGuide,
  validateBlockIds,
  type StudyGuideBlock,
} from "@alembic/package-contract";
import type { PackageFile, PackageStore } from "./store";

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
  // ONE row. This runs every time a document is opened, and reading the whole
  // package to find a single file is what made a real course feel slow.
  const content = await store.readFile(packageId, "public", path);
  if (content === null) {
    return { path, preamble: "", blocks: [] };
  }
  const parsed = parseStudyGuide(content);
  return { path, preamble: parsed.preamble, blocks: parsed.blocks };
}

export class BlockIdIntegrityError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Block ID integrity check failed: ${errors.join("; ")}`);
    this.name = "BlockIdIntegrityError";
  }
}

/* -------------------------------------------------------------------------- *
 * prepare (validate-only) / persist split
 *
 * Under the repo-first write path (docs/specs/storage-and-write-paths.md §3) a
 * published package must COMMIT before it projects, so every writer needs the
 * validation half on its own: `prepare*` computes the exact bytes and performs
 * every check, touching no store; the `save*`/`apply*` functions below are
 * literally `prepare + putFiles`, so their behaviour is unchanged.
 *
 * `prepare*` takes the caller's in-memory document, never a re-read of the
 * store, so several edits can be staged onto one file in order (the batch
 * accept path relies on exactly that).
 * -------------------------------------------------------------------------- */

export interface PreparedStudyGuideBlocks {
  /** The blocks with IDs assigned, so the caller can sync its state. */
  blocks: StudyGuideBlock[];
  /** Canonical serialized source — the bytes to commit and to project. */
  content: string;
}

/**
 * Steps 1–2 (+ serialize) of a study-guide save, with no path knowledge: mint
 * IDs for new blocks (editing preserves existing IDs), validate ID integrity
 * (well-formed, no duplicates) — reject, never repair — then serialize to
 * canonical source. Pure.
 */
export function prepareStudyGuideBlocks(doc: {
  preamble: string;
  blocks: StudyGuideBlock[];
}): PreparedStudyGuideBlocks {
  const blocks: StudyGuideBlock[] = doc.blocks.map((b) => ({
    ...b,
    id: b.id ?? newBlockId(),
  }));

  const integrity = validateBlockIds(blocks.map((b) => ({ id: b.id! })));
  if (!integrity.ok) {
    throw new BlockIdIntegrityError(integrity.errors);
  }

  return { blocks, content: serializeStudyGuide(doc.preamble, blocks) };
}

export interface PreparedStudyGuideSave {
  /** The one file to write — already validated, content FINAL. */
  file: PackageFile;
  blocks: StudyGuideBlock[];
}

/**
 * The full validation half of `saveStudyGuide`, in the same order:
 *  1. mint IDs for new blocks (editing preserves existing IDs);
 *  2. validate ID integrity (well-formed, no duplicates) — reject, never repair;
 *  3. validate the path against the layer contract;
 *  4. serialize to canonical source and fail closed on any private reference.
 * Writes nothing. Pure.
 */
export function prepareStudyGuideSave(
  doc: StudyGuideDoc,
): PreparedStudyGuideSave {
  const { blocks, content } = prepareStudyGuideBlocks(doc);

  assertPathAllowedInRepo(doc.path, "public");

  // Fail closed if the content references a private file (two-repo invariant).
  // This is the chokepoint for human edits, AI edits, and the coherence agent.
  assertPublicMarkdownReferences(content);

  return { file: { repo: "public", path: doc.path, content }, blocks };
}

/**
 * Save a study-guide chapter: `prepareStudyGuideSave` (mint → integrity →
 * path → serialize → reference guard) followed by the store write.
 * Returns the blocks with assigned IDs so the caller can sync its state.
 */
export async function saveStudyGuide(
  store: PackageStore,
  packageId: string,
  doc: StudyGuideDoc,
): Promise<{ blocks: StudyGuideBlock[] }> {
  const { file, blocks } = prepareStudyGuideSave(doc);
  await store.putFiles(packageId, [file]);
  return { blocks };
}
