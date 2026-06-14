import { defaultFetch, GitHubError, type FetchLike } from "./http";

export interface RepoCoords {
  owner: string;
  repo: string;
}

/**
 * Thin GitHub REST client over an installation token. Only the operations
 * Alembic needs: create repos from templates, commit a file set atomically
 * (Git Data API), list commits, and read a file at a ref (for restore).
 */
export class GitHubClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await this.fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      throw new GitHubError(
        `GitHub ${method} ${path} failed`,
        res.status,
        await res.text().catch(() => undefined),
      );
    }
    return (await res.json()) as T;
  }

  /** Create a new repository from a template repository. */
  async generateFromTemplate(input: {
    templateOwner: string;
    templateRepo: string;
    owner: string;
    name: string;
    private: boolean;
    description?: string;
  }): Promise<RepoCoords> {
    const data = await this.request<{ owner: { login: string }; name: string }>(
      "POST",
      `/repos/${input.templateOwner}/${input.templateRepo}/generate`,
      {
        owner: input.owner,
        name: input.name,
        private: input.private,
        description: input.description ?? "",
      },
    );
    return { owner: data.owner.login, repo: data.name };
  }

  async getBranchHead(
    coords: RepoCoords,
    branch = "main",
  ): Promise<{ commitSha: string; treeSha: string }> {
    const ref = await this.request<{ object: { sha: string } }>(
      "GET",
      `/repos/${coords.owner}/${coords.repo}/git/ref/heads/${branch}`,
    );
    const commit = await this.request<{ tree: { sha: string } }>(
      "GET",
      `/repos/${coords.owner}/${coords.repo}/git/commits/${ref.object.sha}`,
    );
    return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
  }

  /** Tree entry: text content to write, or null to delete the path. */
  async createCommitOnBranch(input: {
    coords: RepoCoords;
    branch?: string;
    message: string;
    files: Array<{ path: string; content: string | null }>;
  }): Promise<{ commitSha: string }> {
    const branch = input.branch ?? "main";
    const { commitSha: parentSha, treeSha: baseTree } = await this.getBranchHead(
      input.coords,
      branch,
    );

    const tree = input.files.map((f) =>
      f.content === null
        ? { path: f.path, mode: "100644", type: "blob", sha: null }
        : { path: f.path, mode: "100644", type: "blob", content: f.content },
    );

    const newTree = await this.request<{ sha: string }>(
      "POST",
      `/repos/${input.coords.owner}/${input.coords.repo}/git/trees`,
      { base_tree: baseTree, tree },
    );
    const commit = await this.request<{ sha: string }>(
      "POST",
      `/repos/${input.coords.owner}/${input.coords.repo}/git/commits`,
      { message: input.message, tree: newTree.sha, parents: [parentSha] },
    );
    await this.request(
      "PATCH",
      `/repos/${input.coords.owner}/${input.coords.repo}/git/refs/heads/${branch}`,
      { sha: commit.sha },
    );
    return { commitSha: commit.sha };
  }

  async listCommits(
    coords: RepoCoords,
    opts: { perPage?: number } = {},
  ): Promise<Array<{ sha: string; message: string; date: string }>> {
    const data = await this.request<
      Array<{ sha: string; commit: { message: string; author: { date: string } } }>
    >(
      "GET",
      `/repos/${coords.owner}/${coords.repo}/commits?per_page=${opts.perPage ?? 20}`,
    );
    return data.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      date: c.commit.author.date,
    }));
  }

  /** Read a UTF-8 file at a ref (commit/branch). Returns null if absent. */
  async getFileAtRef(
    coords: RepoCoords,
    path: string,
    ref: string,
  ): Promise<string | null> {
    try {
      const data = await this.request<{ content: string; encoding: string }>(
        "GET",
        `/repos/${coords.owner}/${coords.repo}/contents/${path}?ref=${ref}`,
      );
      return Buffer.from(data.content, "base64").toString("utf8");
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  }
}
