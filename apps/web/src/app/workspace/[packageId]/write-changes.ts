/**
 * The workspace actions' door onto the repo-first write path
 * (docs/specs/storage-and-write-paths.md §3).
 *
 * A server action that changes files does exactly three things now:
 *
 *   1. resolve the write path once — `committerFor(...)` (trial / github /
 *      unavailable);
 *   2. hand the resolution and the change set to `writeChanges` here;
 *   3. return `{ ok: false, error }` unchanged if it comes back not-ok.
 *
 * This module deliberately does NOT import `@/lib/committer` as a value: it
 * takes the already-resolved `CommitterResolution` as an argument (a *type*
 * import erases at compile time). That keeps it free of `server-only` /
 * Next-alias plumbing, so the whole ordering rule — unavailable refuses,
 * a failed commit projects nothing, a multi-file change set commits as one —
 * is unit-testable with an in-memory store (`write-changes.test.ts`).
 */

import {
  CommitFailedError,
  CommitUnavailableError,
  ManifestConflictError,
  writeThrough,
  type PackageStore,
  type WriteThroughChange,
} from "@alembic/package-ops";
import type { CommitterResolution } from "@/lib/committer";

/**
 * The educator-facing message for a write failure we know how to explain, or
 * `null` for anything else (a contract breach or a genuine bug — the caller
 * rethrows those rather than dressing them up as "please try again").
 *
 * Every message here is already educator-facing at the point it is
 * constructed; this never invents wording and never exposes a stack, a cause
 * chain, or Git vocabulary.
 */
export function writeErrorMessage(err: unknown): string | null {
  if (
    err instanceof CommitUnavailableError ||
    err instanceof CommitFailedError ||
    err instanceof ManifestConflictError
  ) {
    return err.message;
  }
  return null;
}

export type WriteChangesResult =
  | { ok: true; commitSha?: string }
  | { ok: false; error: string };

/**
 * Write a change set through the one validated path.
 *
 * - `unavailable` → **nothing is written**, in either store: a published
 *   package must never silently degrade to a DB-only write (spec §3). The
 *   resolution's own reason is returned verbatim.
 * - `trial` → the trial store is the truth; DB only.
 * - `github` → commit first, project only on success.
 *
 * All the changes of one educator action belong in ONE call: within a repo
 * they become a single commit, so a rename (write new + delete old) can no
 * longer half-land.
 */
export async function writeChanges(args: {
  store: PackageStore;
  resolution: CommitterResolution;
  packageId: string;
  changes: WriteThroughChange[];
  summary: string;
}): Promise<WriteChangesResult> {
  const { store, resolution, packageId, changes, summary } = args;
  if (resolution.kind === "unavailable") {
    return { ok: false, error: resolution.reason };
  }
  try {
    const result = await writeThrough(
      store,
      resolution.kind === "github" ? resolution.committer : null,
      packageId,
      { changes, summary },
    );
    return result.commitSha === undefined
      ? { ok: true }
      : { ok: true, commitSha: result.commitSha };
  } catch (err) {
    const message = writeErrorMessage(err);
    if (message) return { ok: false, error: message };
    throw err;
  }
}
