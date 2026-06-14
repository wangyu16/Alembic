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
