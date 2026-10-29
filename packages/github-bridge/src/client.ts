import { createHash } from "node:crypto";
import { readTarGz } from "./tar";
import { staticTokenSource, type TokenSource } from "./app-auth";
import {
  defaultFetch,
  GitHubError,
  isRateLimitResponse,
  retryAtOf,
  sendWithRetry,
  type FetchLike,
  type RetryPolicy,
} from "./http";

/** Max blob uploads in flight at once (see `buildTreeEntries`). */
export const BLOB_UPLOAD_CONCURRENCY = 8;

/**
 * `Promise.all(items.map(fn))` with at most `limit` calls of `fn` running at
 * once. Results keep input order; the first rejection rejects the whole call
 * (workers stop picking up new items once one has failed).
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

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
 * The file paths of a PUBLIC repository at a ref, without any token (for the
 * public template: no installation's token is needed or used to read it).
 * Null on 404; `truncated` as for the tree API.
 */
export async function fetchPublicTree(
  coords: RepoCoords,
  ref = "main",
  fetchImpl: FetchLike = defaultFetch,
): Promise<{ paths: string[]; truncated: boolean } | null> {
  const res = await fetchImpl(`https://api.github.com/repos/${coords.owner}/${coords.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, {
    method: "GET",
    headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new GitHubError("Public tree read failed", res.status, await res.text().catch(() => undefined));
  const data = (await res.json()) as { tree: Array<{ path: string; type: string }>; truncated?: boolean };
  return { paths: data.tree.filter((e) => e.type === "blob").map((e) => e.path), truncated: data.truncated === true };
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
/** GitHub's Compare API lists at most this many files. */
const COMPARE_FILE_LIMIT = 300;

/**
 * Git's blob id for some bytes: SHA-1 of `"blob <len>\0" + bytes` — what a
 * tree listing reports per file, so content can be compared with a stored
 * copy without downloading it (loop r3, P5.B.3.g).
 */
export function gitBlobSha(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

/**
 * A comparison whose file list cannot be trusted as "everything that changed
 * since base" (loop r3, P5.B.3.j): the base is not an ancestor of the head
 * (GitHub status "diverged"/"behind" — the list is then the diff from the
 * merge base), or the list is at GitHub's cap and may be cut short.
 */
export class CompareIncompleteError extends Error {
  constructor(readonly reason: "not-ancestor" | "too-many-files") {
    super(
      reason === "not-ancestor"
        ? "comparison base is not an ancestor of head"
        : `comparison lists ${COMPARE_FILE_LIMIT} or more files and may be incomplete`,
    );
    this.name = "CompareIncompleteError";
  }
}

/**
 * A commit was refused because the branch moved since the caller's last sync
 * and the outside change touched files this commit would write (`overlap`),
 * or that could not be ruled out (`unverifiable`). Nothing was written.
 * Developer-facing: callers map it to their own wording.
 */
export class RemoteChangedError extends Error {
  constructor(
    readonly paths: string[],
    readonly reason: "overlap" | "unverifiable",
    readonly cause?: unknown,
  ) {
    super(
      reason === "overlap"
        ? `branch changed since the last sync in: ${paths.join(", ")}`
        : "branch changed since the last sync and the change could not be compared",
    );
    this.name = "RemoteChangedError";
  }
}

/** GitHub refused to move a branch because it is no longer where the commit
 *  was built (422 "Update is not a fast forward"). Nothing was changed. */
function isNotFastForward(err: unknown): boolean {
  return (
    err instanceof GitHubError &&
    err.status === 422 &&
    /fast[ -]?forward/i.test(`${err.detail ?? ""} ${err.message}`)
  );
}

/**
 * The branch head is no longer the head the caller decided against
 * (workspace v3, write-path spec §3.2 step 4). Nothing was moved; the
 * caller re-reads the head and decides again.
 */
export class HeadMovedError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string | null,
  ) {
    super(`branch head moved (expected ${expected}, found ${actual ?? "unknown"})`);
    this.name = "HeadMovedError";
  }
}

/** A file in a commit-chain step: new text/bytes, an existing blob, or a deletion. */
export type ChainFile =
  | { path: string; content: string; encoding?: "utf-8" | "base64" }
  | { path: string; blobSha: string }
  | { path: string; content: null };

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
    signal?: AbortSignal,
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
          ...(signal ? { signal } : {}),
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
      const rateLimited = isRateLimitResponse(res, text);
      throw new GitHubError(`GitHub ${method} ${path} failed`, res.status, text || undefined, {
        rateLimited, retryAt: rateLimited ? retryAtOf(res) : null,
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
   *
   * Blob uploads run at most `BLOB_UPLOAD_CONCURRENCY` at a time: GitHub's
   * secondary rate limit punishes bursts of concurrent content-creating
   * requests, and a site with 150 figures must not fire 150 POSTs at once.
   * Entry order matches `files` order.
   */
  private async buildTreeEntries(
    coords: RepoCoords,
    files: Array<{ path: string; content: string | null; encoding?: "utf-8" | "base64" } | { path: string; blobSha: string }>,
  ): Promise<Array<Record<string, unknown>>> {
    return mapWithConcurrency(files, BLOB_UPLOAD_CONCURRENCY, async (f) => {
      // An existing blob of this repository, by id: nothing is uploaded.
      if ("blobSha" in f) return { path: f.path, mode: "100644", type: "blob", sha: f.blobSha };
      if (f.content === null) {
        return { path: f.path, mode: "100644", type: "blob", sha: null };
      }
      if (f.encoding === "base64") {
        const sha = await this.createBlob(coords, f.content, "base64");
        return { path: f.path, mode: "100644", type: "blob", sha };
      }
      return { path: f.path, mode: "100644", type: "blob", content: f.content };
    });
  }

  /**
   * Tree entry: text content to write, base64 binary, or null to delete.
   *
   * Returns the new commit and `parentSha`, the branch head it was built on
   * (equal to `commitSha` when nothing needed committing).
   *
   * `unchangedSince` (loop r2, P5.B.3.f): the head the caller last synced.
   * When given and the branch has moved since, the change between the two is
   * compared; if it touched any path this commit writes or deletes, a
   * `RemoteChangedError` is thrown and NOTHING is written. A comparison that
   * fails (unknown base, network) or may be incomplete (GitHub lists at most
   * 300 files) refuses too — fail closed. Null/omitted: no check.
   */
  async createCommitOnBranch(input: {
    coords: RepoCoords;
    branch?: string;
    message: string;
    files: Array<{ path: string; content: string | null; encoding?: "utf-8" | "base64" }>;
    unchangedSince?: string | null;
  }): Promise<{ commitSha: string; parentSha: string }> {
    // Loop r4 (R4-1): the branch can move between reading its head and moving
    // it (another tab's save landed in between). GitHub then refuses the
    // fast-forward with 422 and nothing was changed. Build the commit again
    // on the new head — the outside-change guard runs again, against it —
    // and try once more, instead of failing a save that would land cleanly.
    //
    // Loop r5 (P5.B.3.q): the rebuild is guarded for EVERY repository, not
    // only by the public repo's synced-point comparison (a private repository
    // has none). Before rebuilding, each path this commit writes or deletes
    // must have the same blob id at the new head as in the tree the first
    // attempt was built on; otherwise the branch moved in one of our own
    // files (another tab's save of the same file, say) and the commit is
    // refused (`RemoteChangedError`, "overlap"), never written over it.
    let firstTree: string | null = null;
    try {
      return await this.commitOnce(input, (_parent, tree) => {
        firstTree = tree;
      });
    } catch (err) {
      if (!isNotFastForward(err) || firstTree === null) throw err;
      const builtOn: string = firstTree;
      return this.commitOnce(input, (_parent, tree) => this.assertPlanUnchanged(input, builtOn, tree));
    }
  }

  /**
   * Loop r5 (P5.B.3.q): every path of the plan has the same blob id (or is
   * absent in both) in `beforeTree` and `afterTree`. A listing that may be
   * incomplete (truncated) or cannot be read refuses — fail closed.
   */
  private async assertPlanUnchanged(
    input: { coords: RepoCoords; files: Array<{ path: string }> },
    beforeTree: string,
    afterTree: string,
  ): Promise<void> {
    if (beforeTree === afterTree) return;
    let before: Awaited<ReturnType<GitHubClient["listTree"]>>;
    let after: Awaited<ReturnType<GitHubClient["listTree"]>>;
    try {
      [before, after] = await Promise.all([
        this.listTree(input.coords, beforeTree),
        this.listTree(input.coords, afterTree),
      ]);
    } catch (cause) {
      throw new RemoteChangedError([], "unverifiable", cause);
    }
    if (before.truncated || after.truncated) throw new RemoteChangedError([], "unverifiable");
    const was = new Map(before.entries.map((e) => [e.path, e.sha]));
    const now = new Map(after.entries.map((e) => [e.path, e.sha]));
    const moved = [...new Set(input.files.map((f) => f.path))].filter((p) => was.get(p) !== now.get(p));
    if (moved.length > 0) throw new RemoteChangedError(moved, "overlap");
  }

  private async commitOnce(
    input: {
      coords: RepoCoords;
      branch?: string;
      message: string;
      files: Array<{ path: string; content: string | null; encoding?: "utf-8" | "base64" }>;
      unchangedSince?: string | null;
    },
    /** Called with the head this attempt builds on, before anything is written. */
    onHead?: (parentSha: string, treeSha: string) => void | Promise<void>,
  ): Promise<{ commitSha: string; parentSha: string }> {
    const branch = input.branch ?? "main";
    const { commitSha: parentSha, treeSha: baseTree } = await this.getBranchHead(
      input.coords,
      branch,
    );
    if (onHead) await onHead(parentSha, baseTree);

    const since = input.unchangedSince;
    if (since && since !== parentSha) {
      let changed: Array<{ path: string }>;
      try {
        changed = await this.compareCommits(input.coords, since, parentSha);
      } catch (cause) {
        throw new RemoteChangedError([], "unverifiable", cause);
      }
      if (changed.length >= COMPARE_FILE_LIMIT) {
        throw new RemoteChangedError([], "unverifiable");
      }
      const touched = new Set(changed.map((c) => c.path));
      const overlap = [...new Set(input.files.map((f) => f.path))].filter((p) => touched.has(p));
      if (overlap.length > 0) throw new RemoteChangedError(overlap, "overlap");
    }

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
    if (files.length === 0) return { commitSha: parentSha, parentSha };

    const tree = await this.buildTreeEntries(input.coords, files);

    const newTree = await this.request<{ sha: string }>(
      "POST",
      `/repos/${input.coords.owner}/${input.coords.repo}/git/trees`,
      { base_tree: baseTree, tree },
    );
    // Same tree as the branch already has (a save that changed nothing, or a
    // retried write that had in fact landed): no empty commit.
    if (newTree.sha === baseTree) return { commitSha: parentSha, parentSha };
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
    return { commitSha: commit.sha, parentSha };
  }

  /**
   * Build one or more commits on top of `expectedHead`, each step's tree on
   * the previous one, and move the branch ONCE to the last commit — only if
   * the branch head is still `expectedHead` (workspace v3 write path §3.2,
   * §5: kept versions are committed before the version on top, and the head
   * never shows the kept one). The ref update is a non-force PATCH, so a
   * concurrent push that moved the head forward makes it fail; the head is
   * also re-read just before the PATCH so a rewind (force-push to an older
   * commit) is caught too, instead of being fast-forwarded over.
   * Throws `HeadMovedError`; nothing is moved in that case.
   */
  async commitChain(input: {
    coords: RepoCoords;
    branch?: string;
    expectedHead: string;
    steps: Array<{ message: string; files: ChainFile[] }>;
    /** Runs after the commits exist and before the ref moves; throwing stops the move. */
    beforeMove?: (shas: string[]) => Promise<void>;
    /** Aborted: the ref is not moved (checked right before the PATCH, and the PATCH itself is cancelled). */
    signal?: AbortSignal;
    /** Hard limit for the ref update request (default 20 s), so an abandoned attempt can't move the ref late. */
    moveTimeoutMs?: number;
  }): Promise<{ commitShas: string[]; head: string }> {
    const branch = input.branch ?? "main";
    const { owner, repo } = input.coords;
    if (input.steps.length === 0) return { commitShas: [], head: input.expectedHead };
    const base = await this.request<{ tree: { sha: string } }>(
      "GET",
      `/repos/${owner}/${repo}/git/commits/${input.expectedHead}`,
    );
    let parent = input.expectedHead;
    let tree = base.tree.sha;
    const commitShas: string[] = [];
    for (const step of input.steps) {
      const entries = await mapWithConcurrency(step.files, BLOB_UPLOAD_CONCURRENCY, async (f) => {
        if ("blobSha" in f) return { path: f.path, mode: "100644", type: "blob", sha: f.blobSha };
        if (f.content === null) return { path: f.path, mode: "100644", type: "blob", sha: null };
        if (f.encoding === "base64") {
          const sha = await this.createBlob(input.coords, f.content, "base64");
          return { path: f.path, mode: "100644", type: "blob", sha };
        }
        return { path: f.path, mode: "100644", type: "blob", content: f.content };
      });
      const newTree = await this.request<{ sha: string }>("POST", `/repos/${owner}/${repo}/git/trees`, {
        base_tree: tree,
        tree: entries,
      });
      const commit = await this.request<{ sha: string }>("POST", `/repos/${owner}/${repo}/git/commits`, {
        message: step.message,
        tree: newTree.sha,
        parents: [parent],
      });
      commitShas.push(commit.sha);
      parent = commit.sha;
      tree = newTree.sha;
    }
    if (input.beforeMove) await input.beforeMove(commitShas);
    const now = await this.getRefSha(input.coords, `heads/${branch}`);
    if (now !== input.expectedHead) throw new HeadMovedError(input.expectedHead, now);
    if (input.signal?.aborted) throw new Error("commit attempt aborted before the ref move");
    const timeout = AbortSignal.timeout(input.moveTimeoutMs ?? 20_000);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    try {
      await this.request("PATCH", `/repos/${owner}/${repo}/git/refs/heads/${branch}`, { sha: parent }, signal);
    } catch (e) {
      if (isNotFastForward(e)) throw new HeadMovedError(input.expectedHead, null);
      throw e;
    }
    return { commitShas, head: parent };
  }

  async listCommits(
    coords: RepoCoords,
    opts: { perPage?: number; path?: string; sha?: string } = {},
  ): Promise<Array<{ sha: string; message: string; date: string }>> {
    // `path` scopes history to commits that touched one file (per-chapter
    // history): GitHub returns only commits changing that path, newest first.
    // `sha` starts the walk at a branch or commit: only commits reachable from it.
    const pathParam =
      (opts.path ? `&path=${encodeURIComponent(opts.path)}` : "") +
      (opts.sha ? `&sha=${encodeURIComponent(opts.sha)}` : "");
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
    /** New text or bytes, or an existing blob of this repository by id (nothing uploaded). */
    files: Array<{ path: string; content: string; encoding?: "utf-8" | "base64" } | { path: string; blobSha: string }>;
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
  ): Promise<{ url: string; servesBranch?: string | null }> {
    const base = `/repos/${coords.owner}/${coords.repo}/pages`;
    try {
      const existing = await this.request<{ html_url: string; build_type?: string; source?: { branch?: string } | null }>("GET", base);
      // Pages already on: say what it serves (the owner may have pointed it elsewhere).
      return { url: existing.html_url, servesBranch: existing.build_type === "workflow" ? null : (existing.source?.branch ?? null) };
    } catch (e) {
      if (!(e instanceof GitHubError && e.status === 404)) throw e;
    }
    const created = await this.request<{ html_url: string }>("POST", base, {
      source: { branch, path: "/" },
    });
    return { url: created.html_url, servesBranch: branch };
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

  /** A repository's visibility and the template it was generated from (null on 404). */
  async getRepo(coords: RepoCoords): Promise<{ private: boolean; template: string | null } | null> {
    try {
      const r = await this.request<{ private: boolean; template_repository?: { full_name?: string } | null }>(
        "GET", `/repos/${coords.owner}/${coords.repo}`);
      return { private: r.private, template: r.template_repository?.full_name ?? null };
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
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
   *
   * Loop r3 (P5.B.3.j): a comparison whose base is not an ancestor of head, or
   * that lists GitHub's maximum of 300 files, throws `CompareIncompleteError`
   * rather than return a list that may miss changes; reconcile then falls back
   * to comparing the whole tree (apps/web lib/repo-reader.ts).
   */
  async compareCommits(
    coords: RepoCoords,
    base: string | null,
    head: string,
  ): Promise<Array<{ path: string; status: "added" | "modified" | "removed" }>> {
    if (base === null || base === head) return [];
    const data = await this.request<{
      status?: string;
      files?: Array<{
        filename: string;
        status: string;
        previous_filename?: string;
      }>;
    }>(
      "GET",
      `/repos/${coords.owner}/${coords.repo}/compare/${base}...${head}`,
    );
    // Loop r3 (P5.B.3.j): "diverged"/"behind" means base is not an ancestor
    // of head; the files are then the diff from the merge base and may omit
    // changes made since `base`. A list at the cap may be cut short.
    if (data.status === "diverged" || data.status === "behind") {
      throw new CompareIncompleteError("not-ancestor");
    }
    if ((data.files?.length ?? 0) >= COMPARE_FILE_LIMIT) {
      throw new CompareIncompleteError("too-many-files");
    }
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
   * Every entry of the tree at a ref with its mode and type (Door C: a link is
   * mode 120000, a submodule type "commit"); `truncated` as for listTree.
   */
  async listTreeEntries(
    coords: RepoCoords,
    ref: string,
  ): Promise<{ entries: Array<{ path: string; mode: string; type: string; sha: string; size?: number }>; truncated: boolean }> {
    const data = await this.request<{ tree: Array<{ path: string; mode: string; type: string; sha: string; size?: number }>; truncated?: boolean }>(
      "GET", `/repos/${coords.owner}/${coords.repo}/git/trees/${ref}?recursive=1`);
    return { entries: data.tree.map((e) => ({ path: e.path, mode: e.mode, type: e.type, sha: e.sha, ...(typeof e.size === "number" ? { size: e.size } : {}) })), truncated: data.truncated === true };
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
  ): Promise<{ paths: string[]; entries: Array<{ path: string; sha: string }>; truncated: boolean }> {
    const data = await this.request<{
      tree: Array<{ path: string; type: string; sha?: string }>;
      truncated?: boolean;
    }>("GET", `/repos/${coords.owner}/${coords.repo}/git/trees/${ref}?recursive=1`);
    const blobs = data.tree.filter((e) => e.type === "blob");
    return {
      paths: blobs.map((e) => e.path),
      // Blob ids, for comparing content without downloading it (P5.B.3.g).
      entries: blobs.map((e) => ({ path: e.path, sha: e.sha ?? "" })),
      truncated: data.truncated === true,
    };
  }

  /**
   * A file's exact bytes at a ref, or null if absent (loop r4, P5.B.3.k). The
   * contents API inlines files up to 1 MB only — a larger file comes back
   * with `encoding: "none"` and no content — so a file it does not inline is
   * read through the git blobs API (up to 100 MB), by the blob id the
   * contents answer names (or, failing that, the tree at `ref`).
   */
  async getFileBytesAtRef(coords: RepoCoords, path: string, ref: string): Promise<Uint8Array | null> {
    let data: { content?: string; encoding?: string; sha?: string; size?: number };
    try {
      data = await this.request("GET", `/repos/${coords.owner}/${coords.repo}/contents/${path}?ref=${ref}`);
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
    if (
      typeof data.content === "string" &&
      (data.encoding === "base64" || (data.encoding === undefined && data.content !== ""))
    ) {
      return Buffer.from(data.content, "base64");
    }
    let sha = data.sha;
    if (!sha) {
      const tree = await this.listTree(coords, ref);
      sha = tree.entries.find((e) => e.path === path)?.sha;
      if (!sha) throw new Error(`no blob id for ${path} at ${ref}`);
    }
    return this.getBlob(coords, sha);
  }

  /**
   * Every file of the tree at `ref`, in ONE API request (GitHub's tarball,
   * served from its download host): path → bytes. Throws past `maxBytes`
   * unpacked. Counts as one request against the installation's hourly budget.
   */
  async getTreeArchive(coords: RepoCoords, ref: string, maxBytes = 200 * 1024 * 1024): Promise<Map<string, Uint8Array>> {
    const get = async (token: string) => this.fetchImpl(`https://api.github.com/repos/${coords.owner}/${coords.repo}/tarball/${encodeURIComponent(ref)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    let res = await get(await this.tokens.token());
    if (res.status === 401) { const fresh = await this.tokens.refresh(); if (fresh !== null) res = await get(fresh); }
    if (!res.ok || !res.arrayBuffer) {
      const text = await res.text().catch(() => "");
      throw new GitHubError(`GitHub tarball ${coords.owner}/${coords.repo}@${ref} failed`, res.status, text, { rateLimited: isRateLimitResponse(res, text), retryAt: retryAtOf(res) });
    }
    return readTarGz(new Uint8Array(await res.arrayBuffer()), maxBytes);
  }

  /** A blob's bytes by its id (git blobs API: up to 100 MB, always base64). */
  async getBlob(coords: RepoCoords, sha: string): Promise<Uint8Array> {
    const data = await this.request<{ content: string; encoding: string }>(
      "GET",
      `/repos/${coords.owner}/${coords.repo}/git/blobs/${sha}`,
    );
    if (data.encoding !== "base64") throw new Error(`unexpected blob encoding ${data.encoding}`);
    return Buffer.from(data.content, "base64");
  }

  /**
   * Read a UTF-8 file at a ref (commit/branch). Returns null if absent. Loop
   * r4 (P5.B.3.k sibling): a file over the contents API's 1 MB inline limit is
   * read whole through the blobs API — before r4 it came back as "".
   */
  async getFileAtRef(
    coords: RepoCoords,
    path: string,
    ref: string,
  ): Promise<string | null> {
    const bytes = await this.getFileBytesAtRef(coords, path, ref);
    return bytes === null ? null : Buffer.from(bytes).toString("utf8");
  }
}
