/**
 * The web app's `Committer` — the one seam through which write-through reaches
 * GitHub. See docs/specs/storage-and-write-paths.md §3 (repo-first
 * write-through).
 *
 * Two things live here:
 *
 *  1. `committerFor(...)` — decides, in ONE place, which write path a package
 *     is on: `trial` (the DB is the truth), `github` (commit first, then
 *     project), or `unavailable` (it IS GitHub-backed but we cannot reach
 *     GitHub right now). The third case is the whole point: a published
 *     package must NEVER silently degrade to a DB-only write. The old
 *     `if (!gh) return;` pattern is abolished — a save that didn't reach
 *     permanence didn't happen, and the educator is told so.
 *
 *  2. The `Committer` implementation itself, which goes through
 *     `commitFiles` from `@alembic/github-bridge` (rule 5: the bridge is the
 *     only code that talks to GitHub — there is no second transport here) and
 *     records the resulting SHA for public commits so reconcile's
 *     foreign-commit detection stays exact.
 *
 * Deliberately NOT a replacement for `github.ts`: this module reuses
 * `clientForUser` / `syncedShaFor` / `recordOwnCommit` from there. Wave 1 migrated callers off
 * the old `syncFilesToGitHub` helpers (since removed); this file is the door.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  commitFiles,
  RemoteChangedError,
  validateCommitPlan,
  type CommitPlan,
  type RepoCoords,
} from "@alembic/github-bridge";
import {
  CommitFailedError,
  CommitUnavailableError,
  type Committer,
  type PackageStore,
} from "@alembic/package-ops";
import type { GitHubClient } from "@alembic/github-bridge";
import { clientForUser, recordOwnCommit, syncedShaFor } from "./github";
import { recordedPrivateRepo, recordedPublicRepo } from "./recorded-repo";

/**
 * Which write path this package is on. Callers branch on `kind` and never
 * infer it themselves.
 *
 * - `trial`      → pass `null` as the committer to `writeThrough`; the trial
 *                  store IS the truth for this package.
 * - `github`     → published: commit first, then project.
 * - `unavailable`→ published but unreachable: refuse the write and show
 *                  `reason` to the educator. Never fall back to `trial`.
 */
export type CommitterResolution =
  | { kind: "trial" }
  | { kind: "github"; committer: Committer }
  | { kind: "unavailable"; reason: string };

/** Educator-facing copy — no Git/developer vocabulary (see CLAUDE.md). */
const NOT_CONNECTED =
  "This package is published, so saving means saving to its online home — " +
  "and that connection isn't available right now. Reconnect publishing from " +
  "the package menu, then try again. Nothing was changed.";

const MISSING_HOME =
  "This package is published but its online home is missing, so this change " +
  "can't be saved. Reconnect publishing from the package menu, then try " +
  "again. Nothing was changed.";

/** Loop r2 (P5.B.3.f): the save would overwrite something changed outside. */
const CHANGED_OUTSIDE =
  "This course was changed outside Alembic since your last save, so this " +
  "change wasn't saved — nothing was changed. Use \u201cCheck for outside " +
  "changes\u201d to bring those changes in first, then try again.";

const SAVE_FAILED =
  "We couldn't save this change to the package's online home. " +
  "Nothing was changed — please try again in a moment.";

const MISSING_PACKAGE =
  "We couldn't find this package, so nothing was changed. Reload the page and " +
  "try again.";

/**
 * Resolve the write path for a package.
 *
 * A missing package record resolves to `unavailable`, not `trial`: "we don't
 * know what this is" must never be answered with "then write to the DB".
 * Fail-closed is the rule on every branch here.
 */
