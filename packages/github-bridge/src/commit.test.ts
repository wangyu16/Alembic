import { describe, expect, it } from "vitest";
import { GitHubClient } from "./client";
import { commitFiles, type CommitPlan } from "./index";
import type { FetchLike, FetchResponse } from "./http";

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function ok(json: unknown): FetchResponse {
  return { ok: true, status: 200, json: async () => json, text: async () => "" };
}

/** Routes the Git Data API commit dance by method + path. */
function commitMock(): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (method === "GET" && url.includes("/git/ref/heads/")) {
      return ok({ object: { sha: "PARENT" } });
    }
    if (method === "GET" && url.includes("/git/commits/")) {
      return ok({ tree: { sha: "BASETREE" } });
    }
    if (method === "POST" && url.endsWith("/git/blobs")) {
      return ok({ sha: "BLOBSHA" });
    }
    if (method === "POST" && url.endsWith("/git/trees")) {
      return ok({ sha: "NEWTREE" });
    }
    if (method === "POST" && url.endsWith("/git/commits")) {
      return ok({ sha: "NEWCOMMIT" });
    }
    if (method === "PATCH" && url.includes("/git/refs/heads/")) {
      return ok({});
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  };
  return { fetchImpl, calls };
}

const coords = { owner: "edu", repo: "thermo-oer" };

describe("commitFiles", () => {
  it("creates one commit via the Git Data API with the file set", async () => {
    const { fetchImpl, calls } = commitMock();
    const client = new GitHubClient("ghs_x", fetchImpl);
    const plan: CommitPlan = {
      repo: "public",
      summary: "Update study guide",
      changes: [{ path: "study-guide/01.md", content: "# Ch1" }],
    };
    const { commitSha } = await commitFiles(client, coords, plan);
    expect(commitSha).toBe("NEWCOMMIT");

    const tree = calls.find((c) => c.url.endsWith("/git/trees"))!;
    expect((tree.body as { base_tree: string }).base_tree).toBe("BASETREE");
    expect((tree.body as { tree: unknown[] }).tree).toContainEqual({
      path: "study-guide/01.md",
      mode: "100644",
      type: "blob",
      content: "# Ch1",
    });
    const commit = calls.find((c) => c.url.endsWith("/git/commits") && c.method === "POST")!;
    expect((commit.body as { message: string }).message).toBe("Update study guide");
  });

  it("encodes a deletion as a null-sha tree entry", async () => {
    const { fetchImpl, calls } = commitMock();
    const client = new GitHubClient("ghs_x", fetchImpl);
    await commitFiles(client, coords, {
      repo: "public",
      summary: "remove",
      changes: [{ path: "materials/old.md", content: null }],
    });
    const tree = calls.find((c) => c.url.endsWith("/git/trees"))!;
    expect((tree.body as { tree: unknown[] }).tree).toContainEqual({
      path: "materials/old.md",
      mode: "100644",
      type: "blob",
      sha: null,
    });
  });

  it("uploads base64 (binary) content as a blob and references it by sha", async () => {
    const { fetchImpl, calls } = commitMock();
    const client = new GitHubClient("ghs_x", fetchImpl);
    await commitFiles(client, coords, {
      repo: "public",
      summary: "add figure",
      changes: [
        { path: "materials/figures/plot.png", content: "iVBORw0KGgo=", encoding: "base64" },
      ],
    });

    // A blob is created with base64 encoding...
    const blob = calls.find((c) => c.url.endsWith("/git/blobs"))!;
    expect(blob.method).toBe("POST");
    expect(blob.body).toEqual({ content: "iVBORw0KGgo=", encoding: "base64" });

    // ...and the tree references it by sha, NOT by inline (base64-as-text) content.
    const tree = calls.find((c) => c.url.endsWith("/git/trees"))!;
    expect((tree.body as { tree: unknown[] }).tree).toContainEqual({
      path: "materials/figures/plot.png",
      mode: "100644",
      type: "blob",
      sha: "BLOBSHA",
    });
    const entry = (tree.body as { tree: Array<Record<string, unknown>> }).tree[0];
    expect(entry).not.toHaveProperty("content");
  });

  it("REFUSES a private path in a public commit before any network call", async () => {
    const { fetchImpl, calls } = commitMock();
    const client = new GitHubClient("ghs_x", fetchImpl);
    const plan: CommitPlan = {
      repo: "public",
      summary: "sneaky",
      changes: [
        { path: "study-guide/01.md", content: "ok" },
        { path: "private-instructor/keys.md", content: "answers" },
      ],
    };
    await expect(commitFiles(client, coords, plan)).rejects.toThrow(
      /never be written/,
    );
    expect(calls).toHaveLength(0); // nothing touched the transport
  });
});

/**
 * A mock whose repository tree contains exactly `paths`, and whose create-tree
 * rejects a deletion of anything outside it — the way GitHub really behaves
 * (422 `GitRPC::BadObjectState`).
 */
