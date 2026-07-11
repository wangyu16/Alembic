import {
  classForPath,
  PathLayerError,
  type CollectionScope,
  type FileTypeDef,
  type HandlingClass,
  type RepoKind,
} from "@alembic/package-contract";
import { listCollection, type ListCollectionOptions } from "./collections";
import type { PackageStore } from "./store";

/**
 * Folder-aware read model + folder/file operations for a collection
 * (collections framework, CF1; docs/specs/collections-framework.md §2, §7, §8).
 *
 * §2 splits a collection file's path into three layers:
 *
 *   <space>/[chapters/<slug>/]<free/nested/path>/<name>.<ext>
 *
 * The first two are *semantic* — the contract's space + `scopeForPath` already
 * own them, and `listCollection` (this package) already flattens a space into
 * scope-annotated files. This module adds the third layer: the FREE folder tree
 * below the scope prefix (a plain file-manager hierarchy, no meaning attached),
 * plus the store-level move/delete ops that reorganize it.
 *
 * Like `collections.ts`, it is IO-light and reuses the contract's pure fns
 * (`classForPath`) and `listCollection`'s scope + carrier-kind resolution; it
 * does NO two-repo-invariant validation and no GitHub commit — writers
 * (`packageOps`, `validateCommitPlan`) own that. It is, however, fail-closed on
 * path shape (rejects `..`, absolute, empty, and moves that change the space).
 */

/** A leaf file in the folder tree, with its handling class + carrier kind. */
export interface FileLeaf {
  /** Repository-relative path (e.g. `materials/chapters/02-step/figs/a.svg`). */
  path: string;
  /** Final path segment (`a.svg`). */
  name: string;
  /** Handling class from the file-type registry (`classForPath`). */
  class: HandlingClass;
  /** Carrier kind id (e.g. "ketcher") when the extension maps to a registered
   * carrier kind; omitted for plain files. Passed through from
   * `listCollection`. */
  kind?: string;
}

/** A folder in the free tree below a scope prefix. The root folder's `path` is
 *  the scope prefix itself (see `collectionTree`). */
export interface FolderNode {
  /** Folder name (final segment of `path`); the root folder's name is `""`. */
  name: string;
  /** Repository-relative path of this folder (no trailing slash). */
  path: string;
  /** Child folders, ordered by name (`localeCompare`). */
  folders: FolderNode[];
  /** Files directly in this folder, ordered by name (`localeCompare`). */
  files: FileLeaf[];
}

/** The folder tree for one scope (course, or a single chapter). */
export interface CollectionScopeTree {
  scope: CollectionScope;
  root: FolderNode;
}

/** `listCollection` options plus the package's registered file types (for
 *  `classForPath`; the built-in registry is always consulted underneath). */
export interface CollectionTreeOptions extends ListCollectionOptions {
  /** The package manifest's additive `fileTypes` (CF0); optional. */
  fileTypes?: readonly FileTypeDef[];
}

/** Normalize a path for splitting: backslash→slash, collapse duplicate slashes,
 *  strip leading slashes. Read-side only (never used to derive a write target).*/
function normalizeForSplit(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");
}

/** The repo-relative prefix (no trailing slash) that a scope's free folder tree
 *  hangs below: `<spaceDir>` for course, `<spaceDir>/chapters/<slug>` for a
 *  chapter. The scope prefix in §2 terms, minus the trailing slash so folder
 *  paths are uniform (`materials`, `materials/figs`, …). */
function scopePrefix(spaceDir: string, scope: CollectionScope): string {
  const clean = spaceDir.replace(/\\/g, "/").replace(/\/+$/, "");
  return scope.kind === "course"
    ? clean
    : `${clean}/chapters/${scope.slug}`;
}

/** Stable scope order: course first, then chapters by slug (`localeCompare`) —
 *  the same philosophy as `compareItems` in collections.ts. */
function compareScopes(a: CollectionScope, b: CollectionScope): number {
  const ac = a.kind === "course" ? 0 : 1;
  const bc = b.kind === "course" ? 0 : 1;
  if (ac !== bc) return ac - bc;
  const aSlug = a.kind === "chapter" ? a.slug : "";
  const bSlug = b.kind === "chapter" ? b.slug : "";
  return aSlug.localeCompare(bSlug);
}

