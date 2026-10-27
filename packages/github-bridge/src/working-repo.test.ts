/** The committer's GitHub seam: reachable history only, no authorship claims, branch-scoped calls. */
import { describe, expect, it } from "vitest";
import { GitHubClient, workingRepo, type FetchLike, type FetchResponse } from "./index";

const ok = (json: unknown): FetchResponse => ({ ok: true, status: 200, json: async () => json, text: async () => "" });

describe("workingRepo adapter", () => {
  it("walks history from the branch and never marks commits as Alembic's", async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      urls.push(url);
      return ok([{ sha: "c2", commit: { message: "m\n\nAlembic-Write: r1", author: { date: "2026-10-27T00:00:00Z" } } }]);
    };
    const repo = workingRepo(new GitHubClient("t", fetchImpl, { retry: { maxRetries: 0 } }), { owner: "o", repo: "r" }, "main");
    const commits = await repo.recentCommits(50);
    expect(urls[0]).toContain("sha=main");
    expect(urls[0]).toContain("per_page=50");
    expect(commits).toEqual([{ sha: "c2", message: "m\n\nAlembic-Write: r1" }]);
    expect(commits[0]).not.toHaveProperty("byAlembic");
  });
});
