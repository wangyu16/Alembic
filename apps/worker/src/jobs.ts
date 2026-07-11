/**
 * Job contracts for the worker tier.
 *
 * The queue transport (pg-boss on Supabase Postgres) arrives in M6. The job
 * payload shapes are the contract; the web app enqueues by shape, the worker
 * consumes by shape, and local dev may run handlers in-process instead.
 */

import { rendererVersion } from "@alembic/renderer";
import { generateSelfContained, type DocMeta } from "@alembic/generators";

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

/**
 * Tier-B coherence-agent run (Roadmap Phase 3). The job *contract* is the
 * forward-compatible seam: today the agent runs in-process inside the web server
 * action (`runCoherenceAgentAction`), gated by the governed provider (rate limit
 * + per-user token budget). When the container worker tier matures, the SAME job
 * shape moves there — callers and the produced data (a `ProposedChangeSet` routed
 * into the Tier-2 review queue) don't change. No parallel write path.
 */
export interface AgentRunJob {
  type: "agent-run";
  packageId: string;
  /** Platform user the run is attributed to (governance + quota). */
  requestedBy: string;
  /** What the educator asked the agent to review/do. */
  task: string;
}

export interface AgentRunResult {
  ok: boolean;
  /** Number of block-level changes queued for Tier-2 review. */
  queued: number;
  /** Educator-facing summary on failure — never a raw stack trace. */
  message?: string;
}

/**
 * Generate a self-contained orz-family file (`.md.html` / `.slides.html` /
 * `.paged.html`). Runs in the worker because the upstream generators are
 * Node-only and read package assets from disk — a poor fit for Vercel
 * serverless (whose file tracing wouldn't ship those assets). Fast
 * (sub-second), so the worker serves it synchronously over HTTP rather than
 * via the async queue. The produced file carries the in-file editor + the
 * `orz-host-save` protocol; the source stays extractable via `@alembic/carriers`.
 */
export interface GenerateFileJob {
  type: "generate-file";
  kind: "md" | "slides" | "paged";
  /** orz-markdown source (with the format's layout syntax where relevant). */
  markdown: string;
  title?: string;
  /** orz theme id, passed through (unknown → the tool's default). */
  theme?: string;
  /** Framework delivery: `inline` (default) or `cdn` (small file). */
  delivery?: "inline" | "cdn";
  /** Document metadata (license, author, source …) for the file's <head>. */
  metadata?: DocMeta;
}

export interface GenerateFileResult {
  ok: boolean;
  /** The full self-contained document, when ok. */
  html?: string;
  /** Educator-facing message on failure — never a raw stack trace. */
  message?: string;
}

export type WorkerJob = BuildSiteJob | AgentRunJob | GenerateFileJob;

/** M6 implements checkout → orz-markdown build → Pages push. */
export async function handleBuildSite(job: BuildSiteJob): Promise<BuildResult> {
  return {
    ok: false,
    rendererVersion: rendererVersion(),
    message: `Build for ${job.packageId} not implemented yet (M6)`,
  };
}

/** Generate a self-contained file via the upstream generators. */
export async function handleGenerateFile(job: GenerateFileJob): Promise<GenerateFileResult> {
  try {
    const html = await generateSelfContained({
      kind: job.kind,
      markdown: job.markdown,
      title: job.title,
      theme: job.theme,
      delivery: job.delivery,
      metadata: job.metadata,
    });
    return { ok: true, html };
  } catch (err) {
    return {
      ok: false,
      message: `Couldn't generate the ${job.kind} file.`,
    };
  }
}

/**
 * Worker-tier entry point for an agent run. Deferred: the bounded agent needs a
 * package store + governed AIProvider, which live app-side today, so execution
 * stays in-process (web action). This stub marks the seam for the worker tier.
 */
export async function handleAgentRun(job: AgentRunJob): Promise<AgentRunResult> {
  return {
    ok: false,
    queued: 0,
    message: `Worker-tier agent run for ${job.packageId} not implemented yet (runs in-process via the web action; M19/Phase-3 worker tier)`,
  };
}
