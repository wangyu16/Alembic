/**
 * Loop r5 — a commit rebuilt after GitHub's 422 "not a fast forward" is
 * guarded in every repository (P5.B.3.q): before rebuilding, each path the
 * commit writes or deletes must have the same blob id at the new head as in
 * the tree the first attempt was built on. Before r5 only the public repo's
 * synced-point comparison ran again, so a private repository's rebuild wrote
 * over another tab's save of the same file (probe R5-4).
 */
import { describe, expect, it } from "vitest";
import { GitHubClient, RemoteChangedError, type FetchLike, type FetchResponse } from "./index";

const ok = (json: unknown): FetchResponse => ({ ok: true, status: 200, json: async () => json, text: async () => "" });
const coords = { owner: "o", repo: "r" };

/** One branch; the first PATCH loses to another save that changed `movedPath`. */
function repo(opts: { movedPath: string; truncated?: boolean }) {
  let head = "h0";
  const trees: Record<string, Record<string, string>> = {
    "t-h0": { "notes/a.md": "blob-a0", "notes/b.md": "blob-b0" },
  };
  let patches = 0;
  const writes: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && url.includes("/git/ref/heads/")) return ok({ object: { sha: head } });
    if (method === "GET" && url.includes("/git/commits/")) return ok({ tree: { sha: `t-${url.split("/").pop()}` } });
    if (method === "GET" && url.includes("/git/trees/")) {
      const id = url.split("/git/trees/")[1]!.split("?")[0]!;
      const files = trees[id] ?? {};
      return ok({
        tree: Object.entries(files).map(([path, sha]) => ({ path, type: "blob", sha })),
        truncated: opts.truncated === true,
      });
    }
    if (method === "POST" && url.endsWith("/git/trees")) return (writes.push("tree"), ok({ sha: `nt-${writes.length}` }));
    if (method === "POST" && url.endsWith("/git/commits")) return (writes.push("commit"), ok({ sha: `c-${writes.length}` }));
    if (method === "PATCH") {
      patches++;
      if (patches === 1) {
        // Another tab's save lands first.
        head = "h1";
        trees["t-h1"] = { ...trees["t-h0"]!, [opts.movedPath]: "blob-other" };
        return { ok: false, status: 422, json: async () => ({}), text: async () => "Update is not a fast forward" };
      }
      writes.push("patch");
      return ok({});
    }
    throw new Error(`${method} ${url}`);
  };
  return { client: new GitHubClient("t", fetchImpl, { retry: { maxRetries: 0 } }), writes: () => writes, patches: () => patches };
}

describe("a rebuilt commit is guarded in every repository (loop r5, P5.B.3.q)", () => {
  it("[P5.B.3.q] the same file saved meanwhile is refused on rebuild, with no outside-change point (private repository, R5-4)", async () => {
    const r = repo({ movedPath: "notes/a.md" });
    const err = await r.client
      .createCommitOnBranch({ coords, message: "m", files: [{ path: "notes/a.md", content: "mine" }] })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(RemoteChangedError);
    expect((err as RemoteChangedError).reason).toBe("overlap");
    expect((err as RemoteChangedError).paths).toEqual(["notes/a.md"]);
    // Only the first attempt's tree and commit were built; the branch never moved for us.
    expect(r.writes()).toEqual(["tree", "commit"]);
    expect(r.patches()).toBe(1);
  });

  it("[P5.B.3.q] a different file saved meanwhile: the rebuild lands on the new head", async () => {
    const r = repo({ movedPath: "notes/b.md" });
    await expect(
      r.client.createCommitOnBranch({ coords, message: "m", files: [{ path: "notes/a.md", content: "mine" }] }),
    ).resolves.toMatchObject({ parentSha: "h1" });
    expect(r.writes()).toContain("patch");
  });

  it("[P5.B.3.q] a deletion is guarded too, and a listing that may be incomplete refuses", async () => {
    const del = repo({ movedPath: "notes/b.md" });
    const e1 = await del.client
      .createCommitOnBranch({ coords, message: "m", files: [{ path: "notes/b.md", content: null }] })
      .then(() => null, (e: unknown) => e);
    expect(e1).toBeInstanceOf(RemoteChangedError);
    const cut = repo({ movedPath: "notes/b.md", truncated: true });
    const e2 = await cut.client
      .createCommitOnBranch({ coords, message: "m", files: [{ path: "notes/a.md", content: "mine" }] })
      .then(() => null, (e: unknown) => e);
    expect(e2).toBeInstanceOf(RemoteChangedError);
    expect((e2 as RemoteChangedError).reason).toBe("unverifiable");
  });
});
