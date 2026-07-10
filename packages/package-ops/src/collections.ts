import { getKindByExtension } from "@alembic/carriers";
import {
  chapterScopedPath,
  PathLayerError,
  scopeForPath,
  type CollectionScope,
} from "@alembic/package-contract";
import type { RepoKind } from "@alembic/package-contract";
import type { PackageStore } from "./store";

/**
 * Scope-aware collection listing (docs/specs/workspace-collections.md §1, §3).
 *
 * A collection is a course-wide *library* (Assets, Private, …) whose files
 * split by *scope*: course-wide (the space root or a named folder like
 * `structures/`) vs chapter-scoped (`<spaceDir>/chapters/<slug>/…`). Unlike
 * `listAssets` — which is flat, scope-blind, and public/`materials`-only — this
 * annotates every file in a given space with its `CollectionScope`, so a
 * workspace UI can show "whole course" vs "this chapter" bands within one
 * collection.
 *
 * IO-light by design: it consumes a `PackageStore`, re-uses the contract's pure
 * `scopeForPath` (never re-deriving the space) and the shared carrier-kind
 * registry, and does no two-repo-invariant validation — writers (`writeAsset`,
 * `applyEditorEdit`, …) already own that. Reading is unconditionally safe.
 */

/** One file in a collection, annotated with its within-space scope. */
export interface CollectionItem {
  /** Repository-relative path (e.g. `materials/chapters/02-step/fig.svg`). */
  path: string;
  /** Course-wide, or bound to one live chapter. */
  scope: CollectionScope;
  /** Carrier kind id (e.g. "ketcher") when the extension maps to a registered
   * kind; omitted for plain files (notes, keys, …). */
  kind?: string;
}

export interface ListCollectionOptions {
  /** The collection's contract space directory (e.g. `materials`,
   * `private-instructor`) — the first path segment its files live under. */
  spaceDir: string;
  /** Which repository the space belongs to. */
  repo: RepoKind;
  /** The package's live chapter slugs. A `chapters/<slug>/` subtree whose slug
   * is not in this set resolves to course scope, never a phantom chapter. */
  chapterSlugs: readonly string[];
}

/** First path segment of a repo-relative path (normalizes leading slashes). */
function firstSegment(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "").split("/")[0] ?? "";
}

/**
 * List a collection's files in `repo`, restricted to the `spaceDir` space and
 * annotated with each file's scope + carrier kind.
 *
 * Ordering is deterministic and stable: course-wide items first, then
 * chapter-scoped items grouped by chapter slug (`localeCompare`), and finally
 * by full path within each group — so a UI renders the "Shared across course"
 * band and each chapter's band in a fixed order regardless of store iteration.
 */
export async function listCollection(
  store: PackageStore,
  packageId: string,
  opts: ListCollectionOptions,
): Promise<CollectionItem[]> {
  const { spaceDir, repo, chapterSlugs } = opts;
  const files = await store.listFiles(packageId);
  const out: CollectionItem[] = [];
  for (const f of files) {
    if (f.repo !== repo) continue;
    if (firstSegment(f.path) !== spaceDir) continue;
    const scope = scopeForPath(spaceDir, f.path, chapterSlugs);
    const kind = getKindByExtension(f.path)?.id;
    out.push(kind ? { path: f.path, scope, kind } : { path: f.path, scope });
  }
  out.sort(compareItems);
  return out;
}

/** Deterministic order: course-wide first, then by chapter slug, then by path. */
function compareItems(a: CollectionItem, b: CollectionItem): number {
  const ac = a.scope.kind === "course" ? 0 : 1;
  const bc = b.scope.kind === "course" ? 0 : 1;
  if (ac !== bc) return ac - bc;
  const aSlug = a.scope.kind === "chapter" ? a.scope.slug : "";
  const bSlug = b.scope.kind === "chapter" ? b.scope.slug : "";
  if (aSlug !== bSlug) return aSlug.localeCompare(bSlug);
  return a.path.localeCompare(b.path);
}

/**
 * Build the write-target path for a new collection file in `spaceDir` at the
 * given scope — the path the upload/add UI commits to. Course scope lands the
 * file at the space root (`<spaceDir>/<filename>`); chapter scope routes it
 * into the reserved subtree (`<spaceDir>/chapters/<slug>/<filename>`).
 *
 * `filename` may itself be a nested rest (e.g. `structures/benzene.ketcher.svg`).
 * Round-trips: `scopeForPath(spaceDir, collectionItemPath(spaceDir, s, f), …)`
 * returns `s` for any live-chapter or course scope.
 *
 * Fail-closed on both branches: a `..` segment or an absolute `filename` throws
 * rather than emitting a path that escapes the space. The writers reject such
 * paths anyway (`layerForPath` refuses `..`), but a *write-target builder* must
 * never hand back an escaping path in the first place — and the chapter branch
 * (`chapterScopedPath`) already refuses one, so the course branch must too.
 */
export function collectionItemPath(
  spaceDir: string,
  scope: CollectionScope,
  filename: string,
): string {
  if (scope.kind === "course") {
    const clean = spaceDir.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!clean) {
      throw new PathLayerError(
        `collectionItemPath requires a space directory`,
        spaceDir,
      );
    }
    const rest = filename.replace(/\\/g, "/");
    if (!rest) {
      throw new PathLayerError(`collectionItemPath requires a filename`, filename);
    }
    if (rest.startsWith("/")) {
      throw new PathLayerError(`Filename must be relative: ${filename}`, filename);
    }
    if (rest.includes("..")) {
      throw new PathLayerError(`Path traversal is not allowed: ${filename}`, filename);
    }
    return `${clean}/${rest.replace(/\/+/g, "/")}`;
  }
  return chapterScopedPath(spaceDir, scope.slug, filename);
}
