import { describe, expect, it } from "vitest";
import { GitHubClient } from "./client";
import type { FetchLike, FetchResponse } from "./http";

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function ok(json: unknown, status = 200): FetchResponse {
  return { ok: true, status, json: async () => json, text: async () => "" };
}
function notFound(): FetchResponse {
  return { ok: false, status: 404, json: async () => ({}), text: async () => "Not Found" };
}

const coords = { owner: "edu", repo: "thermo-oer" };

describe("publishToBranch", () => {
  it("creates a fresh root commit and creates the branch if absent", async () => {
    const calls: Call[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (method === "POST" && url.endsWith("/git/trees")) return ok({ sha: "TREE" });
      if (method === "POST" && url.endsWith("/git/commits")) return ok({ sha: "COMMIT" });
      if (method === "GET" && url.includes("/git/ref/heads/gh-pages")) return notFound();
      if (method === "POST" && url.endsWith("/git/refs")) return ok({});
      throw new Error(`unexpected ${method} ${url}`);
    };
    const client = new GitHubClient("t", fetchImpl);
    const { commitSha } = await client.publishToBranch({
      coords,
      branch: "gh-pages",
      message: "Build site",
      files: [{ path: "index.html", content: "<h1>hi</h1>" }],
    });
    expect(commitSha).toBe("COMMIT");
    // Root commit: no parents.
    const commit = calls.find((c) => c.url.endsWith("/git/commits"))!;
    expect((commit.body as { parents: unknown[] }).parents).toEqual([]);
    // Branch created via POST refs.
    expect(calls.some((c) => c.url.endsWith("/git/refs") && c.method === "POST")).toBe(true);
  });

  it("force-updates an existing branch", async () => {
    const calls: Call[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (method === "POST" && url.endsWith("/git/trees")) return ok({ sha: "TREE" });
      if (method === "POST" && url.endsWith("/git/commits")) return ok({ sha: "COMMIT2" });
      if (method === "GET" && url.includes("/git/ref/heads/gh-pages")) return ok({ object: { sha: "OLD" } });
      if (method === "GET" && url.includes("/git/commits/OLD")) return ok({ tree: { sha: "OLDTREE" } });
      if (method === "PATCH" && url.includes("/git/refs/heads/gh-pages")) return ok({});
      throw new Error(`unexpected ${method} ${url}`);
    };
    const client = new GitHubClient("t", fetchImpl);
    await client.publishToBranch({ coords, branch: "gh-pages", message: "m", files: [{ path: "index.html", content: "x" }] });
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect((patch.body as { force: boolean }).force).toBe(true);
  });
});

describe("enablePages", () => {
  it("returns the existing site URL when Pages is already on", async () => {
    const fetchImpl: FetchLike = async (url) =>
      url.endsWith("/pages")
        ? ok({ html_url: "https://edu.github.io/thermo-oer/" })
        : notFound();
    const client = new GitHubClient("t", fetchImpl);
    expect((await client.enablePages(coords, "gh-pages")).url).toBe(
      "https://edu.github.io/thermo-oer/",
    );
  });

  it("enables Pages (POST) when not yet configured", async () => {
    const calls: Call[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (method === "GET" && url.endsWith("/pages")) return notFound();
      if (method === "POST" && url.endsWith("/pages"))
        return ok({ html_url: "https://edu.github.io/thermo-oer/" }, 201);
      throw new Error(`unexpected ${method} ${url}`);
    };
    const client = new GitHubClient("t", fetchImpl);
    const { url } = await client.enablePages(coords, "gh-pages");
    expect(url).toBe("https://edu.github.io/thermo-oer/");
    const post = calls.find((c) => c.method === "POST")!;
    expect((post.body as { source: { branch: string } }).source.branch).toBe("gh-pages");
  });
});

describe("publishToBranch — bounded blob uploads", () => {
  it("[P5.B.2.a] uploads 150 binary files with at most 8 blob requests in flight, all of them in the tree", async () => {
    let inflight = 0;
    let max = 0;
    let blobs = 0;
    let tree: Array<{ path: string; sha: string }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url.includes("/git/ref/heads/gh-pages")) return notFound();
      if (method === "POST" && url.endsWith("/git/blobs")) {
        const n = ++blobs;
        inflight++;
        max = Math.max(max, inflight);
        await new Promise((r) => setTimeout(r, 2));
        inflight--;
        return ok({ sha: `b${n}` });
      }
      if (method === "POST" && url.endsWith("/git/trees")) {
        tree = JSON.parse(init!.body!).tree;
        return ok({ sha: "TREE" });
      }
      if (method === "POST" && url.endsWith("/git/commits")) return ok({ sha: "COMMIT" });
      if (method === "POST" && url.endsWith("/git/refs")) return ok({});
      throw new Error(`unexpected ${method} ${url}`);
    };
    const client = new GitHubClient("t", fetchImpl);
    const files = Array.from({ length: 150 }, (_, i) => ({
      path: `assets/img${i}.png`,
      content: "aGVsbG8=",
      encoding: "base64" as const,
    }));
    await client.publishToBranch({ coords, branch: "gh-pages", message: "m", files });
    expect(blobs).toBe(150);
    expect(max).toBeLessThanOrEqual(8);
    expect(max).toBeGreaterThan(1); // still parallel, just bounded
    // Order and pairing preserved: entry i is file i.
    expect(tree.map((e) => e.path)).toEqual(files.map((f) => f.path));
    expect(new Set(tree.map((e) => e.sha)).size).toBe(150);
  });
});
