import { describe, expect, it } from "vitest";
import { validateCommitPlan, type CommitPlan } from "./index";

describe("validateCommitPlan", () => {
  it("accepts a public commit touching only public layers", () => {
    const plan: CommitPlan = {
      repo: "public",
      summary: "Update chapter 1 study guide",
      changes: [
        { path: "study-guide/ch01.md", content: "# Ch 1" },
        { path: "alembic.json", content: "{}" },
      ],
    };
    expect(() => validateCommitPlan(plan)).not.toThrow();
  });

  it("rejects a public commit smuggling one private file among public ones", () => {
    const plan: CommitPlan = {
      repo: "public",
      summary: "innocuous-looking save",
      changes: [
        { path: "study-guide/ch01.md", content: "# Ch 1" },
        { path: "private-instructor/answer-keys/quiz1.md", content: "answers" },
      ],
    };
    expect(() => validateCommitPlan(plan)).toThrow(/never be written/);
  });

  it("rejects private-path deletes in the public repo too (a delete implies it was staged)", () => {
    const plan: CommitPlan = {
      repo: "public",
      summary: "cleanup",
      changes: [{ path: "private-instructor/notes.md", content: null }],
    };
    expect(() => validateCommitPlan(plan)).toThrow();
  });
});
