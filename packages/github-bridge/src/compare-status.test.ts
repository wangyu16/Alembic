/**
 * Loop r3 (LOW, P5.B.3.j): GitHub's compare reports `status` — "ahead" when
 * the base is an ancestor of the head, "diverged"/"behind" when it is not.
 * In the latter case `files` is the diff from the MERGE BASE, not from the
 * synced point, so it can miss an outside change entirely. Neither the save
 * guard nor reconcile may trust such a list. Also binds the blob-sha listing
 * the reconcile tree fallback needs (P5.B.3.g).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CompareIncompleteError, GitHubClient, RemoteChangedError, gitBlobSha } from "./client";
import { commitFiles, type CommitPlan } from "./index";
import type { FetchLike, FetchResponse } from "./http";

function ok(json: unknown): FetchResponse {
  return { ok: true, status: 200, json: async () => json, text: async () => "" };
}

function repo(compare: unknown) {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.replace(/^https:\/\/api\.github\.com/, "")}`);
    if (method === "GET" && url.includes("/git/ref/heads/")) return ok({ object: { sha: "HEAD" } });
    if (method === "GET" && url.includes("/git/commits/")) return ok({ tree: { sha: "BASETREE" } });
    if (method === "GET" && url.includes("/git/trees/")) {
      return ok({
        tree: [
          { path: "a.md", type: "blob", sha: "s1" },
          { path: "dir", type: "tree", sha: "t1" },
        ],
        truncated: false,
      });
    }
    if (method === "GET" && url.includes("/compare/")) return ok(compare);
    if (method === "POST" && url.endsWith("/git/trees")) return ok({ sha: "NEWTREE" });
    if (method === "POST" && url.endsWith("/git/commits")) return ok({ sha: "NEWCOMMIT" });
    if (method === "PATCH" && url.includes("/git/refs/heads/")) return ok({});
    throw new Error(`unexpected request: ${method} ${url}`);
  };
  return { client: new GitHubClient("ghs_x", fetchImpl), calls };
}

const coords = { owner: "edu", repo: "thermo-oer" };
const save: CommitPlan = {
  repo: "public",
  summary: "Save chapter",
  changes: [{ path: "study-guide/ch1.md", content: "# Heat\n" }],
};
const wrote = (calls: string[]) => calls.some((c) => c.startsWith("POST") || c.startsWith("PATCH"));

describe("compare status (loop r3, P5.B.3.j)", () => {
  for (const status of ["diverged", "behind"]) {
    it(`[P5.B.3.j] a "${status}" comparison is not trusted: compareCommits refuses to return its file list`, async () => {
      const { client } = repo({ status, files: [{ filename: "other.md", status: "modified" }] });
      await expect(client.compareCommits(coords, "SYNCED", "HEAD")).rejects.toBeInstanceOf(CompareIncompleteError);
    });

    it(`[P5.B.3.j] a "${status}" comparison makes the save guard refuse as unverifiable, writing nothing`, async () => {
      // The listed files do not overlap — trusting them would let the save through.
      const { client, calls } = repo({ status, files: [{ filename: "other.md", status: "modified" }] });
      const err = await commitFiles(client, coords, save, "main", { unchangedSince: "SYNCED" }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(RemoteChangedError);
      expect((err as RemoteChangedError).reason).toBe("unverifiable");
      expect(wrote(calls)).toBe(false);
    });
  }

  it("[P5.B.3.j] an \"ahead\" comparison is trusted as before", async () => {
    const { client, calls } = repo({ status: "ahead", files: [{ filename: "other.md", status: "modified" }] });
    const r = await commitFiles(client, coords, save, "main", { unchangedSince: "SYNCED" });
    expect(r.commitSha).toBe("NEWCOMMIT");
    expect(wrote(calls)).toBe(true);
  });

  it("[P5.B.3.j] a comparison listing GitHub's maximum of files is incomplete, not trusted", async () => {
    const files = Array.from({ length: 300 }, (_, i) => ({ filename: `x/${i}.md`, status: "modified" }));
    const { client } = repo({ status: "ahead", files });
    await expect(client.compareCommits(coords, "SYNCED", "HEAD")).rejects.toBeInstanceOf(CompareIncompleteError);
  });
});

describe("tree listing with blob shas (loop r3, P5.B.3.g)", () => {
  it("[P5.B.3.g] listTree returns each file's blob sha alongside its path", async () => {
    const { client } = repo({});
    const t = await client.listTree(coords, "HEAD");
    expect(t.paths).toEqual(["a.md"]);
    expect(t.entries).toEqual([{ path: "a.md", sha: "s1" }]);
  });

  it("[P5.B.3.g] gitBlobSha is git's blob id (sha1 of \"blob <len>\\0<bytes>\")", () => {
    const bytes = Buffer.from("héllo\n", "utf8");
    const expected = createHash("sha1")
      .update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
      .digest("hex");
    expect(gitBlobSha(bytes)).toBe(expected);
    // The well-known id of the empty blob.
    expect(gitBlobSha(new Uint8Array())).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });
});
