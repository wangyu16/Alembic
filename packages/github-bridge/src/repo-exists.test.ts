import { describe, expect, it } from "vitest";
import { GitHubClient } from "./client";
import type { FetchLike, FetchResponse } from "./http";

function ok(json: unknown): FetchResponse {
  return { ok: true, status: 200, json: async () => json, text: async () => "" };
}
function status(code: number): FetchResponse {
  return { ok: false, status: code, json: async () => ({}), text: async () => "err" };
}

const coords = { owner: "edu", repo: "thermo-oer" };

describe("repoExists", () => {
  it("returns true when the repo responds 200", async () => {
    const fetchImpl: FetchLike = async () => ok({ default_branch: "main" });
    const client = new GitHubClient("t", fetchImpl);
    expect(await client.repoExists(coords)).toBe(true);
  });

  it("returns false on a 404 (deleted or never created)", async () => {
    const fetchImpl: FetchLike = async () => status(404);
    const client = new GitHubClient("t", fetchImpl);
    expect(await client.repoExists(coords)).toBe(false);
  });

  it("propagates non-404 errors so a transient failure isn't read as deletion", async () => {
    const fetchImpl: FetchLike = async () => status(500);
    const client = new GitHubClient("t", fetchImpl);
    await expect(client.repoExists(coords)).rejects.toThrow();
  });
});
