/**
 * Publish robustness against a fake GitHub (Phase 5 Track B.2): idempotent
 * publish, retry with backoff on 5xx / rate limits (honoring Retry-After),
 * no replay of non-idempotent requests, installation-token refresh.
 *
 * The fake is a small stateful Git Data API: content-addressed blobs and
 * trees (same files → same tree sha, as on GitHub), commits, refs — plus a
 * fault queue to inject failures per route.
 */
import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { installationTokenSource } from "./app-auth";
import { GitHubClient } from "./client";
import { GitHubError, type FetchLike, type FetchResponse } from "./http";
import { commitFiles } from "./index";

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

interface Fault {
  /** e.g. "POST /git/trees" — matched against method + path suffix. */
  route: string;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  /** Throw (a dropped connection) instead of answering. */
  network?: boolean;
  /** Apply the request's effect, THEN fail (a 502 after GitHub did the work). */
  afterEffect?: boolean;
}

function res(status: number, json: unknown, headers: Record<string, string> = {}): FetchResponse {
  const text = typeof json === "string" ? json : JSON.stringify(json);
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
    headers: { get: (n: string) => h.get(n.toLowerCase()) ?? null },
  };
}

class FakeGitHub {
  blobs = new Map<string, string>();
  trees = new Map<string, Map<string, string>>(); // tree sha → path → blob sha
  commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  refs = new Map<string, string>(); // "heads/main" → commit sha
  faults: Fault[] = [];
  calls: Array<{ method: string; path: string; auth: string }> = [];
  validTokens = new Set<string>(["tok-1"]);
  minted = 0;

  constructor() {
    const empty = this.putTree(new Map());
    const root = this.putCommit({ tree: empty, parents: [], message: "init" });
    this.refs.set("heads/main", root);
  }

  private putTree(entries: Map<string, string>): string {
    const sha = sha1(JSON.stringify([...entries].sort()));
    this.trees.set(sha, entries);
    return sha;
  }
  private putCommit(c: { tree: string; parents: string[]; message: string }): string {
    const sha = sha1(JSON.stringify(c) + this.commits.size);
    this.commits.set(sha, c);
    return sha;
  }
  commitCount() {
    return this.commits.size;
  }
  treeOf(ref: string): Map<string, string> {
    return this.trees.get(this.commits.get(this.refs.get(ref)!)!.tree)!;
  }

  fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const path = url.replace("https://api.github.com", "").replace(/\?.*$/, "");
    const auth = init?.headers?.["Authorization"] ?? "";
    this.calls.push({ method, path, auth });
    const fault = this.faults.find((f) => {
      const [m, suffix] = f.route.split(" ");
      return m === method && path.endsWith(suffix!);
    });
    if (fault && !fault.afterEffect) {
      this.faults.splice(this.faults.indexOf(fault), 1);
      if (fault.network) throw new TypeError("fetch failed");
      return res(fault.status ?? 500, fault.body ?? "boom", fault.headers);
    }
    const out = this.handle(method, path, auth, init?.body ? JSON.parse(init.body) : undefined);
    if (fault?.afterEffect) {
      this.faults.splice(this.faults.indexOf(fault), 1);
      return res(fault.status ?? 502, fault.body ?? "bad gateway", fault.headers);
    }
    return out;
  };

  private handle(method: string, path: string, auth: string, body: any): FetchResponse {
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/app\/installations\/(\w+)\/access_tokens$/)) && method === "POST") {
      this.minted++;
      const token = `tok-${this.minted + 1}`;
      this.validTokens.add(token);
      return res(201, { token, expires_at: new Date(Date.now() + 3600_000).toISOString() });
    }
    if (!this.validTokens.has(auth.replace("Bearer ", ""))) {
      return res(401, { message: "Bad credentials" });
    }
    const repo = "/repos/edu/chem-oer";
    if (!path.startsWith(repo)) return res(404, "nope");
    const p = path.slice(repo.length);
    if ((m = p.match(/^\/git\/ref\/(.+)$/)) && method === "GET") {
      const sha = this.refs.get(m[1]!);
      return sha ? res(200, { object: { sha } }) : res(404, { message: "Not Found" });
    }
    if ((m = p.match(/^\/git\/commits\/(\w+)$/)) && method === "GET") {
      const c = this.commits.get(m[1]!);
      return c ? res(200, { tree: { sha: c.tree } }) : res(404, "no commit");
    }
    if ((m = p.match(/^\/git\/trees\/(\w+)$/)) && method === "GET") {
      const t = this.trees.get(m[1]!);
      return res(200, { tree: [...t!.keys()].map((path) => ({ path, type: "blob" })), truncated: false });
    }
    if (p === "/git/blobs" && method === "POST") {
      const sha = sha1(`b64:${body.content}`);
      this.blobs.set(sha, body.content);
      return res(201, { sha });
    }
    if (p === "/git/trees" && method === "POST") {
      const entries = new Map(body.base_tree ? this.trees.get(body.base_tree)! : []);
      for (const e of body.tree) {
        if (e.sha === null) entries.delete(e.path);
        else if (e.sha) entries.set(e.path, e.sha);
        else {
          const sha = sha1(`txt:${e.content}`);
          this.blobs.set(sha, e.content);
          entries.set(e.path, sha);
        }
      }
      return res(201, { sha: this.putTree(entries) });
    }
    if (p === "/git/commits" && method === "POST") {
      return res(201, { sha: this.putCommit(body) });
    }
    if (p === "/git/refs" && method === "POST") {
      const name = body.ref.replace(/^refs\//, "");
      if (this.refs.has(name)) return res(422, { message: "Reference already exists" });
      this.refs.set(name, body.sha);
      return res(201, {});
    }
    if ((m = p.match(/^\/git\/refs\/(.+)$/)) && method === "PATCH") {
      this.refs.set(m[1]!, body.sha);
      return res(200, {});
    }
    return res(404, `unhandled ${method} ${p}`);
  }
}

