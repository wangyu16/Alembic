/**
 * GitHub bridge (M5 implements the GitHub App + Octokit transport).
 *
 * M0 establishes the commit-plan shape and the enforcement point: every file
 * in a commit plan passes the package-contract path invariant before anything
 * touches a transport. There is deliberately no way to skip validation.
 */

import {
  assertPathAllowedInRepo,
  type RepoKind,
} from "@alembic/package-contract";

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
 * Transports (M5) must call this before staging anything.
 */
export function validateCommitPlan(plan: CommitPlan): void {
  for (const change of plan.changes) {
    assertPathAllowedInRepo(change.path, plan.repo);
  }
}
