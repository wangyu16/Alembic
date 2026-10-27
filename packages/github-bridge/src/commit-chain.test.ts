/**
 * Workspace v3 write path §3.2 step 4 and §5 (claims A4.3, A4.7, A4.8):
 * a chain of commits moves the branch once, and only from the head the
 * caller decided against.
 */
import { describe, expect, it } from "vitest";
import { GitHubClient, HeadMovedError, type FetchLike, type FetchResponse } from "./index";

const ok = (json: unknown): FetchResponse => ({ ok: true, status: 200, json: async () => json, text: async () => "" });
const coords = { owner: "o", repo: "r" };

function repo(opts: { onBeforePatch?: (state: { head: string }) => void; refReads?: (n: number, state: { head: string }) => void } = {}) {
  const state = { head: "h0" };
  const commits: Array<{ sha: string; parents: string[]; tree: string; message: string }> = [];
  const trees: Array<{ base: string; entries: unknown[] }> = [];
  let patches = 0;
  let refReads = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method === "GET" && url.includes("/git/ref/heads/")) {
      refReads++;
      opts.refReads?.(refReads, state);
      return ok({ object: { sha: state.head } });
    }
    if (method === "GET" && url.includes("/git/commits/")) return ok({ tree: { sha: `t-${url.split("/").pop()}` } });
    if (method === "POST" && url.endsWith("/git/trees")) {
      trees.push({ base: body.base_tree, entries: body.tree });
      return ok({ sha: `tree-${trees.length}` });
    }
    if (method === "POST" && url.endsWith("/git/commits")) {
      const sha = `c-${commits.length + 1}`;
      commits.push({ sha, parents: body.parents, tree: body.tree, message: body.message });
      return ok({ sha });
    }
    if (method === "PATCH") {
      patches++;
      opts.onBeforePatch?.(state);
      const target = body.sha as string;
      // Non-force: the new commit must descend from the current head.
      let walk: string | undefined = target;
      const seen = new Set<string>();
      while (walk && walk !== state.head && !seen.has(walk)) {
        seen.add(walk);
        walk = commits.find((c) => c.sha === walk)?.parents[0];
      }
      if (walk !== state.head) return { ok: false, status: 422, json: async () => ({}), text: async () => "Update is not a fast forward" };
      state.head = target;
      return ok({});
    }
    throw new Error(`${method} ${url}`);
  };
  return { client: new GitHubClient("t", fetchImpl, { retry: { maxRetries: 0 } }), state, commits, trees, patches: () => patches };
}

describe("commitChain", () => {
  it("A4.3 builds kept then top as a chain and moves the branch once", async () => {
    const r = repo();
    const out = await r.client.commitChain({
      coords,
      expectedHead: "h0",
      steps: [
        { message: "kept", files: [{ path: "study-guide/a.md", content: "theirs" }] },
        { message: "top", files: [{ path: "study-guide/a.md", content: "mine" }] },
      ],
    });
    expect(out).toEqual({ commitShas: ["c-1", "c-2"], head: "c-2" });
    expect(r.commits[0]!.parents).toEqual(["h0"]);
    expect(r.commits[1]!.parents).toEqual(["c-1"]);
    expect(r.trees[1]!.base).toBe("tree-1");
    expect(r.patches()).toBe(1);
    expect(r.state.head).toBe("c-2");
  });

  it("A4.7 a push that lands meanwhile: refused, nothing moved", async () => {
    const r = repo({ refReads: (n, s) => { if (n === 1) s.head = "h1"; } });
    await expect(
      r.client.commitChain({ coords, expectedHead: "h0", steps: [{ message: "m", files: [{ path: "x.md", content: "a" }] }] }),
    ).rejects.toBeInstanceOf(HeadMovedError);
    expect(r.state.head).toBe("h1");
    expect(r.patches()).toBe(0);
  });

  it("A4.7 a push between the head check and the ref move: the non-force update refuses", async () => {
    const r = repo({ onBeforePatch: (s) => { s.head = "h-other"; } });
    await expect(
      r.client.commitChain({ coords, expectedHead: "h0", steps: [{ message: "m", files: [{ path: "x.md", content: "a" }] }] }),
    ).rejects.toBeInstanceOf(HeadMovedError);
    expect(r.state.head).toBe("h-other");
  });

  it("A4.8 a rewind (force-push to an older commit) is caught before the move", async () => {
    const r = repo({ refReads: (n, s) => { if (n === 1) s.head = "h-older"; } });
    await expect(
      r.client.commitChain({ coords, expectedHead: "h0", steps: [{ message: "m", files: [{ path: "x.md", content: "a" }] }] }),
    ).rejects.toMatchObject({ name: "HeadMovedError", actual: "h-older" });
    expect(r.patches()).toBe(0);
  });

  it("reuses existing blobs and deletes paths", async () => {
    const r = repo();
    await r.client.commitChain({
      coords,
      expectedHead: "h0",
      steps: [{ message: "m", files: [{ path: "assets/a.png", blobSha: "blob-1" }, { path: "old.md", content: null }] }],
    });
    expect(r.trees[0]!.entries).toEqual([
      { path: "assets/a.png", mode: "100644", type: "blob", sha: "blob-1" },
      { path: "old.md", mode: "100644", type: "blob", sha: null },
    ]);
  });
});
