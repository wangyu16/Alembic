/**
 * The last step of publishing: keep the course details file in step with the
 * repositories publishing created (correctness loop r3, L3-1, P5.B.3.i).
 *
 * Before r3 the publish action snapshotted the manifest when it STARTED and,
 * seconds later (repository creation + commits), wrote it back with
 * `updateManifest(store, null, id, () => snapshot)` — a patch that ignored its
 * input. The compare-and-swap protected nothing: a rename made in another tab
 * during those seconds was silently reverted. And a publish that failed after
 * the repositories were recorded could never be finished: the next click saw
 * "already published" and returned early, so the course details never gained
 * the repository pair and the course's files never became listable.
 *
 * Now the step MERGES: only the repository fields publishing owns are set on
 * whatever the course details are at that moment. When the result differs from
 * what the publish commit carried (someone changed the course meanwhile, or an
 * earlier publish stopped half-way), it is saved to the online copy too, so the
 * two copies agree. Pure of Next/Supabase: the caller injects the committer.
 */

import { parseManifest, type PackageManifest, type RepoRef } from "@alembic/package-contract";
import {
  ManifestNotFoundError,
  serializeManifest,
  updateManifest,
  type Committer,
  type PackageStore,
} from "@alembic/package-ops";

/** The repositories publishing created and recorded (the shape of
 *  `PackageRecord.repos` — never read back from a manifest). */
export interface PublishedRepos {
  public: RepoRef;
  /** Absent only when an older record lacks it — then it is left as it is. */
  private?: RepoRef | null;
}

/** The ONLY fields publishing sets on the course details — nothing else. */
export function withPublishedRepos(manifest: PackageManifest, repos: PublishedRepos): PackageManifest {
  return {
    ...manifest,
    publicRepo: repos.public,
    ...(repos.private ? { privateRepo: repos.private } : {}),
  };
}

export interface FinishPublishInput {
  store: PackageStore;
  packageId: string;
  repos: PublishedRepos;
  /** The manifest the publish commit carried, when this run made that commit.
   *  Omitted when finishing an earlier, interrupted publish. */
  committed?: PackageManifest;
  /** Resolves the published course's committer (null = cannot reach it now). */
  committer: () => Promise<Committer | null>;
}

export interface FinishPublishResult {
  manifest: PackageManifest | null;
  /** True when the merged details were also saved to the online copy. */
  savedOnline: boolean;
}

const SUMMARY = "Publish from Alembic";

/**
 * Merge the repository pair into the course details (compare-and-swap through
 * `updateManifest`, the one manifest writer), then bring the online copy in
 * line when it lacks what the store now holds. A course with no details file at
 * all (malformed) has nothing to keep in step.
 */
export async function finishPublishedManifest(input: FinishPublishInput): Promise<FinishPublishResult> {
  // Did the details still lack the repositories? (Only meaningful when
  // finishing an earlier publish: an already-finished course needs nothing.)
  let lacked = false;
  const patch = (cur: PackageManifest) => {
    const next = withPublishedRepos(cur, input.repos);
    // Same keys in the same order when the repos were already there.
    lacked = JSON.stringify(next) !== JSON.stringify(cur);
    return next;
  };
  let merged: PackageManifest;
  try {
    ({ manifest: merged } = await updateManifest(input.store, null, input.packageId, patch, {
      summary: SUMMARY,
    }));
  } catch (e) {
    if (e instanceof ManifestNotFoundError) return { manifest: null, savedOnline: false };
    throw e;
  }

  const inStep =
    input.committed === undefined
      ? !lacked
      : serializeManifest(merged) ===
        serializeManifest(parseManifest(withPublishedRepos(input.committed, input.repos)));
  if (inStep) return { manifest: merged, savedOnline: false };

  // The online copy has the publish snapshot; the store has more (or the
  // publish never got this far). Save the merged details there as well —
  // through the same owner, re-merging against whatever is current.
  const committer = await input.committer();
  if (!committer) return { manifest: merged, savedOnline: false };
  const { manifest } = await updateManifest(input.store, committer, input.packageId, patch, {
    summary: SUMMARY,
  });
  return { manifest, savedOnline: true };
}