const coords = { owner: "edu", repo: "chem-oer" };

/** The error a promise rejects with (fails the test if it resolves). */
async function failure(p: Promise<unknown>): Promise<GitHubError> {
  try {
    await p;
  } catch (e) {
    return e as GitHubError;
  }
  throw new Error("expected a rejection");
}
const site = (n: string) => [
  { path: "index.html", content: `<h1>${n}</h1>` },
  { path: "chapters/01.md.html", content: "<p>one</p>" },
  { path: "assets/fig.png", content: "iVBORw0KGgo=", encoding: "base64" as const },
];

function setup() {
  const gh = new FakeGitHub();
  const sleeps: number[] = [];
  const client = new GitHubClient("tok-1", gh.fetch, {
    retry: { sleep: async (ms) => void sleeps.push(ms), random: () => 1 },
  });
  return { gh, client, sleeps };
}

describe("publishToBranch — idempotent", () => {
  it("[P5.B.2.a] publishing the same site twice makes no second commit and leaves the branch alone", async () => {
    const { gh, client } = setup();
    const first = await client.publishToBranch({ coords, branch: "gh-pages", message: "Build site", files: site("A") });
    expect(first.unchanged).toBe(false);
    const commits = gh.commitCount();

    const second = await client.publishToBranch({ coords, branch: "gh-pages", message: "Build site", files: site("A") });
    expect(second).toEqual({ commitSha: first.commitSha, unchanged: true });
    expect(gh.commitCount()).toBe(commits);
    expect(gh.refs.get("heads/gh-pages")).toBe(first.commitSha);
    expect(gh.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("[P5.B.2.a] a changed site is a new root commit replacing the whole tree", async () => {
    const { gh, client } = setup();
    await client.publishToBranch({ coords, branch: "gh-pages", message: "m", files: site("A") });
    const r = await client.publishToBranch({
      coords, branch: "gh-pages", message: "m", files: [{ path: "index.html", content: "B" }],
    });
    expect(r.unchanged).toBe(false);
    expect([...gh.treeOf("heads/gh-pages").keys()]).toEqual(["index.html"]);
  });

  it("[P5.B.2.a] a branch created concurrently (422 on create) is overwritten, not an error", async () => {
    const { gh, client } = setup();
    // Another publish creates the branch between our read and our write.
    const original = gh.fetch;
    let raced = false;
    const racing: FetchLike = async (url, init) => {
      if (!raced && init?.method === "POST" && url.endsWith("/git/refs")) {
        raced = true;
        gh.refs.set("heads/gh-pages", [...gh.commits.keys()][0]!);
      }
      return original(url, init);
    };
    const c2 = new GitHubClient("tok-1", racing, { retry: { sleep: async () => {} } });
    const r = await c2.publishToBranch({ coords, branch: "gh-pages", message: "m", files: site("A") });
    expect(gh.refs.get("heads/gh-pages")).toBe(r.commitSha);
  });
});

describe("commits — no empty commits", () => {
  it("[P5.B.2.b] a write that changes nothing returns the current head and commits nothing", async () => {
    const { gh, client } = setup();
    const first = await commitFiles(client, coords, {
      repo: "public", summary: "Edit", changes: [{ path: "study-guide/ch1.md", content: "# One" }],
    });
    const commits = gh.commitCount();
    const again = await commitFiles(client, coords, {
      repo: "public", summary: "Edit", changes: [{ path: "study-guide/ch1.md", content: "# One" }],
    });
    expect(again.commitSha).toBe(first.commitSha);
    expect(gh.commitCount()).toBe(commits);
  });
});

describe("retries", () => {
  it("[P5.B.2.c] retries GitHub 5xx with growing backoff and then succeeds", async () => {
    const { gh, client, sleeps } = setup();
    gh.faults.push({ route: "POST /git/trees", status: 502 }, { route: "POST /git/trees", status: 503 });
    const r = await client.publishToBranch({ coords, branch: "gh-pages", message: "m", files: site("A") });
    expect(r.unchanged).toBe(false);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("[P5.B.2.c] gives up after the retry budget and leaves the live branch untouched", async () => {
    const { gh, client } = setup();
    await client.publishToBranch({ coords, branch: "gh-pages", message: "m", files: site("A") });
    const live = gh.refs.get("heads/gh-pages");
    for (let i = 0; i < 4; i++) gh.faults.push({ route: "POST /git/commits", status: 500 });
    const err = await failure(
      client.publishToBranch({ coords, branch: "gh-pages", message: "m", files: site("B") }),
    );
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).transient).toBe(true);
    expect(gh.refs.get("heads/gh-pages")).toBe(live);
  });

  it("[P5.B.2.d] honors Retry-After on a secondary rate limit", async () => {
    const { gh, client, sleeps } = setup();
    gh.faults.push({
      route: "POST /git/commits", status: 403, headers: { "Retry-After": "7" },
      body: '{"message":"You have exceeded a secondary rate limit"}',
    });
    await client.publishToBranch({ coords, branch: "gh-pages", message: "m", files: site("A") });
    expect(sleeps).toEqual([7000]);
  });

  it("[P5.B.2.d] retries a rate-limited NON-replayable request (it was not processed)", async () => {
    const { gh, client, sleeps } = setup();
    gh.faults.push({ route: "POST /git/refs", status: 429, headers: { "Retry-After": "2" } });
    await client.publishToBranch({ coords, branch: "gh-pages", message: "m", files: site("A") });
    expect(sleeps).toEqual([2000]);
    expect(gh.refs.has("heads/gh-pages")).toBe(true);
  });

  it("[P5.B.2.d] waits for a near primary rate-limit reset, gives up on a far one", async () => {
    const { gh, client, sleeps } = setup();
    const soon = Math.floor(Date.now() / 1000) + 10;
    gh.faults.push({
      route: "POST /git/trees", status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(soon) },
      body: "API rate limit exceeded",
    });
    await client.publishToBranch({ coords, branch: "gh-pages", message: "m", files: site("A") });
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(5000);
    expect(sleeps[0]).toBeLessThanOrEqual(12_000);

    const far = Math.floor(Date.now() / 1000) + 3000;
    gh.faults.push({
      route: "POST /git/trees", status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(far) },
      body: "API rate limit exceeded",
    });
    const err = await failure(
      client.publishToBranch({ coords, branch: "gh-pages", message: "m", files: site("B") }),
    );
    expect(err.rateLimited).toBe(true);
    expect(sleeps).toHaveLength(1);
  });

  it("[P5.B.2.e] does not retry a plain 403 (a permission problem, not a rate limit)", async () => {
    const { gh, client, sleeps } = setup();
    gh.faults.push({ route: "POST /git/trees", status: 403, body: '{"message":"Resource not accessible by integration"}' });
    const err = await failure(
      client.publishToBranch({ coords, branch: "gh-pages", message: "m", files: site("A") }),
    );
    expect(err.status).toBe(403);
    expect(err.rateLimited).toBe(false);
    expect(sleeps).toEqual([]);
  });

  it("[P5.B.2.e] never replays a non-idempotent request after a 5xx or a dropped connection", async () => {
    const { gh, client } = setup();
    gh.faults.push({ route: "POST /git/refs", status: 502, afterEffect: true });
    await expect(
      client.publishToBranch({ coords, branch: "gh-pages", message: "m", files: site("A") }),
    ).rejects.toBeInstanceOf(GitHubError);
    expect(gh.calls.filter((c) => c.method === "POST" && c.path.endsWith("/git/refs"))).toHaveLength(1);

    const { gh: gh2, client: c2 } = setup();
    gh2.faults.push({ route: "POST /git/refs", network: true });
    await expect(
      c2.publishToBranch({ coords, branch: "gh-pages", message: "m", files: site("A") }),
    ).rejects.toThrow(/fetch failed/);
  });

  it("[P5.B.2.e] retries a dropped connection on a replayable request", async () => {
    const { gh, client, sleeps } = setup();
    gh.faults.push({ route: "GET /git/ref/heads/main", network: true });
    await commitFiles(client, coords, {
      repo: "public", summary: "s", changes: [{ path: "study-guide/ch1.md", content: "x" }],
    });
    expect(sleeps).toEqual([1000]);
  });

  it("[P5.B.2.e] a ref update that landed before a 502 is safely replayed", async () => {
    const { gh, client } = setup();
    gh.faults.push({ route: "PATCH /git/refs/heads/main", status: 502, afterEffect: true });
    const r = await commitFiles(client, coords, {
      repo: "public", summary: "s", changes: [{ path: "study-guide/ch1.md", content: "x" }],
    });
    expect(gh.refs.get("heads/main")).toBe(r.commitSha);
  });

  it("[P5.B.2.f] the two-repo invariant is checked before any retry machinery runs", async () => {
    const { gh, client } = setup();
    await expect(
      commitFiles(client, coords, {
        repo: "public", summary: "leak", changes: [{ path: "private/notes/answers.md", content: "x" }],
      }),
    ).rejects.toThrow();
    expect(gh.calls).toHaveLength(0);
  });
});

describe("installation token refresh", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  it("[P5.B.2.g] a 401 mid-publish refreshes the installation token once and carries on", async () => {
    const gh = new FakeGitHub();
    const tokens = installationTokenSource({ appId: "1", privateKey: pem, installationId: 9, fetchImpl: gh.fetch });
    const client = new GitHubClient(tokens, gh.fetch, { retry: { sleep: async () => {} } });
    await client.publishToBranch({ coords, branch: "gh-pages", message: "m", files: site("A") });
    expect(gh.minted).toBe(1);
    // GitHub expires/revokes the token.
    gh.validTokens.clear();
    const r = await client.publishToBranch({ coords, branch: "gh-pages", message: "m", files: site("B") });
    expect(r.unchanged).toBe(false);
    expect(gh.minted).toBe(2);
  });

  it("[P5.B.2.g] a static token is not 'refreshed': the 401 surfaces", async () => {
    const { gh, client } = setup();
    gh.validTokens.clear();
    const err = await failure(
      client.publishToBranch({ coords, branch: "gh-pages", message: "m", files: site("A") }),
    );
    expect(err.status).toBe(401);
  });

  it("[P5.B.2.g] reuses a token until 5 minutes before expiry, then mints ahead of time", async () => {
    let now = Date.parse("2026-10-23T12:00:00Z");
    let minted = 0;
    const fetchImpl: FetchLike = async () => {
      minted++;
      return res(201, { token: `t${minted}`, expires_at: new Date(now + 3600_000).toISOString() });
    };
    const source = installationTokenSource({ appId: "1", privateKey: pem, installationId: 9, fetchImpl, now: () => now });
    expect(await source.token()).toBe("t1");
    now += 50 * 60_000;
    expect(await source.token()).toBe("t1");
    now += 6 * 60_000; // 4 min left
    expect(await source.token()).toBe("t2");
    // Concurrent callers share one mint.
    await source.refresh();
    const [a, b] = await Promise.all([source.refresh(), source.token()]);
    expect(a).toBe(b);
  });
});
