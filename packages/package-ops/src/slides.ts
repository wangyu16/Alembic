import {
  assertPathAllowedInRepo,
  assertPublicMarkdownReferences,
} from "@alembic/package-contract";
import type { PackageFile, PackageStore } from "./store";

/* -------------------------------------------------------------------------- *
 * Authored slide decks (the `slides` space).
 *
 * A deck is a first-class per-chapter document whose committed source of
 * record is the orz-slides deck markdown at `slides/<slug>.md`. It starts
 * from a minimal scaffold on first open, then is authored independently
 * through the hosted `.slides.html` framework — the same lifecycle as the
 * study guide and practice, but the source is a deck (no block-ID model).
 * The self-contained `.slides.html` is generated on demand as the editing
 * surface / published view, never committed.
 * -------------------------------------------------------------------------- */

/** Repo path for a chapter's authored slide deck (its study-guide file stem). */
export function chapterSlidesPath(slug: string): string {
  return `slides/${slug}.md`;
}

export interface SlidesDeckDoc {
  path: string;
  /** orz-slides deck source (markdown, slides split by `<!-- slide -->`). */
  source: string;
}

/** Load a chapter's authored deck source (empty string when none exists yet). */
export async function loadSlidesDeck(
  store: PackageStore,
  packageId: string,
  path: string,
): Promise<SlidesDeckDoc> {
  // ONE row (see loadStudyGuide): opening a deck must not read the package.
  const content = await store.readFile(packageId, "public", path);
  return { path, source: content ?? "" };
}

/**
 * Validation half of `saveSlidesDeck` — the two gates every deck write passes:
 * the two-repo invariant (`assertPathAllowedInRepo`, fail-closed) and the
 * public reference guard (`assertPublicMarkdownReferences`). The deck is stored
 * verbatim (no block-ID reconcile — decks aren't block docs). Pure: returns the
 * exact bytes to write and touches no store.
 */
export function prepareSlidesSave(doc: SlidesDeckDoc): PackageFile {
  assertPathAllowedInRepo(doc.path, "public");
  assertPublicMarkdownReferences(doc.source);
  return { repo: "public", path: doc.path, content: doc.source };
}

/**
 * Save a chapter's authored deck source through the validated write path:
 * `prepareSlidesSave` followed by the store write.
 */
export async function saveSlidesDeck(
  store: PackageStore,
  packageId: string,
  doc: SlidesDeckDoc,
): Promise<void> {
  await store.putFiles(packageId, [prepareSlidesSave(doc)]);
}
