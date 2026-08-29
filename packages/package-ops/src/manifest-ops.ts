/**
 * The ONE manifest owner (docs/specs/storage-and-write-paths.md §3,
 * "one manifest owner").
 *
 * The manifest FILE (`alembic.json` in the public repo) is authoritative; the
 * `packages.manifest` DB column is a derived read cache that no writer may use
 * as input. Every manifest mutation goes through `updateManifest`, which:
 *
 *   read the file → patch → **commit** (published) → **compare-and-swap** the
 *   projection against the content we read → retry on conflict
 *
 * The CAS is what kills lost updates: two tabs each adding a chapter used to
 * read-modify-write over one another; now the loser re-reads the winner's
 * manifest, re-applies its own patch, and both changes survive.
 *
 * package-ops stays free of Supabase specifics: the caller receives the final
 * manifest and refreshes the `packages.manifest` column at the WEB layer.
 */

import {
  assertPathAllowedInEitherContract,
  parseManifest,
  type PackageManifest,
} from "@alembic/package-contract";
import type { PackageStore } from "./store";
import type { Committer } from "./write-through";

/** Repo-relative path of the manifest file, in the public repo. */
export const MANIFEST_PATH = "alembic.json";

/** Serialize a manifest exactly as every other writer in the codebase does —
 *  2-space JSON with a trailing newline. The CAS compares this byte-for-byte,
 *  so the formatting is part of the contract. */
export function serializeManifest(manifest: PackageManifest): string {
  return JSON.stringify(manifest, null, 2) + "\n";
}

/** Two writers changed the same course at the same time and the retries were
 *  exhausted. Educator-facing message — never surfaces Git or CAS wording. */
export class ManifestConflictError extends Error {
  constructor(
    message = "Someone (or another tab) changed this course at the same time. Reload and try again.",
  ) {
    super(message);
    this.name = "ManifestConflictError";
  }
}

/** The package has no manifest file to update — a broken package, not a race. */
export class ManifestNotFoundError extends Error {
  constructor(packageId: string) {
    super(
      `This course's details file is missing, so the change couldn't be saved (package ${packageId}).`,
    );
    this.name = "ManifestNotFoundError";
  }
}

export interface UpdateManifestOptions {
  /** Educator-facing commit summary (published packages only). */
  summary?: string;
  /** CAS attempts before giving up. Default 3. */
  maxAttempts?: number;
}

export interface UpdateManifestResult {
  /** The manifest as it now stands — the WEB layer refreshes its read cache
   *  (the `packages.manifest` column) from this. */
  manifest: PackageManifest;
  /** Public-repo commit sha, when a commit was made (for `recordSyncedSha`). */
  commitSha?: string;
}

/**
 * Apply `patch` to the package manifest, durably and without lost updates.
 *
 * Ordering matches the write-through rule: for a published package the commit
 * happens FIRST, so a failed commit leaves nothing changed anywhere; only then
 * is the projection updated conditionally. If the CAS conflicts *after* a
 * successful commit, the loop re-reads, re-patches and re-commits — the repo
 * converges on a manifest containing both writers' changes.
 *
 * `committer === null` (trial package) skips the commit: the trial store is
 * the truth, and the CAS still protects against concurrent tabs.
 */
export async function updateManifest(
  store: PackageStore,
  committer: Committer | null,
  packageId: string,
  patch: (manifest: PackageManifest) => PackageManifest,
  opts: UpdateManifestOptions = {},
): Promise<UpdateManifestResult> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const summary = opts.summary ?? "Update course details";

  // The manifest lives at the repo root, valid in either repo; assert anyway so
  // the invariant is checked on every write path with no exceptions (rule 1).
  assertPathAllowedInEitherContract(MANIFEST_PATH, "public");

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // 1. Read the FILE manifest; the raw string is the CAS expectation.
    // ONE row: this retries under CAS, and pulling the whole package (hundreds
    // of files, tens of megabytes) per attempt would be ruinous.
    const raw = await store.readFile(packageId, "public", MANIFEST_PATH);
    if (raw === null) throw new ManifestNotFoundError(packageId);

    // 2. Patch, then re-validate against the schema before anything is written.
    const next = parseManifest(patch(parseManifest(JSON.parse(raw))));
    const serialized = serializeManifest(next);

    // 3. Published: permanence first — commit before touching the projection.
    let commitSha: string | undefined;
    if (committer !== null) {
      const res = await committer.commit({
        repo: "public",
        summary,
        changes: [{ path: MANIFEST_PATH, content: serialized }],
      });
      commitSha = res.commitSha;
    }

    // 4. Conditional projection write. "conflict" ⇒ someone else moved the
    //    file under us; re-read and replay this whole attempt.
    const outcome = await store.replaceFileIf(
      packageId,
      { repo: "public", path: MANIFEST_PATH, content: serialized },
      { content: raw },
    );
    if (outcome === "ok") {
      return commitSha === undefined
        ? { manifest: next }
        : { manifest: next, commitSha };
    }
  }

  throw new ManifestConflictError();
}
