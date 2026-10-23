import { staticTokenSource, type TokenSource } from "./app-auth";
import {
  defaultFetch,
  GitHubError,
  isRateLimitResponse,
  sendWithRetry,
  type FetchLike,
  type RetryPolicy,
} from "./http";

export interface RepoCoords {
  owner: string;
  repo: string;
}

/**
 * Read a file from a PUBLIC repo with NO authentication, via raw.githubusercontent.
 * Used for cross-owner adaptation (M31): an educator adapts a stranger's
 * portal-published package, whose content is genuinely public — so no
 * installation token (which wouldn't cover another owner's repo) and no RLS
 * bypass. Returns null on 404.
 */
export async function fetchPublicRepoFile(
  coords: RepoCoords,
  path: string,
  ref = "main",
  fetchImpl: FetchLike = defaultFetch,
): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${coords.owner}/${coords.repo}/${ref}/${path}`;
  const res = await fetchImpl(url, { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new GitHubError(`Public read ${path} failed`, res.status, await res.text().catch(() => undefined));
  }
  return res.text();
}

/**
 * Fetch a public repo file's raw BYTES (not text). Use this for anything that
 * may be binary (images, PDFs): `fetchPublicRepoFile`'s `res.text()` UTF-8-decodes
 * the body, which is lossy for binary and corrupts the bytes. Text callers that
 * only ever read `.md`/`.json` may keep using `fetchPublicRepoFile`.
 */
export async function fetchPublicRepoBytes(
  coords: RepoCoords,
  path: string,
  ref = "main",
  fetchImpl: FetchLike = defaultFetch,
): Promise<Uint8Array | null> {
  const url = `https://raw.githubusercontent.com/${coords.owner}/${coords.repo}/${ref}/${path}`;
  const res = await fetchImpl(url, { method: "GET" });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new GitHubError(`Public read ${path} failed`, res.status, await res.text().catch(() => undefined));
  }
  const ab = await res.arrayBuffer?.();
  return ab ? new Uint8Array(ab) : null;
}

/**
 * Requests that are safe to send twice, so a 5xx or a dropped connection may
 * be retried: reads, ref updates to a fixed sha (PATCH), and creation of
 * content-addressed git objects (a duplicate blob/tree is the same object; a
 * duplicate commit object is unreferenced and harmless). Creating a repo, a
 * ref, a tag or a Pages site is NOT replayed on a 5xx — the first attempt may
 * have landed. Rate-limit refusals are always retried: GitHub did not
 * process them.
 */
function isReplayable(method: string, path: string): boolean {
  if (method !== "POST") return true;
  return /\/git\/(blobs|trees|commits)$/.test(path);
}

/**
 * Thin GitHub REST client over an installation token. Only the operations
 * Alembic needs: create repos from templates, commit a file set atomically
 * (Git Data API), list commits, and read a file at a ref (for restore).
 *
 * Robustness (Phase 5 Track B.2): every request retries GitHub 5xx and rate
 * limits with backoff (honoring `Retry-After`), and a 401 refreshes the
 * installation token once when the client was given a refreshable
 * `TokenSource` (see `installationTokenSource`).
 */
export class GitHubClient {
  private readonly tokens: TokenSource;
  private readonly retry: Partial<RetryPolicy> | undefined;

