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
  parseManifest,
  sha256Hex,
  type RepoKind,
} from "@alembic/package-contract";
import type { RegistrationRecord } from "@alembic/package-contract";
import { registerChangedFiles } from "./document-registry";
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
  /**
   * Registry hint only (never committed): this file was moved/renamed FROM
   * this path in the same repo, in this same change set (which must also
   * delete that path). Its permalink identity travels here — explicitly, not
   * by guessing from content hashes (loop r1b, P5.B.1.m).
   */
  movedFrom?: string;
  /**
   * Loop r4 (P5.B.3.m): the SHA-256 (hex, of the UTF-8 text — the stored
   * `content_sha256`) of the stored copy the editor LOADED; `null` = the file
   * did not exist when it was opened. When given, the write is refused
   * (`FileChangedSinceOpenedError`, nothing written) if the stored copy is no
   * longer that version — another tab's save, or an outside change brought
   * in since. Omitted = no check (writers that do not edit a loaded copy).
   */
  baseHash?: string | null;
}

/** Educator-facing: the stored copy moved on since the editor opened it. */
export const FILE_CHANGED_SINCE_OPENED =
  "This file changed since you opened it \u2014 reload to see the newer version. " +
  "Nothing from this save was written.";

/**
 * Loop r4 (P5.B.3.m): a save was based on a version of a file that is no
 * longer the stored one. Not retryable with the same content — the educator
 * reloads first. Nothing was written anywhere.
 */
