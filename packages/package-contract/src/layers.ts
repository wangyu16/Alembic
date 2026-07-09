/**
 * Package layers and their physical repository assignment.
 *
 * The two-repo split is a contract primitive, not an implementation detail:
 * `private-instructor` content lives in the companion private repository and
 * can NEVER be staged to the public repository, even temporarily. Git history
 * is permanent — a private file committed once to the public repo remains
 * retrievable after deletion.
 */

export const PACKAGE_LAYERS = [
  "study-guide",
  "practice",
  "concepts",
  "objectives",
  "materials",
  "assessment-support",
  "private-instructor",
  "provenance",
  "metadata",
  "research-schema",
] as const;

export type PackageLayer = (typeof PACKAGE_LAYERS)[number];

export type RepoKind = "public" | "private";

/** Which repository each layer is stored in. */
export const LAYER_REPO: Record<PackageLayer, RepoKind> = {
  "study-guide": "public",
  practice: "public",
  concepts: "public",
  objectives: "public",
  materials: "public",
  "assessment-support": "public",
  "private-instructor": "private",
  provenance: "public",
  metadata: "public",
  "research-schema": "public",
};

/** Top-level directory for each layer inside its repository. */
export const LAYER_DIR: Record<PackageLayer, string> = {
  "study-guide": "study-guide",
  practice: "practice",
  concepts: "concepts",
  objectives: "objectives",
  materials: "materials",
  "assessment-support": "assessment-support",
  "private-instructor": "private-instructor",
  provenance: "provenance",
  metadata: "metadata",
  "research-schema": "research-schema",
};

const DIR_TO_LAYER = new Map<string, PackageLayer>(
  PACKAGE_LAYERS.map((layer) => [LAYER_DIR[layer], layer]),
);

/** Repo-root files (manifest, README, build config) that belong to no layer. */
const ROOT_FILE_ALLOWLIST = new Set([
  "alembic.json",
  "README.md",
  "LICENSE",
  "CITATION.cff",
  ".gitignore",
]);

const ROOT_DIR_ALLOWLIST = new Set([".alembic", ".github"]);

export class PathLayerError extends Error {
  constructor(
    message: string,
    public readonly path: string,
  ) {
    super(message);
    this.name = "PathLayerError";
  }
}

/**
 * Resolve a repository-relative path to its package layer.
 * Returns null for allowlisted root files; throws for unknown locations
 * (fail closed — an unclassifiable path must never be committed).
 */
export function layerForPath(path: string): PackageLayer | null {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) {
    throw new PathLayerError(`Path traversal is not allowed: ${path}`, path);
  }
  const [first, ...rest] = normalized.split("/");
  if (!first) {
    throw new PathLayerError(`Empty path`, path);
  }
  if (rest.length === 0) {
    if (ROOT_FILE_ALLOWLIST.has(first)) return null;
    throw new PathLayerError(
      `Root file "${first}" is not in the package contract allowlist`,
      path,
    );
  }
  if (ROOT_DIR_ALLOWLIST.has(first)) return null;
  const layer = DIR_TO_LAYER.get(first);
  if (!layer) {
    throw new PathLayerError(
      `Directory "${first}" does not map to any package layer`,
      path,
    );
  }
  return layer;
}

export class RepoBoundaryViolation extends Error {
  constructor(
    public readonly path: string,
    public readonly layer: PackageLayer,
    public readonly targetRepo: RepoKind,
  ) {
    super(
      `Layer "${layer}" (path "${path}") belongs to the ${LAYER_REPO[layer]} repository and must never be written to the ${targetRepo} repository`,
    );
    this.name = "RepoBoundaryViolation";
  }
}

/**
 * The two-repo invariant. Every commit operation MUST pass each file path
 * through this check before staging. Throws on violation — there is no
 * override parameter by design.
 */
export function assertPathAllowedInRepo(path: string, repo: RepoKind): void {
  const layer = layerForPath(path);
  if (layer === null) return; // allowlisted root file, valid in either repo
  if (LAYER_REPO[layer] !== repo) {
    throw new RepoBoundaryViolation(path, layer, repo);
  }
}
