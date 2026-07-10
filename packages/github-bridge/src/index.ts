/**
 * GitHub bridge — the only code that talks to GitHub.
 *
 * Every commit passes the package-contract path invariant before anything
 * touches the transport (`validateCommitPlan`). There is deliberately no way
 * to skip validation: `commitFiles` calls it first and has no override.
 */

import {
  assertPathAllowedInEitherContract,
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
 *
 * Uses the DUAL-MODE check (v1 layers OR v2 spaces) so a native-v2 path — most
 * urgently `current/`, which has no v1 layer at all — can be committed. This
 * is NOT a loosening of the invariant, and it is not an override (rule 1: no
 * bypass exists, and `commitFiles` still calls this first with no opt-out):
 * the dual-mode check fails closed, rejecting any path that BOTH contracts
 * reject, and a private-space path (`private-instructor/…` v1, `private/…` v2)
 * is rejected for the public repo by both.
 *
 * The OR is only safe because no directory is public under one contract and
 * private under the other. That property was unstated; it is now pinned by
 * `contract-agreement.test.ts` in package-contract, which fails loudly if a
 * future space ever disagrees. Read that test before touching this line.
 */
export function validateCommitPlan(plan: CommitPlan): void {
  for (const change of plan.changes) {
    assertPathAllowedInEitherContract(change.path, plan.repo);
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
