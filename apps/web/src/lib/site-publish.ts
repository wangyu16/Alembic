/**
 * The pure core of "Publish website" (site-actions `publishSiteAction`):
 * build the course hub and put the whole site on the Pages branch, recording
 * in the publish outcome whether anything actually changed.
 *
 * Factored out of the server action so the end-to-end idempotence promise —
 * "publishing the same course twice makes no second commit and the educator
 * is told the site was already up to date" (P5.B.2.a / P5.B.2.h) — is
 * testable without Next, Supabase or the worker.
 */
import { buildCourseSite, type CourseSiteInput, type SiteFile } from "@alembic/renderer";
import type { GitHubClient, RepoCoords } from "@alembic/github-bridge";
import type { PublishOutcome } from "./publish-report";

export const PAGES_BRANCH = "gh-pages";

/**
 * The course hub files for one publish. `now` only feeds the copyright-year
 * fallback; the deployed tree carries no build timestamp, so the same course
 * built twice is byte-identical and the second publish is a no-op.
 */
export function courseSiteFiles(input: Omit<CourseSiteInput, "builtAt">, now: Date = new Date()): SiteFile[] {
  return buildCourseSite({ ...input, builtAt: now.toISOString() });
}

/**
 * Replace the Pages branch with `files` (one root commit, or nothing when the
 * branch already holds exactly this site) and record `unchanged` on the outcome
 * so the report can say "already up to date".
 */
export async function pushCourseSite(
  client: Pick<GitHubClient, "publishToBranch">,
  coords: RepoCoords,
  files: Array<{ path: string; content: string; encoding?: "utf-8" | "base64" }>,
  outcome: PublishOutcome,
): Promise<{ commitSha: string; unchanged: boolean }> {
  const pushed = await client.publishToBranch({
    coords,
    branch: PAGES_BRANCH,
    message: "Build site (Alembic)",
    files,
  });
  outcome.unchanged = pushed.unchanged;
  return pushed;
}
