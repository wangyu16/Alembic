/**
 * Saves that land WHILE a course is being published (loop r4, MEDIUM-5,
 * P5.B.3.o).
 *
 * Publishing takes ~10 s (two repositories, two commits). Until it records the
 * course as published, a save in another tab is a TRIAL save: it writes
 * Alembic's copy only. The publish commit was built from a snapshot taken
 * before that save, so the online copy never got it — and nothing would ever
 * notice: reconcile looks for changes made online, not for changes Alembic
 * holds that the online copy lacks.
 *
 * So, once the course is recorded as published, every stored file whose
 * content differs from what the publish committed (or that was added or
 * removed meanwhile) is committed through the committer — the one guarded
 * door. Commit only: Alembic's copy already holds these files. Each commit
 * re-checks, just before it is made, that the stored copy is still what it
 * is about to commit; if a newer save has moved it on, that save is already
 * going through the committer itself, and this one is skipped.
 *
 * The course details file is left to `finishPublishedManifest` (it merges the
 * repository pair). Pure of Next/Supabase: the caller injects the committer.
 */
import type { RepoKind } from "@alembic/package-contract";
import {
  FileChangedSinceOpenedError,
  type Committer,
  type PackageStore,
} from "@alembic/package-ops";

const key = (repo: RepoKind, path: string) => `${repo}:${path}`;

/** The publish commits' contents, keyed `repo:path`. */
export type CommittedSnapshot = ReadonlyMap<string, string>;

export function snapshotOf(
  changes: ReadonlyArray<{ repo: RepoKind; path: string; content: string }>,
): Map<string, string> {
  return new Map(changes.map((c) => [key(c.repo, c.path), c.content]));
}

/**
 * Commit what changed in Alembic's copy since `committed` was taken. Returns
 * the `repo:path` keys committed. Throws what the committer throws (other than
 * a skipped, already-superseded change).
 */
export async function commitLateSaves(args: {
  store: PackageStore;
  packageId: string;
  committed: CommittedSnapshot;
  committer: Committer;
  /** Paths left to another step (the course details file). */
  skip?: ReadonlySet<string>;
}): Promise<string[]> {
  const { store, packageId, committed, committer } = args;
  const skip = args.skip ?? new Set(["alembic.json"]);
  const now = new Map(
    (await store.listFiles(packageId)).map((f) => [key(f.repo, f.path), { repo: f.repo, path: f.path, content: f.content }]),
  );
  const done: string[] = [];
  for (const repo of ["public", "private"] as const) {
    const changes: Array<{ path: string; content: string | null }> = [];
    for (const [k, f] of now) {
      if (f.repo !== repo || skip.has(f.path)) continue;
      if (committed.get(k) !== f.content) changes.push({ path: f.path, content: f.content });
    }
    for (const k of committed.keys()) {
      const [r, ...rest] = k.split(":");
      const path = rest.join(":");
      if (r !== repo || skip.has(path) || now.has(k)) continue;
      changes.push({ path, content: null });
    }
    if (changes.length === 0) continue;
    try {
      await committer.commit({
        repo,
        summary: "Save changes made while publishing (Alembic)",
        changes,
        // Commit exactly what is stored now — or nothing, if it moved on.
        recheck: async () => {
          const stale: string[] = [];
          for (const c of changes) {
            if ((await store.readFile(packageId, repo, c.path)) !== c.content) stale.push(c.path);
          }
          if (stale.length > 0) throw new FileChangedSinceOpenedError(stale);
        },
      });
      done.push(...changes.map((c) => key(repo, c.path)));
    } catch (err) {
      if (err instanceof FileChangedSinceOpenedError) {
        console.warn(`[publish] ${packageId}: a newer save superseded the catch-up of`, err.paths.join(", "));
        continue;
      }
      throw err;
    }
  }
  return done;
}
