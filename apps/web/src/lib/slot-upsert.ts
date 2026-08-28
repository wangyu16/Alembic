/**
 * Replace's placement decision — "slots, not placeholders"
 * (docs/specs/storage-and-write-paths.md §4).
 *
 * The five per-chapter documents are declared SLOTS: a file exists at the
 * slot's canonical path iff real content exists. Two consequences for the
 * Replace door, both decided here:
 *
 *  1. **Upsert into the slot.** Replacing a chapter document that has no file
 *     yet must WORK (acceptance C4) — an educator who never opened chapter 3's
 *     slides can still upload them. Anything that is not a slot (assets,
 *     private files, term files) keeps replace-only semantics: creating an
 *     arbitrary new path through the Replace door is not the goal.
 *  2. **Any filename lands right** (acceptance C5). The bytes are written to
 *     the slot's CANONICAL path, whatever the picked file was called
 *     (`my-energy-slides.md` → `slides/03-energy.md`), and the educator is
 *     told where it went — it must never silently disappear or land somewhere
 *     unexpected. Because the canonical path is stable, the registry's
 *     location match keeps the same docId: the permalink promise ("its share
 *     link stays the same") survives the round-trip.
 *
 * Pure: path/vocabulary decisions and message wording only. No IO, no React.
 * The action (`collection-actions.ts`) owns validation, the write-through and
 * the projection; it asks this module only *where* and *what to say*.
 */

import {
  CHAPTER_SLOT_SPECS,
  slotForPath,
  slotPath,
  type ChapterSlot,
} from "@alembic/package-contract";

export interface ReplaceTarget {
  /** The path the bytes will be written to — canonical for a slot. */
  path: string;
  /**
   * `upsert` — a declared chapter document slot: create-or-replace.
   * `replace-only` — everything else: the file must already exist.
   */
  mode: "upsert" | "replace-only";
  /** The slot occupied, or null for a non-slot path. */
  slot: ChapterSlot | null;
  /** The chapter the slot belongs to, or null for a non-slot path. */
  chapterSlug: string | null;
  /** True when the picked file's name differs from the canonical filename. */
  renamed: boolean;
}

/** Basename of a repo-relative path. */
function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Where a Replace should write, and under which semantics.
 *
 * `requestedPath` is the document's path as the UI knows it (already the
 * canonical path for a chapter document — this recomputes it from the
 * contract rather than trusting the caller, so a drifted caller cannot write
 * a chapter document anywhere but its slot). `pickedFilename` is the name of
 * the file the educator chose, used only to decide whether they need to be
 * told the content was renamed into place.
 */
export function resolveReplaceTarget(
  requestedPath: string,
  pickedFilename?: string,
): ReplaceTarget {
  const clean = requestedPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const found = slotForPath(clean);
  if (!found) {
    return {
      path: clean,
      mode: "replace-only",
      slot: null,
      chapterSlug: null,
      renamed: false,
    };
  }
  const canonical = slotPath(found.slot, found.chapterSlug);
  const picked = pickedFilename ? baseName(pickedFilename.replace(/\\/g, "/")) : undefined;
  return {
    path: canonical,
    mode: "upsert",
    slot: found.slot,
    chapterSlug: found.chapterSlug,
    renamed: picked !== undefined && picked !== baseName(canonical),
  };
}

/**
 * The educator-facing confirmation of WHERE the content landed, or null when
 * there is nothing surprising to report (a same-named replacement of a file
 * that was already there, or a non-slot file that stayed put).
 *
 * Named by the chapter's own title when we have it, by its name otherwise.
 * Never a path, never a filename, never Git vocabulary.
 */
export function placementNote(args: {
  target: ReplaceTarget;
  /** True when no file existed at the slot before this write. */
  created: boolean;
  /** The chapter's educator-given title, when known. */
  chapterTitle?: string | null;
}): string | null {
  const { target, created, chapterTitle } = args;
  if (target.mode !== "upsert" || !target.slot || !target.chapterSlug) return null;
  if (!created && !target.renamed) return null;

  const label = CHAPTER_SLOT_SPECS[target.slot].label.toLowerCase();
  const where = chapterTitle?.trim()
    ? `“${chapterTitle.trim()}”`
    : `chapter “${target.chapterSlug}”`;
  return `Saved as the ${label} for ${where}.`;
}
