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
  type ReconcileOutcome,
} from "@alembic/package-ops";
import type { GitHubClient } from "@alembic/github-bridge";
import { clientForUser, reconcilePackage, recordOwnCommit, syncedShaFor } from "./github";
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

/**
 * Loop r2 (P5.B.3.f): the save would overwrite something changed outside,
 * and the outside change could not be brought in automatically just now.
 * Names the control on the course's edit page (publish header →
 * "Check for outside changes", loop r3).
 */
export const CHANGED_OUTSIDE =
  "This course was changed outside Alembic since your last save, so this " +
  "change wasn't saved — nothing was changed. Use \u201cCheck for outside " +
  "changes\u201d at the top of the course page to bring those changes in " +
  "first, then try again.";

/** Loop r3 (P5.B.3.g): the outside change touched this file and has now been
 *  brought in; the educator's edit was made on the old version. */
export const CHANGED_OUTSIDE_BROUGHT_IN =
  "This course was changed outside Alembic since your last save. Those " +
  "changes have now been brought into Alembic \u2014 reopen the file to see " +
  "them, then make your change again. Nothing from this save was written.";

/** Loop r3: the outside change cannot be brought in (it breaks the course's
 *  rules), so saves of the files it touched stay blocked until it is fixed. */
export const CHANGED_OUTSIDE_HELD_BACK =
  "This course was changed outside Alembic, and those changes can't be " +
  "brought in automatically, so this change wasn't saved \u2014 nothing was " +
  "changed. Use \u201cCheck for outside changes\u201d at the top of the " +
  "course page to see what needs fixing.";

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
      // Loop r3 (P5.B.3.g): a refused save brings the outside change in.
      reconcile: () => reconcilePackage(supabase, store, userId, packageId),
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
  /**
   * Bring outside changes in (`reconcilePackage`), run when a public save is
   * refused as changed-outside (loop r3, P5.B.3.g). Absent → plain refusal.
   */
  reconcile?: () => Promise<ReconcileOutcome | null>;
}): Committer {
  const { supabase, packageId, client, publicRepo, privateRepo, reconcile } = args;

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

      const attempt = (since: string | null) =>
        commitFiles(
          client,
          coords,
          commitPlan,
          "main",
          plan.repo === "public" ? { unchangedSince: since } : {},
        );

      let result: { commitSha: string; parentSha: string };
      try {
        result = await attempt(synced);
      } catch (err) {
        if (!(err instanceof RemoteChangedError)) throw saveFailed(coords, plan.repo, err);
        console.warn(
          `[commit] ${coords.owner}/${coords.repo}: refused, changed outside Alembic (${err.reason}):`,
          err.paths.join(", "),
        );
        // Loop r3 (P5.B.3.g): never a dead end. Bring the outside change in
        // now; if none of THIS save's files really differ from what Alembic
        // already has (the "outside" commit was Alembic's own — a second tab,
        // or a pointer write that failed), the synced point has moved and the
        // save is retried once. Otherwise refuse — but the outside version is
        // now in Alembic, so the educator can reopen and redo the change.
        const outcome = reconcile
          ? await Promise.resolve()
              .then(reconcile)
              .catch((e: unknown) => {
                console.warn(`[commit] ${packageId}: reconcile after refusal failed:`, e instanceof Error ? e.message : e);
                return null;
              })
          : null;
        if (!outcome) throw new CommitFailedError(CHANGED_OUTSIDE, err);
        if (outcome.status === "quarantined") throw new CommitFailedError(CHANGED_OUTSIDE_HELD_BACK, err);
        if (outcome.status === "absorbed") {
          const ours = new Set(commitPlan.changes.map((c) => c.path));
          if (outcome.changedPaths.some((p) => ours.has(p))) {
            throw new CommitFailedError(CHANGED_OUTSIDE_BROUGHT_IN, err);
          }
        }
        try {
          synced = await syncedShaFor(supabase, packageId);
          result = await attempt(synced);
        } catch (again) {
          if (again instanceof RemoteChangedError) {
            console.warn(`[commit] ${coords.owner}/${coords.repo}: refused again after reconcile (${again.reason})`);
            throw new CommitFailedError(CHANGED_OUTSIDE, again);
          }
          throw saveFailed(coords, plan.repo, again);
        }
      }

      if (plan.repo === "public") {
        // Best-effort ON PURPOSE (inside `recordOwnCommit`): the commit
        // already succeeded, so reporting a failure here would be a lie. A
        // pointer left behind is self-healing — the next refused save
        // reconciles, finds Alembic's own commit already in the store, and
        // retries (loop r3, P5.B.3.g).
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

/**
 * A commit attempt that failed for any reason other than an outside change.
 * Only the message is passed on: the underlying text is a raw GitHub API
 * string — method, path, HTTP status, and a JSON body like
 * `{"message":"GitRPC::BadObjectState"}`. Twelve call sites re-surface this
 * message to educators, so appending it put developer diagnostics in front
 * of people who have never seen a repository. Log it for us; show plain
 * language to them.
 */
function saveFailed(coords: RepoCoords, repo: "public" | "private", err: unknown): CommitFailedError {
  console.warn(
    `[commit] ${coords.owner}/${coords.repo} (${repo}) failed:`,
    err instanceof Error ? err.message : err,
  );
  return new CommitFailedError(SAVE_FAILED);
}
