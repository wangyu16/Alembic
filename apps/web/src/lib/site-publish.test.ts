import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GitHubClient, type FetchLike } from "@alembic/github-bridge";
import { courseSiteFiles, pushCourseSite } from "./site-publish";
import { emptyOutcome, publishNotes } from "./publish-report";

/**
 * A minimal in-memory GitHub git-data API: content-addressed trees (so the same
 * file set gets the same tree sha, as on GitHub), root commits, refs.
 */
function fakeGitHub() {
  const refs = new Map<string, string>();
  const commits = new Map<string, { tree: string }>();
  let n = 0;
  const res = (status: number, body: unknown) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname.replace(/^\/repos\/[^/]+\/[^/]+/, "");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/git\/ref\/(.+)$/))) {
      const sha = refs.get(m[1]!);
      return sha ? res(200, { object: { sha } }) : res(404, "Not Found");
    }
    if (path === "/git/blobs" && method === "POST") {
      return res(201, { sha: createHash("sha1").update(body.content).digest("hex") });
    }
    if (path === "/git/trees" && method === "POST") {
      const entries = [...body.tree].sort((a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path));
      return res(201, { sha: createHash("sha1").update(JSON.stringify(entries)).digest("hex") });
    }
    if ((m = path.match(/^\/git\/commits\/(.+)$/)) && method === "GET") {
      const c = commits.get(m[1]!);
      return c ? res(200, { sha: m[1], tree: { sha: c.tree } }) : res(404, "Not Found");
    }
    if (path === "/git/commits" && method === "POST") {
      const sha = `c${++n}`;
      commits.set(sha, { tree: body.tree });
      return res(201, { sha });
    }
    if (path === "/git/refs" && method === "POST") {
      refs.set(String(body.ref).replace(/^refs\//, ""), body.sha);
      return res(201, {});
    }
    if ((m = path.match(/^\/git\/refs\/(.+)$/)) && method === "PATCH") {
      refs.set(m[1]!, body.sha);
      return res(200, {});
    }
    return res(404, `unhandled ${method} ${path}`);
  };
  return { fetch, refs, commitCount: () => commits.size };
}

const course = {
  baseHref: "/chem-oer/",
  title: "General Chemistry",
  chapters: [{ slug: "atoms", title: "Atoms", viewHref: "chapters/atoms.md.html" }],
  license: "CC-BY-4.0" as const,
  theme: "light" as const,
};
const coords = { owner: "edu", repo: "chem-oer" };

describe("publish website — the same course twice", () => {
  it("[P5.B.2.a] publishing the same course twice (minutes apart) makes no second commit and the report says it was unchanged", async () => {
    const gh = fakeGitHub();
    const client = new GitHubClient("tok", gh.fetch, { retry: { sleep: async () => {} } });
    const page = { path: "chapters/atoms.md.html", content: "<p>atoms</p>" };

    const first = emptyOutcome();
    const a = await pushCourseSite(client, coords, [...courseSiteFiles(course, new Date("2026-10-23T10:00:00Z")), page], first);
    expect(a.unchanged).toBe(false);
    expect(gh.commitCount()).toBe(1);

    const second = emptyOutcome();
    const b = await pushCourseSite(client, coords, [...courseSiteFiles(course, new Date("2026-10-23T10:05:00Z")), page], second);
    expect(b).toEqual({ commitSha: a.commitSha, unchanged: true });
    expect(gh.commitCount()).toBe(1);
    expect(gh.refs.get("heads/gh-pages")).toBe(a.commitSha);
    expect(second.unchanged).toBe(true);
    expect(publishNotes(second)).toContain("already up to date");
  });

  it("[P5.B.2.h] a changed course is published and not reported as unchanged", async () => {
    const gh = fakeGitHub();
    const client = new GitHubClient("tok", gh.fetch, { retry: { sleep: async () => {} } });
    await pushCourseSite(client, coords, courseSiteFiles(course), emptyOutcome());
    const o = emptyOutcome();
    const r = await pushCourseSite(client, coords, courseSiteFiles({ ...course, title: "Gen Chem II" }), o);
    expect(r.unchanged).toBe(false);
    expect(o.unchanged).toBe(false);
    expect(gh.commitCount()).toBe(2);
  });

  it("[P5.B.2.a] the publish action builds and pushes through these helpers (no second, timestamped path)", () => {
    const src = readFileSync(new URL("../app/workspace/[packageId]/site-actions.ts", import.meta.url), "utf8");
    expect(src).toMatch(/courseSiteFiles\(/);
    expect(src).toMatch(/pushCourseSite\(/);
    expect(src).not.toMatch(/buildCourseSite\(/);
    expect(src).not.toMatch(/publishToBranch\(/);
    expect(src).not.toMatch(/builtAt:/);
  });
});
