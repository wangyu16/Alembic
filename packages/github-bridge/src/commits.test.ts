import { describe, expect, it } from "vitest";
import { GitHubClient } from "./client";
import type { FetchLike, FetchResponse } from "./http";

function ok(json: unknown): FetchResponse {
  return { ok: true, status: 200, json: async () => json, text: async () => "" };
}

const coords = { owner: "edu", repo: "thermo-oer" };
const sample = [
  { sha: "AAA", commit: { message: "Edit ch1", author: { date: "2026-06-18T10:00:00Z" } } },
];

describe("listCommits", () => {
  it("scopes history to one file when a path is given (per-chapter)", async () => {
    let calledUrl = "";
    const fetchImpl: FetchLike = async (url) => {
      calledUrl = url;
      return ok(sample);
    };
    const client = new GitHubClient("t", fetchImpl);
    const res = await client.listCommits(coords, { perPage: 15, path: "study-guide/02-acids.md" });
    expect(res).toEqual([{ sha: "AAA", message: "Edit ch1", date: "2026-06-18T10:00:00Z" }]);
    expect(calledUrl).toContain("per_page=15");
    expect(calledUrl).toContain("path=study-guide%2F02-acids.md");
  });

  it("omits the path filter when none is given", async () => {
    let calledUrl = "";
    const fetchImpl: FetchLike = async (url) => {
      calledUrl = url;
      return ok(sample);
    };
    const client = new GitHubClient("t", fetchImpl);
    await client.listCommits(coords);
    expect(calledUrl).not.toContain("path=");
  });
});
