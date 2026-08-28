/**
 * Chapter document SLOTS — "slots, not placeholders"
 * (docs/specs/storage-and-write-paths.md §4; docs/specs/document-model.md §2).
 *
 * A chapter has exactly five documents: concept map, study guide, slides,
 * assessment guide, practice questions. Each is a **declared slot** — a
 * position in the chapter, rendered from the manifest — not a seeded file.
 * A file exists at a slot's canonical path **iff real content exists**:
 * no placeholder commits, no first-open lazy scaffolds, no welcome prose in
 * committed files (empty-state guidance belongs to the UI). Consequently
 * "pristine" means *no content files*, and Replace is an upsert into the
 * slot — any picked filename normalizes to `slotPath(slot, chapterSlug)`.
 *
 * This module is purely declarative: the slot set, its metadata table, and
 * an exact path ⇄ slot bijection. No IO, no framework imports, no behavior.
 *
 * Canonical paths match the builders already in use, so this contract
 * describes existing packages rather than proposing new locations:
 *   - `study-guide/<slug>.md`        (package-ops `chapterStudyGuidePath`)
 *   - `practice/<slug>.md`           (package-ops `chapterPracticePath`)
 *   - `slides/<slug>.md`             (package-ops `chapterSlidesPath`)
 *   - `concepts/<slug>.md`           (workspace edit route)
 *   - `assessment-support/<slug>.md` (workspace edit route)
 *
 * All five directories are PUBLIC in both the v1 layer table (`./layers`)
 * and the v2 space table (`./spaces`): the "spine" documents (concept map,
 * assessment guide) are *unpublished*, not *private* — they live in the
 * public repo but are deliberately absent from the student site
 * (document-model.md §2, rows 1 and 4). `private` / `private-instructor`
 * paths are never slots; the two-repo invariant is unaffected by this file.
 */

import { CHAPTER_SLUG_PATTERN } from "./manifest";
import type { RepoKind } from "./layers";

export const CHAPTER_SLOTS = [
  "concept-map",
  "study-guide",
  "slides",
  "assessment-guide",
  "practice",
] as const;

export type ChapterSlot = (typeof CHAPTER_SLOTS)[number];

/** Declared shape of one chapter document slot. */
export interface ChapterSlotSpec {
  /** Top-level directory (a v1 layer dir and a v2 space dir alike). */
  readonly dir: string;
  /** File extension including the dot. The committed source is lean
   *  markdown for all five; `.md.html` / `.slides.html` are generated
   *  surfaces and are never committed (document-model.md §1). */
  readonly extension: string;
  /** Repository the slot's file belongs to (two-repo invariant). */
  readonly repo: RepoKind;
  /** Rendered on the student course site when content exists. The spine
   *  documents are public-repo but not published (document-model.md §2). */
  readonly published: boolean;
  /** Educator-facing name. Never a Git/developer term. */
  readonly label: string;
}

/** The per-slot contract table. The single source of truth for slot paths. */
export const CHAPTER_SLOT_SPECS: Readonly<Record<ChapterSlot, ChapterSlotSpec>> = {
  "concept-map": {
    dir: "concepts",
    extension: ".md",
    repo: "public",
    published: false,
    label: "Concept map",
  },
  "study-guide": {
    dir: "study-guide",
    extension: ".md",
    repo: "public",
    published: true,
    label: "Study guide",
  },
  slides: {
    dir: "slides",
    extension: ".md",
    repo: "public",
    published: true,
    label: "Slides",
  },
  "assessment-guide": {
    dir: "assessment-support",
    extension: ".md",
    repo: "public",
    published: false,
    label: "Assessment guide",
  },
  practice: {
    dir: "practice",
    extension: ".md",
    repo: "public",
    published: true,
    label: "Practice questions",
  },
} as const;

/** Slots rendered on the student site (derived — cannot drift from the table). */
export const PUBLISHED_CHAPTER_SLOTS: readonly ChapterSlot[] = CHAPTER_SLOTS.filter(
  (slot) => CHAPTER_SLOT_SPECS[slot].published,
);

/** The course spine: public-repo, unpublished, hand-maintained plain text. */
export const SPINE_CHAPTER_SLOTS: readonly ChapterSlot[] = CHAPTER_SLOTS.filter(
  (slot) => !CHAPTER_SLOT_SPECS[slot].published,
);

export class InvalidChapterSlugError extends Error {
  constructor(public readonly slug: string) {
    super(
      `"${slug}" is not a valid chapter name (lowercase letters, digits and single dashes)`,
    );
    this.name = "InvalidChapterSlugError";
  }
}

/** True if `slug` is a well-formed chapter slug (manifest contract). */
export function isChapterSlug(slug: string): boolean {
  return CHAPTER_SLUG_PATTERN.test(slug);
}

/** Which repository a slot's file lives in. */
export function slotRepo(slot: ChapterSlot): RepoKind {
  return CHAPTER_SLOT_SPECS[slot].repo;
}

/** True when the slot's content is rendered on the student site. */
export function isPublishedSlot(slot: ChapterSlot): boolean {
  return CHAPTER_SLOT_SPECS[slot].published;
}

/**
 * The canonical repository path a chapter document occupies. The file may
 * or may not exist — the slot is declared either way; existence means
 * content exists. Throws on a malformed chapter slug (fail closed: an
 * unclassifiable path must never be built, let alone committed).
 */
export function slotPath(slot: ChapterSlot, chapterSlug: string): string {
  if (!isChapterSlug(chapterSlug)) throw new InvalidChapterSlugError(chapterSlug);
  const spec = CHAPTER_SLOT_SPECS[slot];
  return `${spec.dir}/${chapterSlug}${spec.extension}`;
}

/** All five canonical paths for one chapter, keyed by slot. */
export function chapterSlotPaths(
  chapterSlug: string,
): Readonly<Record<ChapterSlot, string>> {
  return {
    "concept-map": slotPath("concept-map", chapterSlug),
    "study-guide": slotPath("study-guide", chapterSlug),
    slides: slotPath("slides", chapterSlug),
    "assessment-guide": slotPath("assessment-guide", chapterSlug),
    practice: slotPath("practice", chapterSlug),
  };
}

const DIR_TO_SLOT = new Map<string, ChapterSlot>(
  CHAPTER_SLOTS.map((slot) => [CHAPTER_SLOT_SPECS[slot].dir, slot]),
);

/**
 * Exact inverse of `slotPath`: classify a repository path as a chapter
 * document slot. Returns null — never throws — for anything that is not a
 * slot file: assets, the manifest, private content, nested paths under a
 * slot directory, generated surfaces (`.md.html`, `.slides.html`), and
 * malformed chapter slugs. A classifier must be total; fail-closed
 * *validation* is `assertPathAllowedInRepo`'s job, not this one's.
 */
export function slotForPath(
  path: string,
): { slot: ChapterSlot; chapterSlug: string } | null {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) return null;

  const segments = normalized.split("/");
  if (segments.length !== 2) return null;

  const [dir, file] = segments as [string, string];
  const slot = DIR_TO_SLOT.get(dir);
  if (!slot) return null;

  const { extension } = CHAPTER_SLOT_SPECS[slot];
  if (!file.endsWith(extension)) return null;

  const chapterSlug = file.slice(0, file.length - extension.length);
  if (!isChapterSlug(chapterSlug)) return null;

  return { slot, chapterSlug };
}

/** True when the path is the canonical path of some chapter document slot. */
export function isSlotPath(path: string): boolean {
  return slotForPath(path) !== null;
}