  constructor(
    token: string | TokenSource,
    private readonly fetchImpl: FetchLike = defaultFetch,
    opts: { retry?: Partial<RetryPolicy> } = {},
  ) {
    this.tokens = typeof token === "string" ? staticTokenSource(token) : token;
    this.retry = opts.retry;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const send = async (token: string) =>
      sendWithRetry(
        this.fetchImpl,
        `https://api.github.com${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
        { replayable: isReplayable(method, path), policy: this.retry },
      );

    let res = await send(await this.tokens.token());
    if (res.status === 401) {
      // Expired / revoked installation token: GitHub did not process the
      // request, so one retry with a fresh token is always safe.
      const fresh = await this.tokens.refresh();
      if (fresh !== null) res = await send(fresh);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new GitHubError(`GitHub ${method} ${path} failed`, res.status, text || undefined, {
        rateLimited: isRateLimitResponse(res, text),
      });
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

  /**
   * Create a blob and return its sha. GitHub's create-tree `content` field is
   * always UTF-8, so binary files (`encoding: "base64"`) must be uploaded as a
   * blob first and then referenced by sha in the tree — otherwise a PNG/PDF
   * lands on GitHub as its base64 *text*, not its bytes.
   */
  private async createBlob(
    coords: RepoCoords,
    content: string,
    encoding: "utf-8" | "base64",
  ): Promise<string> {
    const data = await this.request<{ sha: string }>(
      "POST",
      `/repos/${coords.owner}/${coords.repo}/git/blobs`,
      { content, encoding },
    );
    return data.sha;
  }

  /**
   * Build create-tree entries for a file set. Text (utf-8) content is inlined;
   * a deletion is a null-sha entry; base64 (binary) content is uploaded as a
   * blob first and referenced by sha (see `createBlob`).
   */
  private async buildTreeEntries(
    coords: RepoCoords,
    files: Array<{ path: string; content: string | null; encoding?: "utf-8" | "base64" }>,
  ): Promise<Array<Record<string, unknown>>> {
    return Promise.all(
      files.map(async (f) => {
        if (f.content === null) {
          return { path: f.path, mode: "100644", type: "blob", sha: null };
        }
        if (f.encoding === "base64") {
          const sha = await this.createBlob(coords, f.content, "base64");
          return { path: f.path, mode: "100644", type: "blob", sha };
        }
        return { path: f.path, mode: "100644", type: "blob", content: f.content };
      }),
    );
  }

  /** Tree entry: text content to write, base64 binary, or null to delete. */
  async createCommitOnBranch(input: {
    coords: RepoCoords;
    branch?: string;
    message: string;
    files: Array<{ path: string; content: string | null; encoding?: "utf-8" | "base64" }>;
  }): Promise<{ commitSha: string }> {
    const branch = input.branch ?? "main";
    const { commitSha: parentSha, treeSha: baseTree } = await this.getBranchHead(
      input.coords,
      branch,
    );

    // Drop deletions of paths the repository does not actually have.
    //
    // A `sha: null` tree entry for a path that is absent from `base_tree` makes
    // create-tree fail with 422 `GitRPC::BadObjectState` — and it takes the
    // whole commit with it, including every unrelated write in the same chunk.
    // Callers compute deletions from the app's projection of the package, which
    // can legitimately name a file the repo doesn't have (a placeholder that was
    // never committed, a file removed directly on GitHub, a projection built
    // before a schema change). Deleting a path that isn't there is a no-op in
    // intent, so filtering such entries is always safe — it cannot lose a real
    // deletion, only skip an impossible one.
    //
    // Fail-safe when we cannot prove absence: GitHub truncates a very large
    // recursive tree listing, and "not in the listing" then does not mean "not
    // in the repo". In that case keep every deletion exactly as asked — a
    // deletion is sometimes security-relevant (leak remediation), and silently
    // skipping one would be far worse than a loud 422.
    let files = input.files;
    if (files.some((f) => f.content === null)) {
      const listed = await this.listTree(input.coords, baseTree).catch(() => null);
      if (listed && !listed.truncated) {
        const present = new Set(listed.paths);
        files = files.filter((f) => f.content !== null || present.has(f.path));
      }
    }

    // Everything asked for is already true of the repository (e.g. a resumed
    // upload whose remaining work was only no-op deletions). Committing an
    // unchanged tree would add an empty commit for nothing.
    if (files.length === 0) return { commitSha: parentSha };

    const tree = await this.buildTreeEntries(input.coords, files);

    const newTree = await this.request<{ sha: string }>(
      "POST",
      `/repos/${input.coords.owner}/${input.coords.repo}/git/trees`,
      { base_tree: baseTree, tree },
    );
    // Same tree as the branch already has (a save that changed nothing, or a
    // retried write that had in fact landed): no empty commit.
    if (newTree.sha === baseTree) return { commitSha: parentSha };
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
    opts: { perPage?: number; path?: string } = {},
  ): Promise<Array<{ sha: string; message: string; date: string }>> {
    // `path` scopes history to commits that touched one file (per-chapter
    // history): GitHub returns only commits changing that path, newest first.
    const pathParam = opts.path
      ? `&path=${encodeURIComponent(opts.path)}`
      : "";
    const data = await this.request<
      Array<{ sha: string; commit: { message: string; author: { date: string } } }>
    >(
      "GET",
      `/repos/${coords.owner}/${coords.repo}/commits?per_page=${opts.perPage ?? 20}${pathParam}`,
    );
    return data.map((c) => ({
      sha: c.sha,
      message: c.commit.message,
      date: c.commit.author.date,
    }));
  }

  /** Resolve a ref (e.g. "heads/gh-pages") to a commit sha, or null if absent. */
  async getRefSha(coords: RepoCoords, ref: string): Promise<string | null> {
    try {
      const data = await this.request<{ object: { sha: string } }>(
        "GET",
        `/repos/${coords.owner}/${coords.repo}/git/ref/${ref}`,
      );
      return data.object.sha;
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  }

  /**
   * Replace a branch's entire contents with `files` as a single root commit
   * (no parent) — used for generated output like the Pages branch, so each
   * build yields a clean tree. Creates the branch if it doesn't exist.
   *
   * Idempotent: when the branch already holds exactly this tree, nothing is
   * committed and `unchanged` is true. Atomic for readers: the branch moves
   * in one ref update at the end, so a failure before that leaves the live
   * site exactly as it was.
   */
  async publishToBranch(input: {
    coords: RepoCoords;
    branch: string;
    message: string;
    files: Array<{ path: string; content: string; encoding?: "utf-8" | "base64" }>;
  }): Promise<{ commitSha: string; unchanged: boolean }> {
    const { coords, branch } = input;
    const existing = await this.getRefSha(coords, `heads/${branch}`);
    const tree = await this.buildTreeEntries(coords, input.files);
    const newTree = await this.request<{ sha: string }>(
      "POST",
      `/repos/${coords.owner}/${coords.repo}/git/trees`,
      { tree },
    );
    if (existing !== null) {
      const head = await this.request<{ tree: { sha: string } }>(
        "GET",
        `/repos/${coords.owner}/${coords.repo}/git/commits/${existing}`,
      );
      if (head.tree.sha === newTree.sha) return { commitSha: existing, unchanged: true };
    }
    const commit = await this.request<{ sha: string }>(
      "POST",
      `/repos/${coords.owner}/${coords.repo}/git/commits`,
      { message: input.message, tree: newTree.sha, parents: [] },
    );
    const forceUpdate = () =>
      this.request(
        "PATCH",
        `/repos/${coords.owner}/${coords.repo}/git/refs/heads/${branch}`,
        { sha: commit.sha, force: true },
      );
    if (existing === null) {
      try {
        await this.request(
          "POST",
          `/repos/${coords.owner}/${coords.repo}/git/refs`,
          { ref: `refs/heads/${branch}`, sha: commit.sha },
        );
      } catch (e) {
        // 422 "Reference already exists": another publish created the branch
        // between our read and our write. The branch is ours to overwrite.
        if (!(e instanceof GitHubError && e.status === 422)) throw e;
        await forceUpdate();
      }
    } else {
      await forceUpdate();
    }
    return { commitSha: commit.sha, unchanged: false };
  }

  /**
   * Ensure GitHub Pages is enabled to serve from `branch`. Returns the public
   * site URL. Requires the App's "Pages: write" permission.
   */
  async enablePages(
    coords: RepoCoords,
    branch: string,
  ): Promise<{ url: string }> {
    const base = `/repos/${coords.owner}/${coords.repo}/pages`;
    try {
      const existing = await this.request<{ html_url: string }>("GET", base);
      return { url: existing.html_url };
    } catch (e) {
      if (!(e instanceof GitHubError && e.status === 404)) throw e;
    }
    const created = await this.request<{ html_url: string }>("POST", base, {
      source: { branch, path: "/" },
    });
    return { url: created.html_url };
  }

  /** The repository's default branch name (e.g. "main"). */
  async getDefaultBranch(coords: RepoCoords): Promise<string> {
    const data = await this.request<{ default_branch: string }>(
      "GET",
      `/repos/${coords.owner}/${coords.repo}`,
    );
    return data.default_branch;
  }

  /**
   * Whether the repository still exists. Returns false on a 404 (deleted or
   * never created); other errors propagate so a transient failure is never
   * mistaken for a deletion. Used by archive reconciliation: when an educator
   * deletes a published repo on GitHub, Alembic purges the archived package.
   */
  async repoExists(coords: RepoCoords): Promise<boolean> {
    try {
      await this.request("GET", `/repos/${coords.owner}/${coords.repo}`);
      return true;
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return false;
      throw e;
    }
  }

  /** List tags (snapshots), newest-API-order first. */
  async listTags(
    coords: RepoCoords,
    opts: { perPage?: number } = {},
  ): Promise<Array<{ name: string; commitSha: string }>> {
    const perPage = opts.perPage ?? 50;
    const data = await this.request<Array<{ name: string; commit: { sha: string } }>>(
      "GET",
      `/repos/${coords.owner}/${coords.repo}/tags?per_page=${perPage}`,
    );
    return data.map((t) => ({ name: t.name, commitSha: t.commit.sha }));
  }

  /**
   * Create a lightweight tag (snapshot) pointing at `sha`. Throws if the tag
   * already exists (GitHub returns 422). A snapshot is immutable: it captures
   * the whole repo — content and assets — at that commit.
   */
  async createTag(coords: RepoCoords, tag: string, sha: string): Promise<void> {
    await this.request("POST", `/repos/${coords.owner}/${coords.repo}/git/refs`, {
      ref: `refs/tags/${tag}`,
      sha,
    });
  }

  /**
   * Paths changed between two commits (base..head), via the Compare API.
   * Used by reconciliation to find what a foreign commit touched. If base is
   * null (never synced) this returns [] — and reconcile then records the head
   * as its baseline WITHOUT absorbing anything (corrected 2026-10-23: this
   * comment used to promise "reconcile all", which no caller does). Note also
   * that GitHub lists at most 300 files per comparison; a larger foreign change
   * is absorbed only in part. Both are open items in Status.md (Track B).
   */
  async compareCommits(
    coords: RepoCoords,
    base: string | null,
    head: string,
  ): Promise<Array<{ path: string; status: "added" | "modified" | "removed" }>> {
    if (base === null || base === head) return [];
    const data = await this.request<{
      files?: Array<{
        filename: string;
        status: string;
        previous_filename?: string;
      }>;
    }>(
      "GET",
      `/repos/${coords.owner}/${coords.repo}/compare/${base}...${head}`,
    );
    const out: Array<{
      path: string;
      status: "added" | "modified" | "removed";
    }> = [];
    for (const f of data.files ?? []) {
      switch (f.status) {
        case "added":
        case "copied":
          out.push({ path: f.filename, status: "added" });
          break;
        case "removed":
          out.push({ path: f.filename, status: "removed" });
          break;
        case "modified":
        case "changed":
          out.push({ path: f.filename, status: "modified" });
          break;
        case "renamed":
          if (f.previous_filename) {
            out.push({ path: f.previous_filename, status: "removed" });
          }
          out.push({ path: f.filename, status: "added" });
          break;
        default:
          // unchanged or any unknown status: skip
          break;
      }
    }
    return out;
  }

  /**
   * List every file (blob) path in the repo tree at a ref, recursively. Used by
   * the leakage audit (M21) to scan the whole public repo — not just a diff —
   * for paths that violate the two-repo invariant. `truncated` is true when the
   * tree exceeded GitHub's response limit (very large repos); the caller should
   * treat a truncated audit as inconclusive.
   */
  async listTree(
    coords: RepoCoords,
    ref: string,
  ): Promise<{ paths: string[]; truncated: boolean }> {
    const data = await this.request<{
      tree: Array<{ path: string; type: string }>;
      truncated?: boolean;
    }>("GET", `/repos/${coords.owner}/${coords.repo}/git/trees/${ref}?recursive=1`);
    return {
      paths: data.tree.filter((e) => e.type === "blob").map((e) => e.path),
      truncated: data.truncated === true,
    };
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
