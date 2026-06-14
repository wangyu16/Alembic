/**
 * GitHub bridge — the only code that talks to GitHub.
 *
 * Every commit passes the package-contract path invariant before anything
 * touches the transport (`validateCommitPlan`). There is deliberately no way
 * to skip validation: `commitFiles` calls it first and has no override.
 */

import {
  assertPathAllowedInRepo,
  type RepoKind,
} from "@alembic/package-contract";
import { GitHubClient, type RepoCoords } from "./client";

export * from "./http";
export * from "./app-auth";
export * from "./client";

export interface FileChange {
  path: string;
  /** UTF-8 content; null means delete. */
  content: string | null;
}

export interface CommitPlan {
  repo: RepoKind;
  /** Educator-facing description; becomes a readable commit message. */
  summary: string;
  changes: FileChange[];
}

/**
 * Validate a commit plan against the two-repo invariant.
 * Throws RepoBoundaryViolation / PathLayerError on the first offending path.
 */
export function validateCommitPlan(plan: CommitPlan): void {
  for (const change of plan.changes) {
    assertPathAllowedInRepo(change.path, plan.repo);
  }
}

/**
 * Commit a validated file set to a repository as a single commit. The plan's
 * `repo` kind is re-checked against the invariant before any network call;
 * the caller maps that kind to the correct physical repository.
 */
export async function commitFiles(
  client: GitHubClient,
  coords: RepoCoords,
  plan: CommitPlan,
  branch = "main",
): Promise<{ commitSha: string }> {
  validateCommitPlan(plan); // fail-closed, before the transport
  return client.createCommitOnBranch({
    coords,
    branch,
    message: plan.summary,
    files: plan.changes,
  });
}
