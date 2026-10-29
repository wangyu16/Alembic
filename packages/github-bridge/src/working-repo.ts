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
  recentCommits(limit: number): Promise<Array<{ sha: string; message: string }>>;
  commitChain(input: {
    expectedHead: string;
    steps: Array<{ message: string; files: Array<{ path: string; content: string | null }> }>;
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