function repoWithTree(
  paths: string[],
  opts: { truncated?: boolean } = {},
): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (method === "GET" && url.includes("/git/ref/heads/")) {
      return ok({ object: { sha: "PARENT" } });
    }
    if (method === "GET" && url.includes("/git/commits/")) {
      return ok({ tree: { sha: "BASETREE" } });
    }
    if (method === "GET" && url.includes("/git/trees/") && url.includes("recursive")) {
      return ok({
        tree: paths.map((p) => ({ path: p, type: "blob" })),
        truncated: opts.truncated === true,
      });
    }
    if (method === "POST" && url.endsWith("/git/blobs")) return ok({ sha: "BLOBSHA" });
    if (method === "POST" && url.endsWith("/git/trees")) {
      const body = init?.body ? JSON.parse(init.body) : { tree: [] };
      const entries = (body.tree ?? []) as Array<{ path: string; sha: string | null }>;
      const phantom = entries.find(
        (e) => e.sha === null && !paths.includes(e.path),
      );
      if (phantom) {
        return {
          ok: false,
          status: 422,
          json: async () => ({ message: "GitRPC::BadObjectState" }),
          text: async () => '{"message":"GitRPC::BadObjectState"}',
        };
      }
      return ok({ sha: "NEWTREE" });
    }
    if (method === "POST" && url.endsWith("/git/commits")) return ok({ sha: "NEWCOMMIT" });
    if (method === "PATCH" && url.includes("/git/refs/heads/")) return ok({});
    throw new Error(`unexpected request: ${method} ${url}`);
  };
  return { fetchImpl, calls };
}

describe("commitFiles — deletions of paths the repo doesn't have", () => {
  // Regression: a populate run computed its deletions from the app's projection,
  // which named a placeholder the repository had never been given. GitHub failed
  // the whole create-tree with 422 GitRPC::BadObjectState, taking every unrelated
  // write in that chunk with it (observed live: 206 files in, then the chunk died).
  it("drops a deletion for a path absent from the repo, and still writes the rest", async () => {
    const { fetchImpl, calls } = repoWithTree(["study-guide/01.md"]);
    const client = new GitHubClient("ghs_x", fetchImpl);

    const { commitSha } = await commitFiles(client, coords, {
      repo: "public",
      summary: "Upload package contents",
      changes: [
        { path: "study-guide/02.md", content: "# Two" },
        // never existed in the repository — the phantom deletion
        { path: "study-guide/01-getting-started.md", content: null },
      ],
    });

    expect(commitSha).toBe("NEWCOMMIT");
    const tree = calls.find((c) => c.url.endsWith("/git/trees"))!;
    const entries = (tree.body as { tree: Array<{ path: string }> }).tree;
    expect(entries.map((e) => e.path)).toEqual(["study-guide/02.md"]);
  });

  it("still deletes a path the repo really has", async () => {
    const { fetchImpl, calls } = repoWithTree(["study-guide/01.md", "study-guide/stale.md"]);
    const client = new GitHubClient("ghs_x", fetchImpl);

    await commitFiles(client, coords, {
      repo: "public",
      summary: "Remove a file",
      changes: [{ path: "study-guide/stale.md", content: null }],
    });

    const tree = calls.find((c) => c.url.endsWith("/git/trees"))!;
    const entries = (tree.body as { tree: Array<{ path: string; sha: string | null }> }).tree;
    expect(entries).toEqual([
      { path: "study-guide/stale.md", mode: "100644", type: "blob", sha: null },
    ]);
  });

  it("keeps every deletion when the tree listing is TRUNCATED (absence unprovable)", async () => {
    // A deletion can be security-relevant (leak remediation). If we cannot prove
    // the path is absent, obey the caller and let GitHub have the last word.
    const { fetchImpl, calls } = repoWithTree(["study-guide/01.md"], { truncated: true });
    const client = new GitHubClient("ghs_x", fetchImpl);

    await expect(
      commitFiles(client, coords, {
        repo: "public",
        summary: "Remove a file",
        changes: [{ path: "materials/leaked.md", content: null }],
      }),
    ).rejects.toThrow();

    const tree = calls.find((c) => c.url.endsWith("/git/trees"))!;
    const entries = (tree.body as { tree: Array<{ path: string }> }).tree;
    expect(entries.map((e) => e.path)).toEqual(["materials/leaked.md"]);
  });

  it("makes no commit at all when every requested change is a no-op deletion", async () => {
    const { fetchImpl, calls } = repoWithTree(["study-guide/01.md"]);
    const client = new GitHubClient("ghs_x", fetchImpl);

    const { commitSha } = await commitFiles(client, coords, {
      repo: "public",
      summary: "Clear placeholders",
      changes: [{ path: "study-guide/never-existed.md", content: null }],
    });

    // The branch head is returned unchanged; no empty commit is created.
    expect(commitSha).toBe("PARENT");
    expect(calls.some((c) => c.url.endsWith("/git/trees") && c.method === "POST")).toBe(false);
    expect(calls.some((c) => c.url.endsWith("/git/commits") && c.method === "POST")).toBe(false);
  });
});
