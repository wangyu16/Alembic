/**
 * Editor-save preparation — the web-facing skin over package-ops' validate-only
 * `prepare*` exports.
 *
 * Why a separation exists at all (docs/specs/storage-and-write-paths.md §3):
 * the write ordering for a published package is
 *
 *   validate → commit to GitHub → project into the store
 *
 * so the validation half has to be callable on its own. That half now lives
 * exactly ONCE, in `@alembic/package-ops` (`prepareStudyGuideSave`,
 * `prepareSlidesSave`, `prepareEditorEdit`), which is also what the persisting
 * `saveStudyGuide` / `saveSlidesDeck` / `applyEditorEdit` are built from — one
 * validated write path, one copy of its validator (CLAUDE.md rule 3). This
 * module no longer re-implements a single check; it only translates the typed
 * failures into educator-facing sentences and carries the two UI-only helpers
 * (`saveFailureMessage`, `studyGuideHeadingWarning`).
 *
 * Everything here is pure (no IO, no Supabase, no GitHub) so it is unit
 * testable — server actions themselves are not.
 */

import type { RepoKind, StudyGuideBlock } from "@alembic/package-contract";
import {
  BlockIdIntegrityError,
  CommitFailedError,
  CommitUnavailableError,
  prepareEditorEdit,
  prepareSlidesSave as prepareSlidesFile,
  prepareStudyGuideSave as prepareStudyGuideFile,
} from "@alembic/package-ops";

/**
 * A validated, ready-to-persist change. The content is FINAL (study guides are
 * already re-serialized canonically), so the commit and the projection are
 * guaranteed to be byte-identical. Structurally the package-ops `PackageFile`.
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
 * Run a package-ops `prepare*` and restate its refusal in educator language:
 * a block-ID integrity failure gets the identifier sentence, every other
 * contract refusal gets the private-reference sentence. Raw error text never
 * escapes.
 */
function refuseInPlainLanguage<T>(prepare: () => T): T {
  try {
    return prepare();
  } catch (e) {
    throw new EditorSaveValidationError(
      e instanceof BlockIdIntegrityError ? BLOCK_ID_MESSAGE : CONTRACT_MESSAGE,
    );
  }
}

/**
 * Validate and canonicalize a study-guide chapter — `prepareStudyGuideSave`
 * from package-ops: mint IDs for new blocks, reject (never repair) broken IDs,
 * check the path against the layer contract, serialize, and fail closed on any
 * private reference.
 *
 * Returns the blocks with their assigned IDs so a caller can sync client state.
 */
export function prepareStudyGuideSave(
  path: string,
  preamble: string,
  inputBlocks: StudyGuideBlock[],
): { write: PreparedWrite; blocks: StudyGuideBlock[] } {
  const { file, blocks } = refuseInPlainLanguage(() =>
    prepareStudyGuideFile({ path, preamble, blocks: inputBlocks }),
  );
  return { write: file, blocks };
}

/**
 * Validate an authored slide deck — `prepareSlidesSave` from package-ops (the
 * two-repo invariant + the public reference guard). The deck source is stored
 * verbatim; decks have no block-ID model.
 */
export function prepareSlidesSave(path: string, source: string): PreparedWrite {
  return refuseInPlainLanguage(() => prepareSlidesFile({ path, source }));
}

/**
 * Validate a generic editor save — `prepareEditorEdit` from package-ops:
 * study-guide markdown gets block-ID integrity, other public text carriers get
 * the reference scan, private files are validated by path only. Fail-closed on
 * any path/repo mismatch.
 */
export function prepareEditorSave(edit: {
  path: string;
  repo: RepoKind;
  source: string;
}): PreparedWrite {
  return refuseInPlainLanguage(() => prepareEditorEdit(edit));
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
