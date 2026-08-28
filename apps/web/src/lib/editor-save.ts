/**
 * Editor-save preparation — the VALIDATION half of an editor save, separated
 * from persistence.
 *
 * Why this module exists (docs/specs/storage-and-write-paths.md §3): the write
 * ordering for a published package is
 *
 *   validate → commit to GitHub → project into the store
 *
 * The pre-existing package-ops entry points (`applyEditorEdit`,
 * `saveStudyGuide`, `saveSlidesDeck`) fuse validation AND the store write into
 * one call, so calling them first would project *before* the commit — exactly
 * the ordering the spec forbids. These helpers perform the identical
 * validations and return the final bytes; the action then persists them through
 * `writeThrough`, which commits first and projects only from a successful
 * commit.
 *
 * Everything here is pure (no IO, no Supabase, no GitHub) so it is unit
 * testable — server actions themselves are not.
 *
 * **Parity contract:** the checks below mirror
 * `packages/package-ops/src/editor-edit.ts`, `study-guide.ts` (`saveStudyGuide`)
 * and `slides.ts` (`saveSlidesDeck`). If those gain a check, add it here too.
 * The clean end-state is a validate-only export in package-ops that both sides
 * share (reported as follow-up by T12).
 */

import {
  assertPathAllowedInEitherContract,
  assertPathAllowedInRepo,
  assertPublicMarkdownReferences,
  newBlockId,
  parseStudyGuide,
  serializeStudyGuide,
  validateBlockIds,
  type RepoKind,
  type StudyGuideBlock,
} from "@alembic/package-contract";
import {
  CommitFailedError,
  CommitUnavailableError,
} from "@alembic/package-ops";

/** Study-guide markdown gets the block-ID treatment; mirrors `editor-edit.ts`. */
const STUDY_GUIDE_PREFIX = "study-guide/";

/** Public text carriers that can embed repo-relative references; mirrors
 *  `editor-edit.ts` and `write-through.ts` — keep the three in sync. */
const TEXT_EXT = /\.(md|md\.html|html|svg)$/;

/**
 * A validated, ready-to-persist change. The content is FINAL (study guides are
 * already re-serialized canonically), so the commit and the projection are
 * guaranteed to be byte-identical.
 */
export interface PreparedWrite {
  repo: RepoKind;
  path: string;
  content: string;
}

/**
 * The educator asked for something the contract refuses (a private reference in
 * public content, a path in the wrong repo, broken section identifiers).
 * Retrying the same content cannot help — that is what `retryable: false` says
 * to the UI, in contrast with a commit failure.
 */
export class EditorSaveValidationError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "EditorSaveValidationError";
  }
}

/** Educator-facing copy. No Git vocabulary, no raw error text (CLAUDE.md). */
const BLOCK_ID_MESSAGE =
  "Some sections have invalid or duplicate identifiers and could not be saved.";
const CONTRACT_MESSAGE =
  "Couldn't save. Check that nothing references a private file.";
const GENERIC_MESSAGE = "Your changes could not be saved. Please try again.";

/**
 * Validate and canonicalize a study-guide chapter — the same four steps
 * `saveStudyGuide` performs before its `putFiles`: mint IDs for new blocks,
 * reject (never repair) broken IDs, check the path against the layer contract,
 * serialize, and fail closed on any private reference.
 *
 * Returns the blocks with their assigned IDs so a caller can sync client state.
 */
export function prepareStudyGuideSave(
  path: string,
  preamble: string,
  inputBlocks: StudyGuideBlock[],
): { write: PreparedWrite; blocks: StudyGuideBlock[] } {
  const blocks: StudyGuideBlock[] = inputBlocks.map((b) => ({
    ...b,
    id: b.id ?? newBlockId(),
  }));

  const integrity = validateBlockIds(blocks.map((b) => ({ id: b.id! })));
  if (!integrity.ok) throw new EditorSaveValidationError(BLOCK_ID_MESSAGE);

  try {
    assertPathAllowedInRepo(path, "public");
  } catch {
    throw new EditorSaveValidationError(CONTRACT_MESSAGE);
  }

  const content = serializeStudyGuide(preamble, blocks);
  try {
    assertPublicMarkdownReferences(content);
  } catch {
    throw new EditorSaveValidationError(CONTRACT_MESSAGE);
  }

  return { write: { repo: "public", path, content }, blocks };
}

/**
 * Validate an authored slide deck — the two gates `saveSlidesDeck` applies
 * (two-repo invariant + public reference guard). The deck source is stored
 * verbatim; decks have no block-ID model.
 */
export function prepareSlidesSave(path: string, source: string): PreparedWrite {
  try {
    assertPathAllowedInRepo(path, "public");
    assertPublicMarkdownReferences(source);
  } catch {
    throw new EditorSaveValidationError(CONTRACT_MESSAGE);
  }
  return { repo: "public", path, content: source };
}

/**
 * Validate a generic editor save — the routing `applyEditorEdit` performs:
 * study-guide markdown gets block-ID integrity via `prepareStudyGuideSave`;
 * other public text carriers get the reference scan; private files are
 * validated by path only. Fail-closed on any path/repo mismatch.
 */
export function prepareEditorSave(edit: {
  path: string;
  repo: RepoKind;
  source: string;
}): PreparedWrite {
  try {
    assertPathAllowedInEitherContract(edit.path, edit.repo);
  } catch {
    throw new EditorSaveValidationError(CONTRACT_MESSAGE);
  }

  if (edit.repo === "public" && edit.path.startsWith(STUDY_GUIDE_PREFIX)) {
    const parsed = parseStudyGuide(edit.source);
    return prepareStudyGuideSave(edit.path, parsed.preamble, parsed.blocks).write;
  }

  if (edit.repo === "public" && TEXT_EXT.test(edit.path)) {
    try {
      assertPublicMarkdownReferences(edit.source);
    } catch {
      throw new EditorSaveValidationError(CONTRACT_MESSAGE);
    }
  }

  return { repo: edit.repo, path: edit.path, content: edit.source };
}

/**
 * Turn any save failure into what the UI needs: an educator-facing sentence and
 * whether pressing Save again could plausibly succeed.
 *
 * - contract/validation failures: not retryable — the content must change;
 * - commit unavailable / commit failed: retryable, and the typed error's own
 *   message already explains that nothing was changed;
 * - anything else: the generic retry message. Raw error text never escapes.
 */
export function saveFailureMessage(err: unknown): {
  message: string;
  retryable: boolean;
} {
  if (err instanceof EditorSaveValidationError) {
    return { message: err.message, retryable: false };
  }
  if (err instanceof CommitUnavailableError || err instanceof CommitFailedError) {
    return { message: err.message, retryable: true };
  }
  return { message: GENERIC_MESSAGE, retryable: true };
}

/**
 * The "your text isn't a section yet" note (moved here from
 * `saveStudyGuideAction` so the hosted editor keeps saying it). A section only
 * exists under a `## Heading`; text typed above the first `##` saves fine but
 * becomes preamble and silently doesn't count as study-guide content at publish
 * time. Non-fatal: the save succeeded.
 */
export function studyGuideHeadingWarning(
  preamble: string,
  blocks: StudyGuideBlock[],
): string | undefined {
  if (blocks.length > 0 || !preamble.trim()) return undefined;
  return 'Saved — but this needs a "## Heading" line above your text to count as a section. A single "#" is reserved for the page title; add "##" (or a lower level) before your first section.';
}
