import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GitHubError } from "@alembic/github-bridge";
import { githubBusy } from "./github-busy";

describe("a rate-limited course page (RC.12)", () => {
  it("[RC.12] only a GitHub rate limit becomes the calm busy page, and the course, document and Publish pages all use it", () => {
    const at = new Date("2026-10-29T05:03:00Z");
    expect(githubBusy(new GitHubError("x", 403, "rate limit", { rateLimited: true, retryAt: at }))).toEqual({ until: at });
    expect(githubBusy(new GitHubError("x", 404))).toBeNull();
    expect(githubBusy(new Error("NEXT_REDIRECT"))).toBeNull();
    for (const p of ["course/page.tsx", "doc/[...path]/page.tsx", "publish/page.tsx"]) {
      const src = readFileSync(join(__dirname, "../app/workspace/[packageId]", p), "utf8");
      expect(src, p).toMatch(/export default async function \w+\(props[\s\S]*githubBusy\(e\)[\s\S]*<GithubBusy/);
    }
    // The Publish page's actions that read GitHub turn a rate limit into a message too.
    const actions = readFileSync(join(__dirname, "../app/workspace/[packageId]/publish/actions.ts"), "utf8");
    for (const a of ["startPlanAction", "setChapterModeAction"]) expect(actions, a).toMatch(new RegExp(`export async function ${a}\\([^)]*\\)[^{]*\\{\\s*return withGithub\\(`));
  });
});
