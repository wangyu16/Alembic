import {
  assertPathAllowedInRepo,
  assertPublicMarkdownReferences,
} from "@alembic/package-contract";
import type { PackageStore } from "./store";

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
  const files = await store.listFiles(packageId);
  const file = files.find((f) => f.repo === "public" && f.path === path);
  return { path, source: file?.content ?? "" };
}

/**
 * Save a chapter's authored deck source through the validated write path. The
 * deck is stored verbatim (no block-ID reconcile — decks aren't block docs), but
 * the two-repo invariant (`assertPathAllowedInRepo`, fail-closed) and the public
 * reference guard (`assertPublicMarkdownReferences`) still gate every write.
 */
export async function saveSlidesDeck(
  store: PackageStore,
  packageId: string,
  doc: SlidesDeckDoc,
): Promise<void> {
  assertPathAllowedInRepo(doc.path, "public");
  assertPublicMarkdownReferences(doc.source);
  await store.putFiles(packageId, [
    { repo: "public", path: doc.path, content: doc.source },
  ]);
}
