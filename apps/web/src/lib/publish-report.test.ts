import { describe, expect, it } from "vitest";
import { GitHubError } from "@alembic/github-bridge";
import { emptyOutcome, publishErrorMessage, publishNotes } from "./publish-report";

/** Words an educator must never see (Alembic CLAUDE.md; version contract). */
const GIT_WORDS = /\b(git|github api|branch|commit|repo|repository|push|merge|sha|http|gh-pages|4\d\d|5\d\d)\b/i;

describe("publishNotes — the partial-failure report", () => {
  it("[P5.B.2.h] says nothing when everything published", () => {
    expect(publishNotes(emptyOutcome())).toBeUndefined();
  });

  it("[P5.B.2.h] names every missing piece, by chapter, with what to do", () => {
    const text = publishNotes({
      ...emptyOutcome(),
      failedChapters: ["Acids and Bases"],
      missingSlides: ["Gases", "Kinetics"],
      missingPractice: ["Equilibrium"],
      emptyChapters: ["Thermochemistry"],
      privateLinks: 2,
      figuresNotCopied: 1,
    })!;
    expect(text).toContain("Acids and Bases");
    expect(text).toContain("Gases, Kinetics");
    expect(text).toContain("Equilibrium");
    expect(text).toContain("Thermochemistry");
    expect(text).toMatch(/2 links on your site point/);
    expect(text).toMatch(/One figure/);
    expect(text).toMatch(/publish again/i);
    expect(text).not.toMatch(GIT_WORDS);
  });

  it("[P5.B.2.h] an unchanged site is said plainly", () => {
    expect(publishNotes({ ...emptyOutcome(), unchanged: true })).toMatch(/already up to date/);
  });
});

describe("publishErrorMessage — educator wording, never GitHub's", () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ["rate limited", new GitHubError("GitHub POST /repos/a/b/git/trees failed", 403, "secondary rate limit", { rateLimited: true }), /busy right now/],
    ["5xx", new GitHubError("GitHub POST /repos/a/b/git/commits failed", 502, "<html>Bad Gateway</html>"), /didn't respond/],
    ["permission", new GitHubError("GitHub PATCH /repos/a/b/git/refs/heads/gh-pages failed", 403, "Resource not accessible by integration"), /Reconnect publishing/],
    ["anything else", new Error("GitRPC::BadObjectState"), /didn't complete/],
  ];
  for (const [name, err, expected] of cases) {
    it(`[P5.B.2.i] ${name}`, () => {
      const msg = publishErrorMessage(err);
      expect(msg).toMatch(expected);
      expect(msg).toMatch(/live website hasn't changed/);
      expect(msg).not.toMatch(GIT_WORDS);
      expect(msg).not.toContain("GitRPC");
    });
  }
});