export async function committerFor(
  supabase: SupabaseClient,
  store: PackageStore,
  userId: string,
  packageId: string,
): Promise<CommitterResolution> {
  const record = await store.getPackage(packageId);
  if (!record) return { kind: "unavailable", reason: MISSING_PACKAGE };
  if (record.storage !== "github") return { kind: "trial" };

  // The publish-recorded repos, never the owner-writable manifest fields
  // (security loop r2, P5.S.3.e).
  const publicRepo = recordedPublicRepo(record);
  const privateRepo = recordedPrivateRepo(record);
  if (!publicRepo) return { kind: "unavailable", reason: MISSING_HOME };

  const gh = await clientForUser(supabase, userId);
  if (!gh) return { kind: "unavailable", reason: NOT_CONNECTED };

  return {
    kind: "github",
    committer: githubCommitter({
      supabase,
      packageId,
      client: gh.client,
      publicRepo: { owner: publicRepo.owner, repo: publicRepo.name },
      privateRepo: privateRepo
        ? { owner: privateRepo.owner, repo: privateRepo.name }
        : null,
    }),
  };
}

/**
 * A `Committer` bound to one package's repo pair and one authenticated client.
 * Exported for tests and for callers that already hold a client; normal code
 * goes through `committerFor`.
 */
export function githubCommitter(args: {
  supabase: SupabaseClient;
  packageId: string;
  client: GitHubClient;
  publicRepo: RepoCoords;
  /** Null when the package has no private repo recorded yet. */
  privateRepo: RepoCoords | null;
}): Committer {
  const { supabase, packageId, client, publicRepo, privateRepo } = args;

  return {
    async commit(plan) {
      const coords = plan.repo === "private" ? privateRepo : publicRepo;
      if (!coords) {
        // No physical repo to route this to. Not a failure of an attempted
        // commit — nothing was attempted — so it is "unavailable".
        throw new CommitUnavailableError(MISSING_HOME);
      }

      const commitPlan: CommitPlan = {
        repo: plan.repo,
        summary: plan.summary,
        changes: plan.changes,
      };

      // Validate OUTSIDE the try. A two-repo invariant violation (a private
      // path in a public plan) is a contract breach, not a retryable network
      // failure: it must surface as its own typed error and must never be
      // laundered into "try again". `commitFiles` re-validates fail-closed;
      // this call only makes sure the boundary error escapes untouched.
      validateCommitPlan(commitPlan);

      // Public saves are guarded against changes made outside Alembic since
      // the synced point (loop r2, P5.B.3.f): the bridge refuses — writing
      // nothing — when such a change touched a file this save writes, and
      // the pointer only advances when nothing sits in between.
      let synced: string | null = null;
      if (plan.repo === "public") {
        try {
          synced = await syncedShaFor(supabase, packageId);
        } catch (err) {
          console.warn(`[commit] ${packageId}: synced point unreadable:`, err instanceof Error ? err.message : err);
          throw new CommitFailedError(SAVE_FAILED);
        }
      }

      let result: { commitSha: string; parentSha: string };
      try {
        result = await commitFiles(
          client,
          coords,
          commitPlan,
          "main",
          plan.repo === "public" ? { unchangedSince: synced } : {},
        );
      } catch (err) {
        if (err instanceof RemoteChangedError) {
          console.warn(
            `[commit] ${coords.owner}/${coords.repo}: refused, changed outside Alembic (${err.reason}):`,
            err.paths.join(", "),
          );
          throw new CommitFailedError(CHANGED_OUTSIDE, err);
        }
        // Only the message is passed on: the underlying text is a raw GitHub
        // API string — method, path, HTTP status, and a JSON body like
        // `{"message":"GitRPC::BadObjectState"}`. Twelve call sites
        // re-surface this message to educators, so appending it put developer
        // diagnostics in front of people who have never seen a repository.
        // Log it for us; show plain language to them.
        console.warn(
          `[commit] ${coords.owner}/${coords.repo} (${plan.repo}) failed:`,
          err instanceof Error ? err.message : err,
        );
        throw new CommitFailedError(SAVE_FAILED);
      }

      if (plan.repo === "public") {
        // Best-effort ON PURPOSE (inside `recordOwnCommit`): the commit
        // already succeeded, so reporting a failure here would be a lie. A
        // pointer left behind is self-healing — reconcile sees the commits
        // after it as foreign and absorbs them in the repo→projection
        // direction, which is the correct outcome.
        try {
          await recordOwnCommit(supabase, packageId, synced, result);
        } catch {
          // Intentionally swallowed; see above.
        }
      }

      return { commitSha: result.commitSha };
    },
  };
}
