/**
 * Contract-v2 spaces and their physical repository assignment.
 *
 * In v2, the *space* IS the layer — one term, one meaning (Roadmap R1,
 * docs/specs/package-layout.md §2–3). This module is purely ADDITIVE: v1
 * layers (`./layers`) stay untouched and authoritative for v1 packages;
 * v2 code paths resolve spaces here. The two-repo invariant is identical
 * in spirit: the `private` space lives in the companion private repository
 * and can NEVER be staged to the public repository, even temporarily.
 */

import { PathLayerError, type RepoKind } from "./layers";

export const PACKAGE_SPACES = [
  "study-guide",
  "slides",
  "practice",
  "concepts",
  "assessment-support",
  "assets",
  "current",
  "metadata",
  "provenance",
  "private",
] as const;

export type PackageSpace = (typeof PACKAGE_SPACES)[number];

/** Top-level directory for each space inside its repository.
 * `private` maps to `private/` — the private-repo root (package-layout.md §3). */
export const SPACE_DIR: Record<PackageSpace, string> = {
  "study-guide": "study-guide",
  slides: "slides",
  practice: "practice",
  concepts: "concepts",
  "assessment-support": "assessment-support",
  assets: "assets",
  current: "current",
  metadata: "metadata",
  provenance: "provenance",
  private: "private",
};

/** Which repository each space is stored in. */
export const SPACE_REPO: Record<PackageSpace, RepoKind> = {
  "study-guide": "public",
  slides: "public",
  practice: "public",
  concepts: "public",
  "assessment-support": "public",
  assets: "public",
  current: "public",
  metadata: "public",
  provenance: "public",
  private: "private",
};

const DIR_TO_SPACE = new Map<string, PackageSpace>(
  PACKAGE_SPACES.map((space) => [SPACE_DIR[space], space]),
);

/** Repo-root files valid in either repo. The manifest belongs to the
 * `metadata` space (every registered file has a space); the rest are
 * repo housekeeping, not package content. */
const ROOT_FILE_ALLOWLIST = new Set([
  "alembic.json",
  "README.md",
  "LICENSE",
  "CITATION.cff",
  ".gitignore",
]);

const ROOT_DIR_ALLOWLIST = new Set([".alembic", ".github"]);

/**
 * Resolve a repository-relative path to its contract-v2 space.
 * Any depth under a space directory belongs to that space
 * (`current/archive/2026-spring/quiz.pdf` → `current`). Root allowlisted
 * files resolve to `metadata`; throws for unknown locations (fail closed —
 * an unclassifiable path must never be committed). Reuses PathLayerError
 * so callers catch one error type across v1 and v2.
 */
export function spaceForPath(path: string): PackageSpace {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) {
    throw new PathLayerError(`Path traversal is not allowed: ${path}`, path);
  }
  const [first, ...rest] = normalized.split("/");
  if (!first) {
    throw new PathLayerError(`Empty path`, path);
  }
  if (rest.length === 0) {
    if (ROOT_FILE_ALLOWLIST.has(first)) return "metadata";
    throw new PathLayerError(
      `Root file "${first}" is not in the package contract allowlist`,
      path,
    );
  }
  if (ROOT_DIR_ALLOWLIST.has(first)) return "metadata";
  const space = DIR_TO_SPACE.get(first);
  if (!space) {
    throw new PathLayerError(
      `Directory "${first}" does not map to any package space`,
      path,
    );
  }
  return space;
}

/** True if the path is a repo-root allowlisted file/dir (valid in either
 * repo, like v1's null-layer paths). Used by the boundary check below. */
function isRootAllowlisted(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.includes("..")) return false;
  const [first, ...rest] = normalized.split("/");
  if (!first) return false;
  if (rest.length === 0) return ROOT_FILE_ALLOWLIST.has(first);
  return ROOT_DIR_ALLOWLIST.has(first);
}

export class SpaceBoundaryViolation extends Error {
  constructor(
    public readonly path: string,
    public readonly space: PackageSpace,
    public readonly targetRepo: RepoKind,
  ) {
    super(
      `Space "${space}" (path "${path}") belongs to the ${SPACE_REPO[space]} repository and must never be written to the ${targetRepo} repository`,
    );
    this.name = "SpaceBoundaryViolation";
  }
}

/**
 * The two-repo invariant, contract v2. Every v2 commit operation MUST pass
 * each file path through this check before staging. Throws on violation —
 * there is no override parameter by design. Same contract as v1's
 * `assertPathAllowedInRepo`: root allowlisted files (README, manifest, …)
 * are valid in either repo; everything else must match its space's repo.
 */
export function assertPathAllowedInRepoV2(path: string, repo: RepoKind): void {
  if (isRootAllowlisted(path)) return; // housekeeping file, valid in either repo
  const space = spaceForPath(path);
  if (SPACE_REPO[space] !== repo) {
    throw new SpaceBoundaryViolation(path, space, repo);
  }
}

/**
 * Map a v1 layer name to its v2 space (package-layout.md §7):
 * `materials`→`assets`, `private-instructor`→`private`, `objectives`→
 * `concepts` (objectives content folds into concept maps on migration);
 * names that exist in both map to themselves. Returns null for
 * `research-schema` — it has no v2 space (research event schemas are
 * platform bookkeeping, not educator content; they leave the package in
 * v2) — and for any unknown layer name (fail soft: migration code decides
 * what to do with unmapped content, this helper never guesses).
 */
export function spaceForV1Layer(layer: string): PackageSpace | null {
  switch (layer) {
    case "study-guide":
      return "study-guide";
    case "concepts":
      return "concepts";
    case "objectives":
      return "concepts";
    case "materials":
      return "assets";
    case "assessment-support":
      return "assessment-support";
    case "private-instructor":
      return "private";
    case "provenance":
      return "provenance";
    case "metadata":
      return "metadata";
    default:
      return null; // research-schema and anything unrecognized
  }
}
