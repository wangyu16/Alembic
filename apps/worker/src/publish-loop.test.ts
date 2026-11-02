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
  it("[K1.24] defaults are titled with the course, never fetch the network, and a missing link or include is a note, not a stop", () => {
    const c = siteConfig(null, "Gen Chem", defaults);
    expect(c).toMatchObject({ delivery: "cdn", inline: [], includes: { network: false, missing: "warn" }, links: { missing: "warn" }, index: { mode: "auto", title: "Gen Chem" } });
  });
  it("a course's own orz-site.json is honoured except inline delivery and network includes", () => {
    const c = siteConfig({ format: 1, delivery: "inline", inline: ["**"], includes: { network: true, allowedHosts: ["example.org"] }, naming: "family" }, "T", defaults);
    expect(c).toMatchObject({ delivery: "cdn", inline: [], includes: { network: false, allowedHosts: ["example.org"] }, naming: "family" });
    expect(c).not.toHaveProperty("index");
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
