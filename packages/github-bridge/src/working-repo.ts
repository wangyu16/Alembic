/**
 * The course committer's WorkingRepo seam over the GitHub client (workspace
 * v3, write path §3). Structural: it satisfies `WorkingRepo` in
 * @alembic/package-ops without importing it (github-bridge stays the only
 * code that talks to GitHub, and depends on no higher package).
 *
 * Landed detection relies on commit SHAs the committer recorded before the
 * ref move; `recentCommits` therefore walks only commits reachable from the
 * branch head, and never claims `byAlembic` (authorship can be forged).
 */

import type { GitHubClient, RepoCoords } from "./client";

export interface WorkingRepoAdapter {
  head(): Promise<string>;
  readFile(ref: string, path: string): Promise<string | null>;
  /** Every file path at `ref` (course operations check the tree, contract v3 §13). Refuses a truncated listing. */
  listPaths(ref: string): Promise<string[]>;
  /** Every file at `ref` with its blob id and mode (non-text files and moves, contract v3 §11). Refuses a truncated listing. */
  treeAt(ref: string): Promise<Map<string, { sha: string; mode: string }>>;
  /** A blob's bytes. */
  readBlob(sha: string): Promise<Uint8Array>;
  /** Is `commit` the head or an ancestor of it? */
  isAncestor(commit: string, head: string): Promise<boolean>;
  recentCommits(limit: number): Promise<Array<{ sha: string; message: string }>>;
  commitChain(input: {
    expectedHead: string;
    steps: Array<{ message: string; files: Array<{ path: string; content: string | null } | { path: string; blobSha: string; mode?: "100644" | "100755" }> }>;
    beforeMove?: (shas: string[]) => Promise<void>;
    signal?: AbortSignal;
  }): Promise<{ commitShas: string[]; head: string }>;
}

export function workingRepo(client: GitHubClient, coords: RepoCoords, branch = "main"): WorkingRepoAdapter {
  return {
    async head() {
      return (await client.getBranchHead(coords, branch)).commitSha;
    },
    readFile(ref, path) {
      return client.getFileAtRef(coords, path, ref);
    },
    async listPaths(ref) {
      const t = await client.listTree(coords, ref);
      if (t.truncated) throw new Error("the course has too many files to list");
      return t.paths;
    },
    readBlob(sha) {
      return client.getBlob(coords, sha);
    },
    async treeAt(ref) {
      const t = await client.listTreeEntries(coords, ref);
      if (t.truncated) throw new Error("the course has too many files to list");
      return new Map(t.entries.filter((e) => e.type === "blob").map((e) => [e.path, { sha: e.sha, mode: e.mode }]));
    },
    isAncestor(commit, head) {
      return client.isAncestor(coords, commit, head);
    },
    async recentCommits(limit) {
      const list = await client.listCommits(coords, { perPage: Math.min(limit, 100), sha: branch });
      return list.map((c) => ({ sha: c.sha, message: c.message }));
    },
    commitChain(input) {
      return client.commitChain({
        coords,
        branch,
        expectedHead: input.expectedHead,
        steps: input.steps,
        ...(input.beforeMove ? { beforeMove: input.beforeMove } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });
    },
  };
}
