/**
 * Repo-first write-through — the ONE write path
 * (docs/specs/storage-and-write-paths.md §3).
 *
 * Every writer (editor save, upload, replace, chapter/manifest op, populate)
 * funnels through `writeThrough`, which decides the storage branch in one
 * place:
 *
 * - **Published** package (a `Committer` is supplied): validate → commit to
 *   GitHub → *only then* project the very same changes into the store. If the
 *   commit fails, **nothing changed anywhere** and a typed, educator-facing
 *   error propagates. A save that didn't reach permanence didn't happen; the
 *   old `if (!gh) return` silent-skip pattern is abolished.
 * - **Trial** package (`committer === null`): the trial store IS the truth —
 *   write the DB only, `committed: false`.
 *
 * Purity: this module knows nothing about GitHub or Supabase. It depends on
 * the `PackageStore` seam and on the `Committer` seam, which the web layer
 * implements over `@alembic/github-bridge` (CLAUDE.md rules 3 and 5).
 */

import {
  assertPathAllowedInEitherContract,
  assertPublicMarkdownReferences,
  type RepoKind,
} from "@alembic/package-contract";
import type { PackageFile, PackageStore } from "./store";

/* -------------------------------------------------------------------------- *
 * Committer seam
 * -------------------------------------------------------------------------- */

export interface WriteThroughChange {
  repo: RepoKind;
  path: string;
  /** New file content; `null` means DELETE this path. */
  content: string | null;
  /** Omitted/"utf-8" → text. "base64" → binary bytes (never reference-scanned). */
  encoding?: "utf-8" | "base64";
}

export interface CommitPlanInput {
  repo: RepoKind;
  /** Educator-facing description; becomes the commit message. */
  summary: string;
  changes: Array<{
    path: string;
    content: string | null;
    encoding?: "utf-8" | "base64";
  }>;
}

/**
 * The permanent-store seam. The web layer supplies an implementation backed by
 * `@alembic/github-bridge`; package-ops never imports GitHub code itself.
 * Implementations MUST throw `CommitUnavailableError` when no GitHub
 * connection is available and `CommitFailedError` when a commit was attempted
 * and failed — never resolve on failure, and never partially apply.
 */
export interface Committer {
  commit(plan: CommitPlanInput): Promise<{ commitSha: string }>;
}

/** No GitHub connection for a published package — the write cannot be made
 *  permanent, so it is not made at all. Message is educator-facing. */
export class CommitUnavailableError extends Error {
  constructor(
    message = "This course isn't connected to its online copy right now, so the change wasn't saved. Reconnect and try again — nothing was lost.",
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CommitUnavailableError";
  }
}

/** A commit was attempted and failed. Nothing was changed anywhere; the
 *  educator can safely retry. Message is educator-facing. */
export class CommitFailedError extends Error {
  constructor(
    message = "Saving to the permanent copy of this course didn't go through, so nothing was changed. Please try again.",
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CommitFailedError";
  }
}

/* -------------------------------------------------------------------------- *
 * Validation — always FIRST, before any IO
 * -------------------------------------------------------------------------- */

/**
 * Text carriers whose public content can embed repo-relative references and so
 * must be reference-scanned. Mirrors `editor-edit.ts`'s TEXT_EXT exactly —
 * keep the two in sync.
 */
const TEXT_EXT = /\.(md|md\.html|html|svg)$/;

/**
 * Validate a whole change set against the contract. Throws on the first
 * offending change; no store or committer call has happened yet when it does.
 *
 * Two gates, matching what the existing writers (`editor-edit.ts`,
 * `slides.ts`, `github-bridge/validateCommitPlan`) already perform:
 *  1. the two-repo invariant, dual-mode (v1 layers OR v2 spaces) and
 *     fail-closed — a `private-instructor/…` (v1) or `private/…` (v2) path in
 *     a public change is rejected by both contracts;
 *  2. the public reference guard on public text carriers being written.
 */
