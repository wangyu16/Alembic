/**
 * Job contracts for the worker tier.
 *
 * The queue transport (pg-boss on Supabase Postgres) arrives in M6. The job
 * payload shapes are the contract; the web app enqueues by shape, the worker
 * consumes by shape, and local dev may run handlers in-process instead.
 */

import { rendererVersion } from "@alembic/renderer";

export interface BuildSiteJob {
  type: "build-site";
  packageId: string;
  /** Public repo, owner/name — the worker checks out an ephemeral copy. */
  repo: { owner: string; name: string };
  /** Commit SHA to build, so builds are reproducible records. */
  ref: string;
}

export interface BuildResult {
  ok: boolean;
  rendererVersion: string;
  /** Educator-facing message on failure — never a raw stack trace. */
  message?: string;
}

export type WorkerJob = BuildSiteJob;

/** M6 implements checkout → orz-markdown build → Pages push. */
export async function handleBuildSite(job: BuildSiteJob): Promise<BuildResult> {
  return {
    ok: false,
    rendererVersion: rendererVersion(),
    message: `Build for ${job.packageId} not implemented yet (M6)`,
  };
}