function scopeKey(scope: CollectionScope): string {
  return scope.kind === "course" ? "course" : `chapter:${scope.slug}`;
}

/** Find or create the child folder `name` under `parent` (path = parent + name). */
function childFolder(parent: FolderNode, name: string): FolderNode {
  let child = parent.folders.find((f) => f.name === name);
  if (!child) {
    child = { name, path: `${parent.path}/${name}`, folders: [], files: [] };
    parent.folders.push(child);
  }
  return child;
}

/** Recursively sort a folder: folders before files, each by name. */
function sortFolder(node: FolderNode): void {
  node.folders.sort((a, b) => a.name.localeCompare(b.name));
  node.files.sort((a, b) => a.name.localeCompare(b.name));
  for (const child of node.folders) sortFolder(child);
}

/**
 * Build the scope×folder tree for a collection space.
 *
 * Returns one `CollectionScopeTree` per scope that has files (course-first,
 * then chapters by slug). Each tree's `root.path` is the scope prefix
 * (`<spaceDir>` for course, `<spaceDir>/chapters/<slug>` for a chapter); the
 * folders below it are the FREE nesting between the prefix and each file. A
 * file directly under the prefix is a `root.files` leaf; `<prefix>/figs/a.svg`
 * creates a `figs` folder node. Every leaf carries its handling `class`
 * (`classForPath(path, fileTypes)`) and the carrier `kind` from
 * `listCollection`. Order is deterministic throughout (folders before files,
 * each `localeCompare` by name).
 *
 * Scope resolution is delegated to `listCollection`/`scopeForPath`, so a
 * `chapters/<unknown-slug>/` file lands in the course tree (as a `chapters`
 * subfolder), never a phantom chapter.
 */
export async function collectionTree(
  store: PackageStore,
  packageId: string,
  opts: CollectionTreeOptions,
): Promise<CollectionScopeTree[]> {
  const items = await listCollection(store, packageId, opts);
  const byScope = new Map<string, CollectionScopeTree>();

  for (const item of items) {
    const key = scopeKey(item.scope);
    let tree = byScope.get(key);
    if (!tree) {
      tree = {
        scope: item.scope,
        root: {
          name: "",
          path: scopePrefix(opts.spaceDir, item.scope),
          folders: [],
          files: [],
        },
      };
      byScope.set(key, tree);
    }

    // The free path below the scope prefix: split into folder segments + file.
    const prefix = tree.root.path;
    const normalized = normalizeForSplit(item.path);
    const rest = normalized.startsWith(`${prefix}/`)
      ? normalized.slice(prefix.length + 1)
      : normalized; // defensive; listCollection already scoped to this space
    const segments = rest.split("/").filter(Boolean);
    const fileName = segments.pop() ?? "";
    let folder = tree.root;
    for (const seg of segments) folder = childFolder(folder, seg);

    const leaf: FileLeaf = {
      path: item.path,
      name: fileName,
      class: classForPath(item.path, opts.fileTypes),
      ...(item.kind ? { kind: item.kind } : {}),
    };
    folder.files.push(leaf);
  }

  const trees = [...byScope.values()];
  trees.sort((a, b) => compareScopes(a.scope, b.scope));
  for (const t of trees) sortFolder(t.root);
  return trees;
}

// ---------------------------------------------------------------------------
// Folder/file operations over the store (fail-closed; no GitHub, no two-repo
// re-validation — writers own that, exactly as collections.ts documents).
// ---------------------------------------------------------------------------

/** Validate + normalize a repo-relative path/prefix. Fail-closed: rejects empty,
 *  absolute (`/…`), and `..` traversal. Collapses duplicate slashes and strips a
 *  trailing slash so prefixes compare cleanly. */
function assertSafePath(path: string): string {
  const n = path.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!n) throw new PathLayerError(`A path is required`, path);
  if (n.startsWith("/")) {
    throw new PathLayerError(`Path must be relative: ${path}`, path);
  }
  if (n.includes("..")) {
    throw new PathLayerError(`Path traversal is not allowed: ${path}`, path);
  }
  return n.replace(/\/+$/, "");
}

