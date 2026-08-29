import {
  assertPathAllowedInRepo,
  CHAPTER_SLOTS,
  CHAPTER_SLUG_PATTERN,
  chapterSlotPaths,
  conceptMapPath,
  objectivesPath,
  parseManifest,
  type ChapterRef,
  type PackageManifest,
  type UnitTerm,
} from "@alembic/package-contract";
import type { PackageStore } from "./store";
import { updateManifest } from "./manifest-ops";
import { writeThrough, type Committer } from "./write-through";
import {
  chapterStudyGuidePath,
  DEFAULT_STUDY_GUIDE_PATH,
} from "./study-guide";

/**
 * Chapter operations — manifest + chapter documents.
 *
 * Every write here goes through the two shared seams
 * (docs/specs/storage-and-write-paths.md §3):
 *
 *  - the manifest through `updateManifest` (the ONE manifest owner: read the
 *    file copy → patch → commit → compare-and-swap the projection), and
 *  - chapter FILES through `writeThrough` (validate → commit → project).
 *
 * A `Committer` is passed in by the caller (the web layer resolves it once per
 * action via `committerFor`); `null` means a trial package, whose store IS the
 * truth. This module stays free of web/GitHub concerns.
 *
 * **Ordering rule used throughout:** for creation the manifest is written
 * FIRST (the compare-and-swap claims the slug before any file exists, so two
 * tabs cannot mint the same chapter); for moves and deletes the FILES are
 * written first and the manifest last, so a failure in between leaves at worst
 * a chapter with an empty slot — a legal state under "slots, not placeholders"
 * (§4) — and never a stray file nobody references.
 */

/** Repo-relative path of the manifest (source of truth for chapters). */
const MANIFEST_PATH = "alembic.json";

/**
 * Slug of the implicit chapter, derived from the default study-guide file.
 *
 * **Legacy packages only.** Packages created since "slots, not placeholders"
 * declare their first chapter explicitly in the manifest (see
 * `FIRST_CHAPTER_SLUG` in create.ts, which deliberately uses this same slug);
 * this fallback exists so packages authored before that — which have no
 * `chapters` array — still list their single chapter.
 */
const IMPLICIT_CHAPTER_SLUG = DEFAULT_STUDY_GUIDE_PATH.replace(
  /^.*\//,
  "",
).replace(/\.md$/, "");

export interface ChapterInfo {
  slug: string;
  title: string;
  path: string;
}

export class ChapterNotFoundError extends Error {
  constructor(slug: string) {
    super(`Chapter not found: ${slug}`);
    this.name = "ChapterNotFoundError";
  }
}

export class ChapterOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChapterOperationError";
  }
}

/** Read and parse the manifest from the public repo. Source of truth. */
async function readManifest(
  store: PackageStore,
  packageId: string,
): Promise<PackageManifest> {
  // ONE row, not the whole package: a real course is hundreds of files and tens
  // of megabytes, and this runs on every workspace page load.
  const content = await store.readFile(packageId, "public", MANIFEST_PATH);
  const file = content === null ? null : { content };
  if (!file) {
    throw new ChapterOperationError(
      `Manifest (${MANIFEST_PATH}) not found for package ${packageId}`,
    );
  }
  return parseManifest(JSON.parse(file.content));
}

/**
 * Return `manifest.chapters` if present, otherwise — for LEGACY packages that
 * predate explicit chapter declaration — the single implicit chapter
 * materialized in memory (slug derived from the default file, title from the
 * manifest). Does NOT persist.
 */
function effectiveChapters(manifest: PackageManifest): ChapterRef[] {
  if (manifest.chapters && manifest.chapters.length > 0) {
    return manifest.chapters;
  }
  return [{ slug: IMPLICIT_CHAPTER_SLUG, title: manifest.title }];
}

/** Repo path for a chapter, honoring the implicit-chapter default file. */
function pathForChapter(slug: string): string {
  return slug === IMPLICIT_CHAPTER_SLUG
    ? DEFAULT_STUDY_GUIDE_PATH
    : chapterStudyGuidePath(slug);
}

