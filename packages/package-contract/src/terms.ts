/**
 * Current-collection term + section primitives (pure, no IO).
 *
 * The `current/` space carries the active teaching cycle. Per the POINTER MODEL
 * (docs/specs/workspace-collections.md P5, decided 2026-07-09): files live at
 * `current/<term-id>/…`; the term id is IMMUTABLE and URL-safe (it names a
 * folder); and which term is "current" vs "archived" is DERIVED from
 * `manifest.currentTerm`, never from position. A separate display label
 * (`manifest.currentTermLabel`) can be renamed freely without moving a file.
 *
 * Within a term, files divide into SECTIONS — reserved course-level folders
 * that drive the published "This term" area. Sections are a naming CONVENTION
 * over the free-folder tree, not a new path primitive: the collections
 * framework's scope/tree/write machinery is reused verbatim with
 * `current/<term-id>` as the space directory (see `currentSpaceDir`).
 */

import { PathLayerError } from "./layers";

/** Reserved course-level sections inside a term (array order = display order). */
export const CURRENT_SECTIONS = [
  "announcements",
  "assignments",
  "misc",
] as const;
export type CurrentSection = (typeof CURRENT_SECTIONS)[number];

export interface CurrentSectionMeta {
  id: CurrentSection;
  /** Educator-facing label. */
  label: string;
  /** One-line description for the section's empty state. */
  hint: string;
}

/** Section metadata, keyed by id. Educator language only (rule: never surface
 * repo/Git concepts). */
export const SECTION_META: Record<CurrentSection, CurrentSectionMeta> = {
  announcements: {
    id: "announcements",
    label: "Announcements",
    hint: "Dated notes to students — the newest shows first on the course home.",
  },
  assignments: {
    id: "assignments",
    label: "Assignments",
    hint: "Homework, labs, and handouts for this run of the course.",
  },
  misc: {
    id: "misc",
    label: "Other materials",
    hint: "Anything else specific to this term.",
  },
};

export function isCurrentSection(value: string): value is CurrentSection {
  return (CURRENT_SECTIONS as readonly string[]).includes(value);
}

/**
 * A term id is URL-safe: lowercase alphanumerics joined by single hyphens
 * (`2026-fall`, `spring2027`). It names a folder and is immutable, so it must
 * never contain a path separator, uppercase (the display label carries case),
 * or traversal.
 */
const TERM_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidTermId(termId: string): boolean {
  return TERM_ID_PATTERN.test(termId);
}

/**
 * The space directory for a term's files: `current/<term-id>`. This is the
 * `spaceDir` handed to the collection framework (listing, tree, item path).
 * Throws `PathLayerError` (fail closed) on an invalid term id — a caller must
 * validate educator input into a valid id before it reaches a path.
 */
export function currentSpaceDir(termId: string): string {
  if (!isValidTermId(termId)) {
    throw new PathLayerError(`Invalid term id: ${termId}`, termId);
  }
  return `current/${termId}`;
}

/**
 * The term id embedded in a `current/<term-id>/…` path, or null when the path
 * is not under a valid term. Pure inverse of `currentSpaceDir`. Fail-closed on
 * traversal (a `..` segment yields null, never an escape).
 */
export function termIdForPath(path: string): string | null {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) return null;
  const segments = normalized.split("/");
  if (segments[0] !== "current") return null;
  const termId = segments[1];
  if (!termId || !isValidTermId(termId)) return null;
  return termId;
}
