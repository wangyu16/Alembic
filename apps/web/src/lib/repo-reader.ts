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
import { UnreadableFileError, type PackageStore, type RepoReader } from "@alembic/package-ops";
import { isBinaryPath } from "./collection-upload";

type Changed = Array<{ path: string; status: "added" | "modified" | "removed" }>;

/** Does the stored text equal the blob `sha`? Binaries are stored base64, and
 *  the stored copy carries no encoding flag, so both readings are tried. */
export function sameBlob(stored: string, sha: string): boolean {
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

/**
 * A file's bytes in the form Alembic stores them (loop r4, P5.B.3.k): base64
 * for a binary (by its name — the rule the upload door uses), UTF-8 text for
 * everything else. Text that is not valid UTF-8 is refused
 * (`UnreadableFileError`) rather than stored with replacement characters.
 */
export function storedForm(path: string, bytes: Uint8Array): string {
  if (isBinaryPath(path)) return Buffer.from(bytes).toString("base64");
  try {
    // ignoreBOM: keep a leading BOM, so the text re-encodes to the same blob.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new UnreadableFileError(path);
  }
}

export function githubRepoReader(
  client: GitHubClient,
  coords: RepoCoords,
  fallback?: { store: PackageStore; packageId: string },
): RepoReader {
  // Blob ids per ref, listed once per reader (one reconcile run).
  const trees = new Map<string, Promise<Map<string, string> | null>>();
  const blobIds = (ref: string) => {
    let t = trees.get(ref);
    if (!t) {
      t = client
        .listTree(coords, ref)
        .then((l) => (l.truncated ? null : new Map(l.entries.map((e) => [e.path, e.sha]))))
        .catch(() => null);
      trees.set(ref, t);
    }
    return t;
  };
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
    // Loop r4 (P5.B.3.k): compare blob ids BEFORE reading, so an unchanged
    // binary or large file is never downloaded; read the rest as exact bytes
    // (the blobs API past the contents API's 1 MB) in the stored form.
    async sameAsStored(path, stored, ref) {
      const sha = (await blobIds(ref))?.get(path);
      return sha !== undefined && sameBlob(stored, sha);
    },
    async readFileAtRef(path, ref) {
      const bytes = await client.getFileBytesAtRef(coords, path, ref);
      return bytes === null ? null : storedForm(path, bytes);
    },
  };
}
