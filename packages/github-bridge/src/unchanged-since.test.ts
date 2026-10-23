/**
 * Loop r2 (MEDIUM-4, P5.B.3.f): a commit can be told which head the caller
 * last synced (`unchangedSince`). When the branch moved since then and the
 * outside change touched a path this commit writes or deletes, the commit is
 * refused BEFORE anything is written — otherwise a save that rewrites the
 * whole file (notably `alembic.json`) silently reverts the outside change.
 */
import { describe, expect, it } from "vitest";
import { GitHubClient } from "./client";
import * as bridge from "./index";
import { commitFiles, type CommitPlan } from "./index";
import type { FetchLike, FetchResponse } from "./http";

function ok(json: unknown): FetchResponse {
  return { ok: true, status: 200, json: async () => json, text: async () => "" };
}
function fail(status: number): FetchResponse {
  return { ok: false, status, json: async () => ({}), text: async () => "boom" };
}

/** The commit dance with a branch head of `HEAD`, and a canned comparison. */
function repo(compare: { files: Array<{ filename: string; status: string; previous_filename?: string }> } | "fails") {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.replace(/^https:\/\/api\.github\.com/, "")}`);
    if (method === "GET" && url.includes("/git/ref/heads/")) return ok({ object: { sha: "HEAD" } });
    if (method === "GET" && url.includes("/git/commits/")) return ok({ tree: { sha: "BASETREE" } });
    if (method === "GET" && url.includes("/git/trees/")) {
      return ok({ tree: [{ path: "materials/old.md", type: "blob" }], truncated: false });
    }
    if (method === "GET" && url.includes("/compare/")) return compare === "fails" ? fail(404) : ok(compare);
    if (method === "POST" && url.endsWith("/git/trees")) return ok({ sha: "NEWTREE" });
    if (method === "POST" && url.endsWith("/git/commits")) return ok({ sha: "NEWCOMMIT" });
    if (method === "PATCH" && url.includes("/git/refs/heads/")) return ok({});
    throw new Error(`unexpected request: ${method} ${url}`);
  };
  return { client: new GitHubClient("ghs_x", fetchImpl), calls };
}

const coords = { owner: "edu", repo: "thermo-oer" };
const manifestSave: CommitPlan = {
  repo: "public",
  summary: "Update course details",
  changes: [{ path: "alembic.json", content: '{"title":"New"}' }],
};
const wrote = (calls: string[]) => calls.some((c) => c.startsWith("POST") || c.startsWith("PATCH"));

describe("commitFiles: unchangedSince (loop r2, P5.B.3.f)", () => {
  it("[P5.B.3.f] reports the head the commit was built on", async () => {
    const { client } = repo({ files: [] });
    const r = await commitFiles(client, coords, manifestSave);
    expect(r).toEqual({ commitSha: "NEWCOMMIT", parentSha: "HEAD" });
  });

  it("[P5.B.3.f] an outside change to a file this commit writes is refused, and nothing is written", async () => {
    const { client, calls } = repo({ files: [{ filename: "alembic.json", status: "modified" }] });
    const err = await commitFiles(client, coords, manifestSave, "main", { unchangedSince: "SYNCED" }).then(
      () => null,
      (e: unknown) => e,
    );
    const RemoteChangedError = (bridge as Record<string, unknown>)["RemoteChangedError"] as
      | (new (...a: never[]) => Error)
      | undefined;
    expect(RemoteChangedError).toBeTypeOf("function");
    expect(err).toBeInstanceOf(RemoteChangedError!);
    expect((err as { paths: string[] }).paths).toEqual(["alembic.json"]);
    expect(calls).toContain("GET /repos/edu/thermo-oer/compare/SYNCED...HEAD");
    expect(wrote(calls)).toBe(false);
  });

  it("[P5.B.3.f] a planned DELETION of a file changed outside (incl. a rename's old name) is refused too", async () => {
    const { client, calls } = repo({
      files: [{ filename: "materials/new.md", status: "renamed", previous_filename: "materials/old.md" }],
    });
    await expect(
      commitFiles(
        client,
        coords,
        { repo: "public", summary: "remove", changes: [{ path: "materials/old.md", content: null }] },
        "main",
        { unchangedSince: "SYNCED" },
      ),
    ).rejects.toMatchObject({ name: "RemoteChangedError", paths: ["materials/old.md"] });
    expect(wrote(calls)).toBe(false);
  });

  it("[P5.B.3.f] an outside change to OTHER files does not block the commit", async () => {
    const { client, calls } = repo({ files: [{ filename: "study-guide/ch9.md", status: "added" }] });
    const r = await commitFiles(client, coords, manifestSave, "main", { unchangedSince: "SYNCED" });
    expect(r).toEqual({ commitSha: "NEWCOMMIT", parentSha: "HEAD" });
    expect(wrote(calls)).toBe(true);
  });

  it("[P5.B.3.f] head unchanged since the last sync: no comparison at all", async () => {
    const { client, calls } = repo("fails");
    await commitFiles(client, coords, manifestSave, "main", { unchangedSince: "HEAD" });
    expect(calls.some((c) => c.includes("/compare/"))).toBe(false);
  });

  it("[P5.B.3.f] a comparison that fails refuses the commit (fail closed)", async () => {
    const { client, calls } = repo("fails");
    await expect(
      commitFiles(client, coords, manifestSave, "main", { unchangedSince: "SYNCED" }),
    ).rejects.toMatchObject({ name: "RemoteChangedError" });
    expect(wrote(calls)).toBe(false);
  });

  it("[P5.B.3.f] callers that pass nothing (or null) keep the old behaviour", async () => {
    const { client, calls } = repo("fails");
    await commitFiles(client, coords, manifestSave, "main", { unchangedSince: null });
    expect(calls.some((c) => c.includes("/compare/"))).toBe(false);
    expect(wrote(calls)).toBe(true);
  });
});
