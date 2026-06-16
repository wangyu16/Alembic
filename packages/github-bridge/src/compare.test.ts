import { describe, expect, it } from "vitest";
import { GitHubClient } from "./client";
import type { FetchLike, FetchResponse } from "./http";

interface Call {
  method: string;
  url: string;
}

function ok(json: unknown): FetchResponse {
  return { ok: true, status: 200, json: async () => json, text: async () => "" };
}

/** Fake transport returning a canned compare payload, tracking every call. */
function compareMock(payload: unknown): {
  fetchImpl: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? "GET", url });
    if (url.includes("/compare/")) return ok(payload);
    throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`);
  };
  return { fetchImpl, calls };
}

const coords = { owner: "edu", repo: "thermo-oer" };

describe("GitHubClient.compareCommits", () => {
  it("returns [] without a network call when base is null", async () => {
    const { fetchImpl, calls } = compareMock({ files: [] });
    const client = new GitHubClient("ghs_x", fetchImpl);
    const result = await client.compareCommits(coords, null, "HEAD");
    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("returns [] without a network call when base === head", async () => {
    const { fetchImpl, calls } = compareMock({ files: [] });
    const client = new GitHubClient("ghs_x", fetchImpl);
    const result = await client.compareCommits(coords, "SAME", "SAME");
    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("uses the three-dot compare endpoint", async () => {
    const { fetchImpl, calls } = compareMock({ files: [] });
    const client = new GitHubClient("ghs_x", fetchImpl);
    await client.compareCommits(coords, "BASE", "HEAD");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain(
      "/repos/edu/thermo-oer/compare/BASE...HEAD",
    );
  });

  it("maps added, modified, and removed files", async () => {
    const { fetchImpl } = compareMock({
      files: [
        { filename: "a.md", status: "added" },
        { filename: "b.md", status: "modified" },
        { filename: "c.md", status: "removed" },
      ],
    });
    const client = new GitHubClient("ghs_x", fetchImpl);
    const result = await client.compareCommits(coords, "BASE", "HEAD");
    expect(result).toEqual([
      { path: "a.md", status: "added" },
      { path: "b.md", status: "modified" },
      { path: "c.md", status: "removed" },
    ]);
  });

  it("maps copied to added and changed to modified", async () => {
    const { fetchImpl } = compareMock({
      files: [
        { filename: "a.md", status: "copied" },
        { filename: "b.md", status: "changed" },
      ],
    });
    const client = new GitHubClient("ghs_x", fetchImpl);
    const result = await client.compareCommits(coords, "BASE", "HEAD");
    expect(result).toEqual([
      { path: "a.md", status: "added" },
      { path: "b.md", status: "modified" },
    ]);
  });

  it("expands a renamed file into a removed(previous) + added(current) pair", async () => {
    const { fetchImpl } = compareMock({
      files: [
        {
          filename: "new/name.md",
          status: "renamed",
          previous_filename: "old/name.md",
        },
      ],
    });
    const client = new GitHubClient("ghs_x", fetchImpl);
    const result = await client.compareCommits(coords, "BASE", "HEAD");
    expect(result).toEqual([
      { path: "old/name.md", status: "removed" },
      { path: "new/name.md", status: "added" },
    ]);
  });

  it("emits only an added entry for a rename missing previous_filename", async () => {
    const { fetchImpl } = compareMock({
      files: [{ filename: "new/name.md", status: "renamed" }],
    });
    const client = new GitHubClient("ghs_x", fetchImpl);
    const result = await client.compareCommits(coords, "BASE", "HEAD");
    expect(result).toEqual([{ path: "new/name.md", status: "added" }]);
  });

  it("skips unchanged files", async () => {
    const { fetchImpl } = compareMock({
      files: [
        { filename: "a.md", status: "modified" },
        { filename: "b.md", status: "unchanged" },
      ],
    });
    const client = new GitHubClient("ghs_x", fetchImpl);
    const result = await client.compareCommits(coords, "BASE", "HEAD");
    expect(result).toEqual([{ path: "a.md", status: "modified" }]);
  });

  it("tolerates a missing files array", async () => {
    const { fetchImpl } = compareMock({});
    const client = new GitHubClient("ghs_x", fetchImpl);
    const result = await client.compareCommits(coords, "BASE", "HEAD");
    expect(result).toEqual([]);
  });
});
