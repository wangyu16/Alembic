/**
 * Collection scope primitives (pure, no IO).
 *
 * A collection's files split by *scope*: course-wide (the space root or a
 * named folder like `structures/`) vs chapter-scoped (a file living under the
 * reserved `chapters/<slug>/` subtree, docs/specs/workspace-collections.md §1).
 * Both `layerForPath` (v1) and `spaceForPath` (v2) already classify a path to
 * its layer/space by the first segment alone and ignore depth, so this module
 * adds only the *within-space* scope refinement they intentionally omit — it
 * never re-derives the layer/space. Fail-closed like its siblings: it reuses
 * `PathLayerError` so callers catch one error type across the contract, and a
 * `chapters/<slug>/` subtree whose slug is not a live chapter resolves to
 * course scope (never a phantom chapter).
 */

import { PathLayerError } from "./layers";

/** Reserved first-level folder, inside any space, that holds chapter-scoped
 * files: `<spaceDir>/chapters/<slug>/…`. */
export const CHAPTER_SCOPE_DIR = "chapters";

/** The scope of a collection file: course-wide, or bound to one chapter. */
export type CollectionScope =
  | { kind: "course" }
  | { kind: "chapter"; slug: string };

/**
 * Build the repository-relative path for a chapter-scoped file:
 * `<spaceDir>/chapters/<slug>/<rest>`. Normalizes `rest` (backslash→slash,
 * duplicate slashes collapsed). Throws `PathLayerError` (fail closed) on an
 * empty `spaceDir`/`slug`/`rest`, a `..` traversal segment, a slug that itself
 * contains a path separator, or an absolute `rest` — a caller handing this a
 * rooted path is a programming error, never silently rebased.
 */
export function chapterScopedPath(
  spaceDir: string,
  slug: string,
  rest: string,
): string {
  const cleanSpaceDir = spaceDir.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!cleanSpaceDir) {
    throw new PathLayerError(
      `chapterScopedPath requires a space directory`,
      spaceDir,
    );
  }
  if (!slug) {
    throw new PathLayerError(`chapterScopedPath requires a chapter slug`, slug);
  }
  if (slug.includes("..")) {
    throw new PathLayerError(`Path traversal is not allowed: ${slug}`, slug);
  }
  if (slug.replace(/\\/g, "/").includes("/")) {
    throw new PathLayerError(
      `Chapter slug must not contain a path separator: ${slug}`,
      slug,
    );
  }
  const normalizedRest = rest.replace(/\\/g, "/");
  if (!normalizedRest) {
    throw new PathLayerError(`chapterScopedPath requires a rest path`, rest);
  }
  if (normalizedRest.startsWith("/")) {
    throw new PathLayerError(`Rest path must be relative: ${rest}`, rest);
  }
  if (normalizedRest.includes("..")) {
    throw new PathLayerError(`Path traversal is not allowed: ${rest}`, rest);
  }
  const cleanRest = normalizedRest.replace(/\/+/g, "/");
  return `${cleanSpaceDir}/${CHAPTER_SCOPE_DIR}/${slug}/${cleanRest}`;
}

/**
 * Resolve the collection scope of a repository-relative `path` within the
 * space rooted at `spaceDir`, given the space's live `chapterSlugs`.
 *
 * Returns `{kind:"chapter", slug}` ONLY when the path sits under
 * `<spaceDir>/chapters/<slug>/…` AND `slug` is a live chapter. Everything else
 * — the space root, named folders (`structures/`, `answer-keys/`, …), an
 * unknown slug, a bare `<spaceDir>/chapters/` with no slug, or a path under a
 * different space entirely — is course-wide. Does NOT throw for paths outside
 * `spaceDir` (this is a within-space refinement, not a boundary check), but
 * DOES reject `..` traversal — a path that could escape must never classify.
 */
export function scopeForPath(
  spaceDir: string,
  path: string,
  chapterSlugs: readonly string[],
): CollectionScope {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) {
    throw new PathLayerError(`Path traversal is not allowed: ${path}`, path);
  }
  const segments = normalized.split("/");
  if (segments[0] !== spaceDir) return { kind: "course" };
  if (segments[1] !== CHAPTER_SCOPE_DIR) return { kind: "course" };
  const slug = segments[2];
  if (!slug) return { kind: "course" };
  if (!chapterSlugs.includes(slug)) return { kind: "course" };
  return { kind: "chapter", slug };
}