export class FileChangedSinceOpenedError extends Error {
  readonly retryable = false;
  constructor(readonly paths: string[], message = FILE_CHANGED_SINCE_OPENED) {
    super(message);
    this.name = "FileChangedSinceOpenedError";
  }
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
  /**
   * Loop r4 (P5.B.3.m): re-verifies the save's preconditions (the stored
   * copies its edits were based on). Throws `FileChangedSinceOpenedError`.
   * A committer calls it after reading its synced point and again before any
   * retry, so a retry after bringing outside changes in can never write over
   * a version the educator has not seen.
   */
  recheck?: () => Promise<void>;
  /**
   * Loop r4 (P5.B.3.l): the head the educator has SEEN and chosen to
   * overwrite ("keep Alembic's version"): changes up to it are not a reason to
   * refuse; anything after it still is.
   */
  overwriteSeenAt?: string;
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

/**
 * The course details file. Its ONE owner is `updateManifest`
 * (`manifest-ops.ts`, which re-exports this as `MANIFEST_PATH`): read → patch →
 * commit → compare-and-swap. It never goes through `writeThrough` itself.
 */
export const MANIFEST_FILE = "alembic.json";

/**
 * A write that would leave the course details file broken or unowned (loop r3,
 * P5.B.1.y). Not retryable with the same content. Educator-facing message.
 */
export class ManifestFileRefusedError extends Error {
  readonly retryable = false;
  constructor(
    message = "The course details couldn't be saved this way. Change them in the course settings instead.",
  ) {
    super(message);
    this.name = "ManifestFileRefusedError";
  }
}

/**
 * Loop r3 (P5.B.1.y): the gate every `alembic.json` change in `writeThrough`
 * passes. Only the whole-course upload legitimately writes the manifest as a
 * FILE (everything else uses `updateManifest`); what it writes must be a valid
 * course manifest for THIS course. Invalid JSON, a manifest the schema refuses,
 * one naming another course, or a deletion would be stored and then make every
 * later `updateManifest` fail forever — so they are refused before any commit.
 */
function assertManifestChange(change: WriteThroughChange, packageId: string | undefined): void {
  if (change.repo !== "public" || change.path !== MANIFEST_FILE) return;
  if (change.content === null) {
    throw new ManifestFileRefusedError(
      "The course details file can't be removed — every course needs one.",
    );
  }
  const invalid = new ManifestFileRefusedError(
    "These course details aren't valid, so nothing was saved. Change them in the course settings instead.",
  );
  if (change.encoding === "base64") throw invalid;
  let manifest: { packageId: string };
  try {
    manifest = parseManifest(JSON.parse(change.content));
  } catch {
    throw invalid;
  }
  if (packageId !== undefined && manifest.packageId !== packageId) throw invalid;
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
 *  2. the public reference guard on public text carriers being written;
 *  3. (loop r3, P5.B.1.y) the course details file is a valid manifest for
 *     this course and is never deleted — see `assertManifestChange`.
 */
export function validateChanges(
  changes: WriteThroughChange[],
  /** The package being written — the course details file must name it. */
  packageId?: string,
): void {
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
    assertManifestChange(change, packageId);
    if (change.movedFrom !== undefined) {
      const from = changes.find(
        (c) => c.repo === change.repo && c.path === change.movedFrom,
      );
      if (change.content === null || !from || from.content !== null) {
        throw new Error(
          `${change.path} names ${change.movedFrom} as where it moved from, but this change set does not delete it.`,
        );
      }
    }
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
  /** Which door the files came through, for their registration (default
   *  "created"; the whole-package upload passes "uploaded"). */
  origin?: RegistrationRecord["origin"];
  /** See `CommitPlanInput.overwriteSeenAt` (public commit only). */
  overwriteSeenAt?: string;
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
 * Register what a write just landed, when the store carries a registry
 * (loop r1b, P5.B.1.m): part of the ONE write path, so every caller's files
 * are registered and no caller can forget. Best-effort, like every registry
 * call — the registry is a rebuildable projection and a registry hiccup must
 * never fail an educator's save that already reached permanence; the
 * page-load content check (`registryDrift`) heals whatever this misses.
 */
export async function registerWritten(
  store: PackageStore,
  packageId: string,
  changes: ReadonlyArray<WriteThroughChange>,
  origin: RegistrationRecord["origin"] = "created",
): Promise<void> {
  if (!store.registry || changes.length === 0) return;
  try {
    await registerChangedFiles(
      store.registry,
      store,
      packageId,
      changes.map((c) => ({
        repo: c.repo,
        path: c.path,
        content: c.content,
        ...(c.movedFrom !== undefined ? { movedFrom: c.movedFrom } : {}),
      })),
      origin,
    );
  } catch (err) {
    console.warn(
      `[registry] register failed for ${packageId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Loop r4 (P5.B.3.m): the stored copy of every change that names a `baseHash`
 * is still that version. Returns what is stored now, per change key, so a
 * trial write can compare-and-set against exactly it.
 */
async function assertBases(
  store: PackageStore,
  packageId: string,
  changes: ReadonlyArray<WriteThroughChange>,
): Promise<Map<string, string | null>> {
  const now = new Map<string, string | null>();
  const stale: string[] = [];
  for (const c of changes) {
    if (c.baseHash === undefined) continue;
    const stored = await store.readFile(packageId, c.repo, c.path);
    now.set(`${c.repo}:${c.path}`, stored);
    const hash = stored === null ? null : await sha256Hex(stored);
    if (hash !== c.baseHash) stale.push(c.path);
  }
  if (stale.length > 0) throw new FileChangedSinceOpenedError(stale);
  return now;
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
  validateChanges(input.changes, packageId);

  if (input.changes.length === 0) {
    return { committed: committer !== null };
  }

  // Loop r4 (P5.B.3.m): an edit is refused when the copy it was based on is
  // no longer the stored one — checked before any IO, and again by the
  // committer before it commits and before any retry.
  const based = input.changes.filter((c) => c.baseHash !== undefined);
  const stored = based.length > 0 ? await assertBases(store, packageId, based) : null;

  // 2a. Trial package: the trial store IS the truth. DB only — and an edit
  // based on a loaded copy lands by compare-and-set against it.
  if (committer === null) {
    for (const c of based) {
      const expected = stored!.get(`${c.repo}:${c.path}`) ?? null;
      const outcome =
        c.content === null
          ? expected === null
            ? "ok"
            : store.deleteFileIf
              ? await store.deleteFileIf(packageId, { repo: c.repo, path: c.path }, { content: expected })
              : (await store.deleteFiles(packageId, [{ repo: c.repo, path: c.path }]), "ok" as const)
          : await store.replaceFileIf(
              packageId,
              { repo: c.repo, path: c.path, content: c.content },
              expected === null ? null : { content: expected },
            );
      if (outcome === "conflict") throw new FileChangedSinceOpenedError([c.path]);
    }
    await projectIntoStore(
      store,
      packageId,
      input.changes.filter((c) => c.baseHash === undefined),
    );
    await registerWritten(store, packageId, input.changes, input.origin);
    return { committed: false };
  }
  const recheck = based.length > 0 ? async () => void (await assertBases(store, packageId, based)) : undefined;

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
      ...(recheck ? { recheck } : {}),
      ...(repo === "public" && input.overwriteSeenAt ? { overwriteSeenAt: input.overwriteSeenAt } : {}),
    });
    if (repo === "public") publicSha = commitSha;
  }

  // 3. Only now project the committed changes into the derived cache.
  await projectIntoStore(store, packageId, input.changes);
  // 4. Register what landed (the registry is part of the projection).
  await registerWritten(store, packageId, input.changes, input.origin);

  return publicSha === undefined
    ? { committed: true }
    : { committed: true, commitSha: publicSha };
}
