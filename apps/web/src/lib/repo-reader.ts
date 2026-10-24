/**
 * The network-backed `RepoReader` reconcile reads the public repo through
 * (keeps package-ops IO-free). Kept free of `server-only` so tests run it
 * as-is; `lib/github.ts` builds it for `reconcilePackage`.
 *
 * Loop r3 (P5.B.3.g, P5.B.3.j): GitHub's compare cannot always say what
 * changed — it fails for an unknown base, lists at most 300 files, and lists
 * the diff from the merge base when the synced point is not an ancestor of
 * head. Before r3 such a course could never be reconciled, so a save refused
 * as "unverifiable" had no way out. The fallback lists the whole head tree
 * and compares each file's git blob id with Alembic's stored copy.
 */
import { gitBlobSha, type GitHubClient, type RepoCoords } from "@alembic/github-bridge";
import type { PackageStore, RepoReader } from "@alembic/package-ops";

type Changed = Array<{ path: string; status: "added" | "modified" | "removed" }>;

/** Does the stored text equal the blob `sha`? Binaries are stored base64, and
 *  the stored copy carries no encoding flag, so both readings are tried. */
function sameBlob(stored: string, sha: string): boolean {
  if (gitBlobSha(Buffer.from(stored, "utf8")) === sha) return true;
  if (/^[A-Za-z0-9+/]*={0,2}$/.test(stored) && stored.length % 4 === 0) {
    return gitBlobSha(Buffer.from(stored, "base64")) === sha;
  }
  return false;
}

/**
 * What differs between the head tree and the stored copy, by blob id. Paths
 * the store does not hold (repo-only files from the course template, say)
 * count only when they changed since `base` — when the base tree can be read;
 * otherwise every one is reported (fail toward reporting, never toward
 * silently missing an outside change).
 */
export async function treeChangedPaths(
  client: GitHubClient,
  coords: RepoCoords,
  store: PackageStore,
  packageId: string,
  base: string | null,
  head: string,
): Promise<Changed> {
  const headTree = await client.listTree(coords, head);
  if (headTree.truncated) throw new Error("head tree listing truncated; cannot compare");
  let baseShas: Map<string, string> | null = null;
  if (base !== null) {
    const b = await client.listTree(coords, base).catch(() => null);
    if (b && !b.truncated) baseShas = new Map(b.entries.map((e) => [e.path, e.sha]));
  }
  const stored = new Map(
    (await store.listFiles(packageId))
      .filter((f) => f.repo === "public")
      .map((f) => [f.path, f.content]),
  );
  const out: Changed = [];
  const atHead = new Set<string>();
  for (const { path, sha } of headTree.entries) {
    atHead.add(path);
    const ours = stored.get(path);
    if (ours !== undefined) {
      if (!sameBlob(ours, sha)) out.push({ path, status: "modified" });
    } else if (baseShas === null || baseShas.get(path) !== sha) {
      out.push({ path, status: "added" });
    }
  }
  for (const path of stored.keys()) {
    if (!atHead.has(path)) out.push({ path, status: "removed" });
  }
  return out;
}

export function githubRepoReader(
  client: GitHubClient,
  coords: RepoCoords,
  fallback?: { store: PackageStore; packageId: string },
): RepoReader {
  return {
    getHeadSha: async () => (await client.getBranchHead(coords)).commitSha,
    async listChangedPaths(base, head) {
      // Never synced: nothing to compare against (reconcile records head as
      // the baseline without absorbing — unchanged behaviour).
      if (base === null || base === head) return [];
      try {
        return await client.compareCommits(coords, base, head);
      } catch (err) {
        // Unknown base, a list at GitHub's cap, or a base that is not an
        // ancestor of head (`CompareIncompleteError`): compare whole trees.
        if (!fallback) throw err;
        console.warn(
          `[reconcile] ${coords.owner}/${coords.repo}: comparison unusable (${err instanceof Error ? err.message : err}); comparing whole tree`,
        );
        return treeChangedPaths(client, coords, fallback.store, fallback.packageId, base, head);
      }
    },
    readFileAtRef: (path, ref) => client.getFileAtRef(coords, path, ref),
  };
}
