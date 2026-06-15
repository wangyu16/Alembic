import {
  assertPathAllowedInRepo,
  CHAPTER_SLUG_PATTERN,
  newBlockId,
  parseManifest,
  type ChapterRef,
  type PackageManifest,
} from "@alembic/package-contract";
import type { PackageFile, PackageStore } from "./store";
import {
  chapterStudyGuidePath,
  DEFAULT_STUDY_GUIDE_PATH,
} from "./study-guide";

/** Repo-relative path of the manifest (source of truth for chapters). */
const MANIFEST_PATH = "alembic.json";

/** Slug of the implicit chapter, derived from the default study-guide file. */
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
  const files = await store.listFiles(packageId);
  const file = files.find(
    (f) => f.repo === "public" && f.path === MANIFEST_PATH,
  );
  if (!file) {
    throw new ChapterOperationError(
      `Manifest (${MANIFEST_PATH}) not found for package ${packageId}`,
    );
  }
  return parseManifest(JSON.parse(file.content));
}

/** Persist the manifest back to the public repo. */
async function writeManifest(
  store: PackageStore,
  packageId: string,
  manifest: PackageManifest,
): Promise<void> {
  assertPathAllowedInRepo(MANIFEST_PATH, "public");
  await store.putFiles(packageId, [
    {
      repo: "public",
      path: MANIFEST_PATH,
      content: JSON.stringify(manifest, null, 2) + "\n",
    },
  ]);
}

/**
 * Return `manifest.chapters` if present, otherwise the single implicit
 * chapter materialized in memory (slug derived from the default file, title
 * from the manifest). Does NOT persist.
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

/** Minimal seed content for a new chapter, carrying a native block id. */
function seedChapter(title: string): string {
  const id = newBlockId();
  return `## ${title}{{attrs[#${id}]}}

Welcome to **${title}**. Replace this with your own material.
`;
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

/**
 * Append a new chapter. If the package is still single (implicit) chapter, the
 * implicit chapter is first materialized as `chapters[0]` so it is not lost.
 * Mints a unique, contract-valid slug, seeds the chapter's study-guide file,
 * and persists the manifest + file (public repo).
 */
export async function createChapter(
  store: PackageStore,
  packageId: string,
  input: { title: string; slug?: string },
): Promise<ChapterInfo> {
  const manifest = await readManifest(store, packageId);
  const chapters = effectiveChapters(manifest).slice();

  const existing = new Set(chapters.map((c) => c.slug));
  const base = input.slug ?? slugify(input.title);
  if (!CHAPTER_SLUG_PATTERN.test(base)) {
    throw new ChapterOperationError(`Invalid chapter slug: "${base}"`);
  }
  const slug = uniqueSlug(base, existing);
  const path = chapterStudyGuidePath(slug);

  chapters.push({ slug, title: input.title });

  assertPathAllowedInRepo(MANIFEST_PATH, "public");
  assertPathAllowedInRepo(path, "public");

  const next: PackageManifest = { ...manifest, chapters };
  const files: PackageFile[] = [
    {
      repo: "public",
      path: MANIFEST_PATH,
      content: JSON.stringify(next, null, 2) + "\n",
    },
    { repo: "public", path, content: seedChapter(input.title) },
  ];
  await store.putFiles(packageId, files);

  return { slug, title: input.title, path };
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
): Promise<void> {
  const manifest = await readManifest(store, packageId);
  const chapters = effectiveChapters(manifest).slice();
  const idx = chapters.findIndex((c) => c.slug === slug);
  if (idx === -1) throw new ChapterNotFoundError(slug);

  chapters[idx] = { ...chapters[idx]!, title: newTitle };
  await writeManifest(store, packageId, { ...manifest, chapters });
}

/**
 * Reorder chapters. `orderedSlugs` must be a permutation of the current
 * chapter slugs. The implicit chapter is materialized first if needed.
 */
export async function reorderChapters(
  store: PackageStore,
  packageId: string,
  orderedSlugs: string[],
): Promise<void> {
  const manifest = await readManifest(store, packageId);
  const chapters = effectiveChapters(manifest);

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
  const reordered = orderedSlugs.map((s) => bySlug.get(s)!);
  await writeManifest(store, packageId, { ...manifest, chapters: reordered });
}

/**
 * Delete a chapter: remove it from the manifest and delete its study-guide
 * file. Refuses to delete the only chapter. The implicit chapter is
 * materialized first if needed (which then also guards last-chapter deletes).
 */
export async function deleteChapter(
  store: PackageStore,
  packageId: string,
  slug: string,
): Promise<void> {
  const manifest = await readManifest(store, packageId);
  const chapters = effectiveChapters(manifest).slice();

  const idx = chapters.findIndex((c) => c.slug === slug);
  if (idx === -1) throw new ChapterNotFoundError(slug);
  if (chapters.length <= 1) {
    throw new ChapterOperationError("Cannot delete the only chapter");
  }

  const path = pathForChapter(slug);
  chapters.splice(idx, 1);

  await writeManifest(store, packageId, { ...manifest, chapters });
  await store.deleteFiles(packageId, [{ repo: "public", path }]);
}
