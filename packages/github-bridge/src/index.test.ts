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

/**
 * The dual-mode check (v1 layers OR v2 spaces) lets a native-v2 path commit —
 * `current/` has no v1 layer at all. An OR is exactly the shape that can widen
 * a security boundary by accident, so probe it from both sides: every v2-only
 * public space must pass, and EVERY private path under EITHER contract must
 * still be rejected for the public repo. See package-contract's
 * `contract-agreement.test.ts` for the property this rests on.
 */
describe("validateCommitPlan — dual-mode contract (v1 layers OR v2 spaces)", () => {
  const publicPlan = (path: string): CommitPlan => ({
    repo: "public",
    summary: "t",
    changes: [{ path, content: "x" }],
  });
  const privatePlan = (path: string): CommitPlan => ({
    repo: "private",
    summary: "t",
    changes: [{ path, content: "x" }],
  });

  it("accepts v2-only public spaces (the reason this change exists)", () => {
    for (const path of [
      "current/2026-spring/syllabus.pdf",
      "current/2026-spring/chapters/02-step/worksheet.pdf",
      "assets/chapters/02-step/fig.svg",
    ]) {
      expect(() => validateCommitPlan(publicPlan(path)), path).not.toThrow();
    }
  });

  it("still accepts v1 public layers (no regression for existing packages)", () => {
    for (const path of [
      "materials/structures/benzene.ketcher.svg",
      "materials/chapters/02-step/fig.svg",
      "study-guide/01-intro.md",
    ]) {
      expect(() => validateCommitPlan(publicPlan(path)), path).not.toThrow();
    }
  });

  it("rejects EVERY private path for the public repo, under either contract", () => {
    for (const path of [
      "private-instructor/notes.md", // v1 private layer
      "private-instructor/chapters/02-step/rubric.md", // nested v1 private
      "private/notes.md", // v2 private space
      "private/chapters/02-step/rubric.md", // nested v2 private
    ]) {
      expect(() => validateCommitPlan(publicPlan(path)), path).toThrow();
    }
  });

  it("rejects public paths staged into the PRIVATE repo (the invariant runs both ways)", () => {
    for (const path of ["materials/fig.svg", "assets/fig.svg", "current/x.pdf", "study-guide/a.md"]) {
      expect(() => validateCommitPlan(privatePlan(path)), path).toThrow();
    }
  });

  it("still fails closed on paths neither contract knows, and on traversal", () => {
    for (const path of ["bogus/x.md", "../etc/passwd", "study-guide/../private-instructor/k.md"]) {
      expect(() => validateCommitPlan(publicPlan(path)), path).toThrow();
      expect(() => validateCommitPlan(privatePlan(path)), path).toThrow();
    }
  });

  it("accepts root-allowlisted housekeeping files in either repo", () => {
    for (const path of ["alembic.json", "README.md"]) {
      expect(() => validateCommitPlan(publicPlan(path)), path).not.toThrow();
      expect(() => validateCommitPlan(privatePlan(path)), path).not.toThrow();
    }
  });

  it("rejects a plan that smuggles one private file among valid v2 public ones", () => {
    const plan: CommitPlan = {
      repo: "public",
      summary: "innocuous-looking save",
      changes: [
        { path: "current/2026-spring/syllabus.pdf", content: "ok" },
        { path: "assets/fig.svg", content: "ok" },
        { path: "private/answer-keys/quiz1.md", content: "answers" },
      ],
    };
    expect(() => validateCommitPlan(plan)).toThrow();
  });
});
