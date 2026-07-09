import {
  assertPathAllowedInRepo,
  CHAPTER_SLUG_PATTERN,
  conceptMapPath,
  newBlockId,
  objectivesPath,
  parseManifest,
  type ChapterRef,
  type PackageManifest,
  type UnitTerm,
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
  return `# ${title}

## Section 1{{attrs[#${id}]}}

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

/**
 * Rename a chapter's **page name** (slug) — the file name and public URL — while
 * keeping its title and content. Moves every slug-keyed file (study-guide page,
 * chapter-scoped concept map and objectives) to the new slug and updates the
 * manifest. Block IDs are untouched, so derived artifacts stay linked. The
 * chapter's public URL changes, so callers should warn the educator.
 */
export async function renameChapterPageName(
  store: PackageStore,
  packageId: string,
  oldSlug: string,
  newSlug: string,
): Promise<{ slug: string; path: string; moved: { from: string; to: string }[] }> {
  if (!CHAPTER_SLUG_PATTERN.test(newSlug)) {
    throw new ChapterOperationError(`Invalid page name: "${newSlug}"`);
  }

  const manifest = await readManifest(store, packageId);
  const chapters = effectiveChapters(manifest).slice();
  const idx = chapters.findIndex((c) => c.slug === oldSlug);
  if (idx === -1) throw new ChapterNotFoundError(oldSlug);

  if (newSlug === oldSlug) {
    return { slug: oldSlug, path: pathForChapter(oldSlug), moved: [] };
  }
  if (chapters.some((c, i) => i !== idx && c.slug === newSlug)) {
    throw new ChapterOperationError(`A page named "${newSlug}" already exists.`);
  }

  // Every file family that keys on the chapter slug. Study guide honors the
  // implicit-chapter default file; concept map and objectives are flat.
  const moves: Array<{ oldPath: string; newPath: string }> = [
    { oldPath: pathForChapter(oldSlug), newPath: chapterStudyGuidePath(newSlug) },
    {
      oldPath: conceptMapPath("chapter", oldSlug),
      newPath: conceptMapPath("chapter", newSlug),
    },
    {
      oldPath: objectivesPath("chapter", oldSlug),
      newPath: objectivesPath("chapter", newSlug),
    },
  ];

  const files = await store.listFiles(packageId);
  const present = new Map(
    files.filter((f) => f.repo === "public").map((f) => [f.path, f.content]),
  );

  const toWrite: PackageFile[] = [];
  const toDelete: { repo: "public"; path: string }[] = [];
  const moved: { from: string; to: string }[] = [];
  for (const m of moves) {
    const content = present.get(m.oldPath);
    if (content === undefined) continue; // family not used for this chapter
    assertPathAllowedInRepo(m.newPath, "public");
    toWrite.push({ repo: "public", path: m.newPath, content });
    toDelete.push({ repo: "public", path: m.oldPath });
    moved.push({ from: m.oldPath, to: m.newPath });
  }

  chapters[idx] = { ...chapters[idx]!, slug: newSlug };
  const next: PackageManifest = { ...manifest, chapters };
  assertPathAllowedInRepo(MANIFEST_PATH, "public");
  toWrite.push({
    repo: "public",
    path: MANIFEST_PATH,
    content: JSON.stringify(next, null, 2) + "\n",
  });

  await store.putFiles(packageId, toWrite);
  await store.deleteFiles(packageId, toDelete);

  return { slug: newSlug, path: chapterStudyGuidePath(newSlug), moved };
}

/**
 * Set the course's unit term (display wording: chapter / module / lesson / …).
 * Manifest-only; never touches chapter data. Absent term defaults to "chapter".
 */
export async function setUnitTerm(
  store: PackageStore,
  packageId: string,
  term: UnitTerm,
): Promise<void> {
  const manifest = await readManifest(store, packageId);
  await writeManifest(store, packageId, { ...manifest, unitTerm: term });
}