export function validateChanges(changes: WriteThroughChange[]): void {
  const seen = new Set<string>();
  for (const change of changes) {
    // The repo must be one the contract knows. A value outside the union (it
    // can arrive from an untyped DB column, not only from bad TypeScript)
    // matches neither commit group below, so the change would be projected
    // into the store and NEVER committed — a silent local-only write, exactly
    // what this module exists to prevent. Root-allowlisted paths like
    // `alembic.json` short-circuit the path check, so this is the only guard.
    if (change.repo !== "public" && change.repo !== "private") {
      throw new Error(
        `Unknown repository "${String(change.repo)}" for ${change.path}.`,
      );
    }

    // One entry per (repo, path) per change set. The committer applies changes
    // in order while the projection applies puts then deletes, so a set that
    // both deleted and re-created a path would leave the repo and the
    // projection disagreeing. Rather than silently pick an order, refuse the
    // ambiguity: a change set names each path exactly once.
    const key = `${change.repo}:${change.path}`;
    if (seen.has(key)) {
      throw new Error(
        `${change.path} appears more than once in one change set.`,
      );
    }
    seen.add(key);

    assertPathAllowedInEitherContract(change.path, change.repo);
    if (
      change.repo === "public" &&
      change.content !== null &&
      change.encoding !== "base64" &&
      TEXT_EXT.test(change.path)
    ) {
      assertPublicMarkdownReferences(change.content);
    }
  }
}

/* -------------------------------------------------------------------------- *
 * writeThrough
 * -------------------------------------------------------------------------- */

export interface WriteThroughInput {
  changes: WriteThroughChange[];
  /** Educator-facing description of the change ("Save study guide", …). */
  summary: string;
}

export interface WriteThroughResult {
  /** True when the changes reached the permanent (GitHub) store. */
  committed: boolean;
  /** Public-repo commit sha, when a public commit was made (for recordSyncedSha). */
  commitSha?: string;
}

/** Project a validated change set into the store: upserts, then deletes. */
async function projectIntoStore(
  store: PackageStore,
  packageId: string,
  changes: WriteThroughChange[],
): Promise<void> {
  const puts: PackageFile[] = [];
  const dels: { repo: RepoKind; path: string }[] = [];
  for (const c of changes) {
    if (c.content === null) dels.push({ repo: c.repo, path: c.path });
    else puts.push({ repo: c.repo, path: c.path, content: c.content });
  }
  if (puts.length > 0) await store.putFiles(packageId, puts);
  if (dels.length > 0) await store.deleteFiles(packageId, dels);
}

/**
 * The single validated write path.
 *
 * Ordering is the whole point: validate → (published) commit → project.
 * A commit failure leaves the projection **completely untouched**, so the
 * educator's next read shows exactly what is permanently stored.
 *
 * Returns the PUBLIC repo's commit sha when there was a public commit —
 * callers hand it to `recordSyncedSha` so foreign-commit detection stays exact.
 */
export async function writeThrough(
  store: PackageStore,
  committer: Committer | null,
  packageId: string,
  input: WriteThroughInput,
): Promise<WriteThroughResult> {
  // 1. Validate everything before any IO. Fail-closed, all-or-nothing.
  validateChanges(input.changes);

  if (input.changes.length === 0) {
    return { committed: committer !== null };
  }

  // 2a. Trial package: the trial store IS the truth. DB only.
  if (committer === null) {
    await projectIntoStore(store, packageId, input.changes);
    return { committed: false };
  }

  // 2b. Published package: permanence first. Group by repo — public before
  // private, so the sha callers care about is produced deterministically —
  // and commit each group. Any throw propagates with the store untouched.
  let publicSha: string | undefined;
  for (const repo of ["public", "private"] as const) {
    const group = input.changes.filter((c) => c.repo === repo);
    if (group.length === 0) continue;
    const { commitSha } = await committer.commit({
      repo,
      summary: input.summary,
      changes: group.map((c) => ({
        path: c.path,
        content: c.content,
        ...(c.encoding ? { encoding: c.encoding } : {}),
      })),
    });
    if (repo === "public") publicSha = commitSha;
  }

  // 3. Only now project the committed changes into the derived cache.
  await projectIntoStore(store, packageId, input.changes);

  return publicSha === undefined
    ? { committed: true }
    : { committed: true, commitSha: publicSha };
}