/**
 * Convert a title to a chapter slug: lowercase, non-alphanumeric runs → "-",
 * trim/collapse dashes. Throws if the result does not match the contract.
 */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!CHAPTER_SLUG_PATTERN.test(slug)) {
    throw new ChapterOperationError(
      `Cannot derive a valid chapter slug from title: "${title}"`,
    );
  }
  return slug;
}

/** Ensure a slug is unique among `existing` by appending -2, -3, … */
function uniqueSlug(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * List a package's chapters in display order, with the repo path of each
 * chapter's study-guide file. Reads the manifest as source of truth; a package
 * with no explicit `chapters` lists a single implicit chapter.
 */
export async function listChapters(
  store: PackageStore,
  packageId: string,
): Promise<ChapterInfo[]> {
  const manifest = await readManifest(store, packageId);
  return effectiveChapters(manifest).map((c) => ({
    slug: c.slug,
    title: c.title,
    path: pathForChapter(c.slug),
  }));
}

/** `createChapter`'s result: the chapter, plus the manifest as it now stands
 *  (callers refresh their derived read cache from this instead of re-reading). */
export interface CreateChapterResult extends ChapterInfo {
  manifest: PackageManifest;
}

/**
 * Append a new chapter. If the package is a legacy single (implicit) chapter,
 * that chapter is first materialized as `chapters[0]` so it is not lost.
 * Mints a unique, contract-valid slug and records it in the manifest.
 *
 * **Writes no files** ("slots, not placeholders", §4): the new chapter's five
 * documents are declared slots, each of which starts empty; a file appears the
 * moment real content is saved into it. `path` in the result is the canonical
 * study-guide slot path, which may not exist yet.
 */
export async function createChapter(
  store: PackageStore,
  packageId: string,
  input: { title: string; slug?: string },
  committer: Committer | null = null,
): Promise<CreateChapterResult> {
  const manifest = await readManifest(store, packageId);
  const chapters = effectiveChapters(manifest);

  const existing = new Set(chapters.map((c) => c.slug));
  const base = input.slug ?? slugify(input.title);
  if (!CHAPTER_SLUG_PATTERN.test(base)) {
    throw new ChapterOperationError(`Invalid chapter slug: "${base}"`);
  }
  const slug = uniqueSlug(base, existing);
  const path = chapterStudyGuidePath(slug);
  assertPathAllowedInRepo(path, "public");

  // Manifest first: the compare-and-swap claims the slug. The patch re-checks
  // uniqueness because a retry may replay it against a manifest another writer
  // changed in the meantime.
  const { manifest: next } = await updateManifest(
    store,
    committer,
    packageId,
    (m) => {
      const chs = effectiveChapters(m).slice();
      if (chs.some((c) => c.slug === slug)) {
        throw new ChapterOperationError(`A page named "${slug}" already exists.`);
      }
      chs.push({ slug, title: input.title });
      return { ...m, chapters: chs };
    },
    { summary: `Add chapter "${input.title}"` },
  );

  return { slug, title: input.title, path, manifest: next };
}

/**
 * Rename a chapter (title only — slug is identity and stays stable). If the
 * package is still implicit, the implicit chapter is materialized first.
 * Throws if the slug does not exist.
 */
export async function renameChapter(
  store: PackageStore,
  packageId: string,
  slug: string,
  newTitle: string,
  committer: Committer | null = null,
): Promise<PackageManifest> {
  const { manifest } = await updateManifest(
    store,
    committer,
    packageId,
    (m) => {
      const chapters = effectiveChapters(m).slice();
      const idx = chapters.findIndex((c) => c.slug === slug);
      if (idx === -1) throw new ChapterNotFoundError(slug);
      chapters[idx] = { ...chapters[idx]!, title: newTitle };
      return { ...m, chapters };
    },
    { summary: `Rename chapter to "${newTitle}"` },
  );
  return manifest;
}

/**
 * Reorder chapters. `orderedSlugs` must be a permutation of the current
 * chapter slugs. The implicit chapter is materialized first if needed.
 */
export async function reorderChapters(
  store: PackageStore,
  packageId: string,
  orderedSlugs: string[],
  committer: Committer | null = null,
): Promise<PackageManifest> {
  const { manifest } = await updateManifest(
    store,
    committer,
    packageId,
    (m) => {
      const chapters = effectiveChapters(m);
      const current = chapters.map((c) => c.slug);
      const isPermutation =
        orderedSlugs.length === current.length &&
        new Set(orderedSlugs).size === orderedSlugs.length &&
        orderedSlugs.every((s) => current.includes(s));
      if (!isPermutation) {
        throw new ChapterOperationError(
          "orderedSlugs must be a permutation of the current chapter slugs",
        );
      }
      const bySlug = new Map(chapters.map((c) => [c.slug, c]));
      return { ...m, chapters: orderedSlugs.map((s) => bySlug.get(s)!) };
    },
    { summary: "Reorder chapters" },
  );
  return manifest;
}

/**
 * Delete a chapter: delete EVERY file keyed to its slug — all five chapter
 * document slots (concept map, study guide, slides, assessment guide,
 * practice) plus the two chapter-scoped planning records — then remove it from
 * the manifest. Refuses to delete the only chapter. A legacy implicit chapter
 * is materialized first if needed (which then also guards last-chapter
 * deletes).
 *
 * The delete set comes from `slugKeyedPaths` — the same slot-derived list the
 * page-name rename moves — so deleting can never leave four of five documents
 * stranded in the repo as it once did.
 */
export async function deleteChapter(
  store: PackageStore,
  packageId: string,
  slug: string,
  committer: Committer | null = null,
): Promise<PackageManifest> {
  const manifest = await readManifest(store, packageId);
  const chapters = effectiveChapters(manifest);

  const idx = chapters.findIndex((c) => c.slug === slug);
  if (idx === -1) throw new ChapterNotFoundError(slug);
  if (chapters.length <= 1) {
    throw new ChapterOperationError("Cannot delete the only chapter");
  }

  // Only delete what is actually there: a slot with no file has nothing to
  // remove, and asking the permanent store to delete a path it never had is a
  // failure, not a no-op. The old side honors a legacy implicit chapter's
  // default study-guide file name.
  const targets = slugKeyedPaths(slug, {
    studyGuidePath: pathForChapter(slug),
  });
  const files = await store.listFiles(packageId);
  const present = new Set(
    files.filter((f) => f.repo === "public").map((f) => f.path),
  );
  const changes = targets
    .filter((p) => present.has(p))
    .map((p) => ({ repo: "public" as const, path: p, content: null }));

  if (changes.length > 0) {
    await writeThrough(store, committer, packageId, {
      changes,
      summary: `Delete chapter "${chapters[idx]!.title}"`,
    });
  }

  const { manifest: updated } = await updateManifest(
    store,
    committer,
    packageId,
    (m) => {
      const chs = effectiveChapters(m).slice();
      const i = chs.findIndex((c) => c.slug === slug);
      if (i === -1) throw new ChapterNotFoundError(slug);
      if (chs.length <= 1) {
        throw new ChapterOperationError("Cannot delete the only chapter");
      }
      chs.splice(i, 1);
      return { ...m, chapters: chs };
    },
    { summary: `Delete chapter "${chapters[idx]!.title}"` },
  );
  return updated;
}

/**
 * Every repository path that keys on a chapter's slug.
 *
 * Built from `chapterSlotPaths()` — the slot table is the single source of
 * truth for the five chapter documents (concept map, study guide, slides,
 * assessment guide, practice), so this list cannot drift as slots change —
 * plus the two chapter-scoped planning records (`concepts/<slug>.json`,
 * `objectives/<slug>.json`), which are data files rather than slots.
 *
 * `opts.studyGuidePath` lets the caller honor the implicit chapter's default
 * file name on the OLD side of a move, while the NEW side is always canonical.
 * The returned order is stable, so two calls line up index-by-index.
 */
function slugKeyedPaths(
  slug: string,
  opts: { studyGuidePath?: string } = {},
): string[] {
  const slots = chapterSlotPaths(slug);
  const paths = CHAPTER_SLOTS.map((slot) =>
    slot === "study-guide" ? (opts.studyGuidePath ?? slots[slot]) : slots[slot],
  );
  return [
    ...paths,
    conceptMapPath("chapter", slug),
    objectivesPath("chapter", slug),
  ];
}

/** `renameChapterPageName`'s result. */
export interface RenameChapterPageNameResult {
  slug: string;
  path: string;
  moved: { from: string; to: string }[];
  /** The manifest as it now stands (callers refresh their read cache from it).
   *  Absent only for the no-op rename (new name === old name). */
  manifest?: PackageManifest;
}

/**
 * Rename a chapter's **page name** (slug) — the file name and public URL —
 * while keeping its title and content. Moves EVERY slug-keyed file: all five
 * chapter document slots (concept map, study guide, slides, assessment guide,
 * practice) plus the chapter-scoped concept and objectives records. Block IDs
 * are untouched, so derived artifacts stay linked. The chapter's public URL
 * changes, so callers should warn the educator.
 *
 * Files move first, the manifest pointer last (see the ordering rule above).
 */
export async function renameChapterPageName(
  store: PackageStore,
  packageId: string,
  oldSlug: string,
  newSlug: string,
  committer: Committer | null = null,
): Promise<RenameChapterPageNameResult> {
  if (!CHAPTER_SLUG_PATTERN.test(newSlug)) {
    throw new ChapterOperationError(`Invalid page name: "${newSlug}"`);
  }

  const manifest = await readManifest(store, packageId);
  const chapters = effectiveChapters(manifest);
  const idx = chapters.findIndex((c) => c.slug === oldSlug);
  if (idx === -1) throw new ChapterNotFoundError(oldSlug);

  if (newSlug === oldSlug) {
    return { slug: oldSlug, path: pathForChapter(oldSlug), moved: [] };
  }
  if (chapters.some((c, i) => i !== idx && c.slug === newSlug)) {
    throw new ChapterOperationError(`A page named "${newSlug}" already exists.`);
  }

  // The old side honors the implicit chapter's default study-guide file; the
  // new side is always the canonical slot path.
  const from = slugKeyedPaths(oldSlug, { studyGuidePath: pathForChapter(oldSlug) });
  const to = slugKeyedPaths(newSlug);

  const files = await store.listFiles(packageId);
  const present = new Map(
    files.filter((f) => f.repo === "public").map((f) => [f.path, f.content]),
  );

  const changes: {
    repo: "public";
    path: string;
    content: string | null;
  }[] = [];
  const moved: { from: string; to: string }[] = [];
  for (let i = 0; i < from.length; i++) {
    const oldPath = from[i]!;
    const newPath = to[i]!;
    const content = present.get(oldPath);
    if (content === undefined) continue; // no file at that slot for this chapter
    assertPathAllowedInRepo(newPath, "public");
    changes.push({ repo: "public", path: newPath, content });
    changes.push({ repo: "public", path: oldPath, content: null });
    moved.push({ from: oldPath, to: newPath });
  }

  if (changes.length > 0) {
    await writeThrough(store, committer, packageId, {
      changes,
      summary: `Rename chapter page name to "${newSlug}"`,
    });
  }

  const { manifest: next } = await updateManifest(
    store,
    committer,
    packageId,
    (m) => {
      const chs = effectiveChapters(m).slice();
      const i = chs.findIndex((c) => c.slug === oldSlug);
      if (i === -1) throw new ChapterNotFoundError(oldSlug);
      if (chs.some((c, j) => j !== i && c.slug === newSlug)) {
        throw new ChapterOperationError(
          `A page named "${newSlug}" already exists.`,
        );
      }
      chs[i] = { ...chs[i]!, slug: newSlug };
      return { ...m, chapters: chs };
    },
    { summary: `Rename chapter page name to "${newSlug}"` },
  );

  return {
    slug: newSlug,
    path: chapterStudyGuidePath(newSlug),
    moved,
    manifest: next,
  };
}

/**
 * Set the course's unit term (display wording: chapter / module / lesson / …).
 * Manifest-only; never touches chapter data. Absent term defaults to "chapter".
 */
export async function setUnitTerm(
  store: PackageStore,
  packageId: string,
  term: UnitTerm,
  committer: Committer | null = null,
): Promise<void> {
  await updateManifest(
    store,
    committer,
    packageId,
    (m) => ({ ...m, unitTerm: term }),
    { summary: "Set structure term" },
  );
}
