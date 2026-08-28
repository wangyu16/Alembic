/**
 * Pure preparation of a study-guide chapter's bytes for the write path.
 *
 * Under the repo-first rule (docs/specs/storage-and-write-paths.md §3) the
 * store write must happen *after* the commit, so the import action needs the
 * first half of a study-guide save on its own: mint IDs, check their integrity,
 * serialize, and hand back the exact bytes `writeThrough` will commit and
 * project.
 *
 * That half is `prepareStudyGuideBlocks` in `@alembic/package-ops` — the same
 * code `saveStudyGuide` itself is built from, so there is ONE copy of rule 7
 * (block IDs immutable, never reused): existing IDs are preserved, only missing
 * ones are minted, and a malformed/duplicated set is rejected — never repaired.
 * The path and public-reference guards are `writeThrough`'s job here, which is
 * why this uses the path-free `prepareStudyGuideBlocks` rather than the full
 * `prepareStudyGuideSave`. This module is now only the import path's local name
 * for it.
 */

export {
  prepareStudyGuideBlocks as prepareStudyGuide,
  type PreparedStudyGuideBlocks as PreparedStudyGuide,
} from "@alembic/package-ops";
