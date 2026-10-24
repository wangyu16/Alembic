/**
 * Loop r4 — the bridge reads exact bytes past the contents API's 1 MB limit
 * (P5.B.3.k) and rebuilds a commit once when the branch moved under it
 * (P5.B.3.n).
 */
import { describe, expect, it } from "vitest";
import { GitHubClient, type FetchLike, type FetchResponse } from "./index";

const ok = (json: unknown): FetchResponse => ({ ok: true, status: 200, json: async () => json, text: async () => "" });
const coords = { owner: "o", repo: "r" };

describe("bridge, loop r4", () => {
  it("[P5.B.3.k] a file the contents API does not inline is read through the blobs API, by the blob id it names", async () => {
    const bytes = Buffer.alloc(1_200_000, 0x41);
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url.replace("https://api.github.com/repos/o/r", ""));
      if (url.includes("/contents/")) return ok({ content: "", encoding: "none", sha: "blob1", size: bytes.length });
      if (url.endsWith("/git/blobs/blob1")) return ok({ content: bytes.toString("base64"), encoding: "base64" });
      throw new Error(url);
    };
    const out = await new GitHubClient("t", fetchImpl).getFileBytesAtRef(coords, "slides/big.slides.html", "h");
    expect(Buffer.from(out!).equals(bytes)).toBe(true);
    expect(calls).toEqual(["/contents/slides/big.slides.html?ref=h", "/git/blobs/blob1"]);
  });

  it("[P5.B.3.n] a 422 not-a-fast-forward is rebuilt on the new head once; a second one fails", async () => {
    for (const refusals of [1, 2]) {
      let headSha = "h0";
      let patches = 0;
      let heads = 0;
      const fetchImpl: FetchLike = async (url, init) => {
        const method = init?.method ?? "GET";
        if (method === "GET" && url.includes("/git/ref/heads/")) return (heads++, ok({ object: { sha: headSha } }));
        if (method === "GET" && url.includes("/git/commits/")) return ok({ tree: { sha: `t-${headSha}` } });
        if (method === "POST" && url.endsWith("/git/trees")) return ok({ sha: `nt-${heads}` });
        if (method === "POST" && url.endsWith("/git/commits")) return ok({ sha: `c-${heads}` });
        if (method === "PATCH") {
          patches++;
          if (patches <= refusals) {
            headSha = `moved-${patches}`;
            return { ok: false, status: 422, json: async () => ({}), text: async () => "Update is not a fast forward" };
          }
          return ok({});
        }
        throw new Error(`${method} ${url}`);
      };
      const client = new GitHubClient("t", fetchImpl, { retry: { maxRetries: 0 } });
      const run = client.createCommitOnBranch({ coords, message: "m", files: [{ path: "a.md", content: "x" }] });
      if (refusals === 1) {
        await expect(run).resolves.toEqual({ commitSha: "c-2", parentSha: "moved-1" });
        expect(heads).toBe(2);
      } else {
        await expect(run).rejects.toThrow(/fast forward/);
        expect(patches).toBe(2);
      }
    }
  });
});
