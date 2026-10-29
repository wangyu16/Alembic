import { describe, expect, it } from "vitest";
import { publicRepoName } from "./publish-loop";
import { pagesUrl, siteInput } from "./site-build-loop";

describe("publish and site helpers", () => {
  it("the public repo is named after the working repo, without -private", () => {
    expect(publicRepoName("gen-chem-a1b2c3-private")).toBe("gen-chem-a1b2c3");
    expect(publicRepoName("odd-name")).toBe("odd-name-public");
  });

  it("hidden files and folders are never site input", () => {
    for (const p of [".github/workflows/x.yml", ".alembic/build/build-site.mjs", ".gitignore", "study-guide/.draft.md"]) expect(siteInput(p)).toBe(false);
    for (const p of ["study-guide/atoms.md", "README.md", "assets/fig.png", "alembic.json"]) expect(siteInput(p)).toBe(true);
  });

  it("a project Pages site lives under the repo name, owner lower-cased", () => {
    expect(pagesUrl({ owner: "FishDream25", repo: "chem" })).toBe("https://fishdream25.github.io/chem/");
  });
});

import { siteConfig } from "./orz-site-builder";

describe("the website config (review r2 H-A)", () => {
  const defaults = { format: 1, delivery: "cdn", inline: [], includes: { allowedHosts: [], network: true, missing: "error" }, index: { mode: "auto", title: null } };
  it("defaults are titled with the course and never fetch the network", () => {
    const c = siteConfig(null, "Gen Chem", defaults);
    expect(c).toMatchObject({ delivery: "cdn", inline: [], includes: { network: false, missing: "error" }, index: { mode: "auto", title: "Gen Chem" } });
  });
  it("a course's own orz-site.json is honoured except inline delivery and network includes", () => {
    const c = siteConfig({ format: 1, delivery: "inline", inline: ["**"], includes: { network: true, allowedHosts: ["example.org"] }, naming: "family" }, "T", defaults);
    expect(c).toMatchObject({ delivery: "cdn", inline: [], includes: { network: false, allowedHosts: ["example.org"] }, naming: "family" });
    expect(c).not.toHaveProperty("index");
  });
});

import { archiveReader } from "./publish-loop";

describe("reading a course for Publish (RC.11)", () => {
  it("[RC.11] reading every file of a 330-file course at one commit costs one archive request; a failed request isn't kept", async () => {
    let calls = 0;
    let fail = true;
    const files = new Map(Array.from({ length: 330 }, (_, k) => [`study-guide/ch${k}.md`, new TextEncoder().encode(`# ${k}`)]));
    const client = { async getTreeArchive() { calls++; if (fail) { fail = false; throw new Error("rate limited"); } return files; } };
    const read = archiveReader(client as never, { owner: "o", repo: "r" });
    await expect(read("W", "study-guide/ch0.md")).rejects.toThrow("rate limited");
    const got = await Promise.all([...files.keys()].map((p) => read("W", p)));
    expect(got.every((b) => b !== null)).toBe(true);
    expect(await read("W", "missing.md")).toBeNull();
    expect(calls).toBe(2); // the failed one, then one for all 330 reads
  });
});

import { GitHubError } from "@alembic/github-bridge";
import { failureReason } from "./publish-loop";

describe("a Publish that fails (RC.12)", () => {
  it("[RC.12] a GitHub rate limit is named, with when to publish again; other failures stay general", () => {
    const limited = new GitHubError("GitHub GET x failed", 403, "API rate limit exceeded", { rateLimited: true, retryAt: new Date("2026-10-29T05:03:00Z") });
    expect(failureReason(limited)).toMatch(/GitHub is limiting how often Alembic may use this course's account.*Publish again after 12:03 AM CDT\./);
    expect(failureReason(new Error("boom"))).toMatch(/^Publish couldn't finish/);
  });
});