function firstSegment(path: string): string {
  return path.split("/")[0] ?? "";
}

/** Assert a move stays within one collection space (same first path segment).
 *  Cross-scope moves (course↔chapter, chapter↔chapter) are allowed — scope is
 *  just the `chapters/<slug>/` prefix within the same space. */
function assertSameSpace(from: string, to: string): void {
  const fromSpace = firstSegment(from);
  const toSpace = firstSegment(to);
  if (!fromSpace || !toSpace) {
    throw new PathLayerError(`A move requires a space segment`, `${from} → ${to}`);
  }
  if (fromSpace !== toSpace) {
    throw new PathLayerError(
      `A move must stay within one collection space: ${fromSpace} → ${toSpace}`,
      `${from} → ${to}`,
    );
  }
}

/** True when `path` sits at or under the folder `prefix` (boundary-aware:
 *  `a/b` matches `a/b` and `a/b/…` but never `a/bc`). Both pre-normalized. */
function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Move a single file within one collection space/repo. Reads the file, writes
 * it at `toPath`, deletes `fromPath`. Fail-closed on `..`/absolute/empty and on
 * a move that changes the space (first segment). A no-op move (`from === to`
 * after normalization) is left untouched. Throws if the source is absent.
 */
export async function moveFile(
  store: PackageStore,
  packageId: string,
  repo: RepoKind,
  fromPath: string,
  toPath: string,
): Promise<void> {
  const from = assertSafePath(fromPath);
  const to = assertSafePath(toPath);
  assertSameSpace(from, to);
  if (from === to) return;

  const files = await store.listFiles(packageId);
  const source = files.find((f) => f.repo === repo && f.path === from);
  if (!source) {
    throw new PathLayerError(`No file to move at ${from}`, fromPath);
  }
  await store.putFiles(packageId, [{ repo, path: to, content: source.content }]);
  await store.deleteFiles(packageId, [{ repo, path: from }]);
}

/**
 * Move every file under `fromPrefix` to the corresponding path under
 * `toPrefix`, within one collection space/repo. Prefix-boundary aware
 * (`a/b` never drags `a/bc`). Fail-closed on `..`/absolute/empty and on a move
 * that changes the space. Returns the number of files moved. Freshly written
 * targets are never deleted (safe when the prefixes overlap).
 */
export async function moveFolder(
  store: PackageStore,
  packageId: string,
  repo: RepoKind,
  fromPrefix: string,
  toPrefix: string,
): Promise<number> {
  const from = assertSafePath(fromPrefix);
  const to = assertSafePath(toPrefix);
  assertSameSpace(from, to);
  if (from === to) return 0;

  const files = await store.listFiles(packageId);
  const moves: PackageFileMove[] = [];
  for (const f of files) {
    if (f.repo !== repo) continue;
    if (!underPrefix(f.path, from)) continue;
    const suffix = f.path.slice(from.length); // "" or "/…"
    moves.push({ from: f.path, to: `${to}${suffix}`, content: f.content });
  }
  if (moves.length === 0) return 0;

  const newPaths = new Set(moves.map((m) => m.to));
  await store.putFiles(
    packageId,
    moves.map((m) => ({ repo, path: m.to, content: m.content })),
  );
  const deletions = moves
    .filter((m) => !newPaths.has(m.from))
    .map((m) => ({ repo, path: m.from }));
  if (deletions.length > 0) await store.deleteFiles(packageId, deletions);
  return moves.length;
}

interface PackageFileMove {
  from: string;
  to: string;
  content: string;
}

/**
 * Delete every file at or under the folder `prefix` (boundary-aware — `a/b`
 * never drags `a/bc`) within one repo. Fail-closed on `..`/absolute/empty.
 * Returns the number of files deleted.
 */
export async function deleteFolder(
  store: PackageStore,
  packageId: string,
  repo: RepoKind,
  prefix: string,
): Promise<number> {
  const clean = assertSafePath(prefix);
  const files = await store.listFiles(packageId);
  const targets = files
    .filter((f) => f.repo === repo && underPrefix(f.path, clean))
    .map((f) => ({ repo, path: f.path }));
  if (targets.length > 0) await store.deleteFiles(packageId, targets);
  return targets.length;
}
