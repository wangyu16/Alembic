/** Claims A2.1 and A2.9 of docs/specs/v3/permissions-v3.md. */
import { describe, expect, it } from "vitest";
import { ACCESS_MATRIX, ACTIONS, can, canAgent, canWritePath, editActionForPath, ROLES } from "./access";

describe("A2.1 the matrix", () => {
  it("has an entry for every action and role", () => {
    for (const a of ACTIONS) for (const r of ROLES) expect(ACCESS_MATRIX[a][r], `${a}/${r}`).toBeDefined();
  });

  it("matches the design's owner-only, deputy and co-author rows", () => {
    const ownerOnly = ["publish.first", "list", "share", "license.change", "members.manage", "snapshot.restore-course",
      "coursewerk.update", "handout", "transfer", "archive", "allowance.fund"] as const;
    for (const a of ownerOnly) {
      expect(can("owner", a), a).toBe(true);
      for (const r of ["deputy", "co-author", "agent", "none"] as const) expect(can(r, a), `${a}/${r}`).toBe(false);
    }
    for (const a of ["approve.plan", "publish.later", "publish.anyway", "obligation.confirm", "suggestion.decide", "update.take"] as const) {
      expect(can("deputy", a), a).toBe(true);
      expect(can("co-author", a), a).toBe(false);
    }
    expect(can("owner", "member.leave")).toBe(false);
    expect(can("co-author", "member.leave")).toBe(true);
  });

  it("nobody but the operator moderates; the operator edits nothing", () => {
    for (const a of ["list.moderate", "share.moderate", "transfer.succession", "audit.view", "allowance.grant"] as const) {
      expect(can("operator", a)).toBe(true);
      expect(can("owner", a)).toBe(false);
    }
    for (const a of ["edit.materials", "edit.plan", "edit.private", "publish.later"] as const) expect(can("operator", a)).toBe(false);
  });

  it("`none` may do nothing", () => {
    for (const a of ACTIONS) expect(can("none", a, { actorId: "u", uploaderId: "u", sharedWithCourse: true, addressedTo: ["u"], githubCollaborator: true, aiAllowed: true, path: "study-guide/x.md" }), a).toBe(false);
  });

  it("source files: uploader or shared only; the agent only with AI allowed", () => {
    expect(can("co-author", "source.see-file", { actorId: "a", uploaderId: "a" })).toBe(true);
    expect(can("owner", "source.see-file", { actorId: "o", uploaderId: "a" })).toBe(false);
    expect(can("owner", "source.see-file", { actorId: "o", uploaderId: "a", sharedWithCourse: true })).toBe(true);
    expect(can("agent", "source.use-ai", { aiAllowed: false })).toBe(false);
    expect(can("agent", "source.use-ai", { aiAllowed: true })).toBe(true);
  });

  it("co-author conditionals: addressed items, materials-only outside edits, GitHub only when added", () => {
    expect(can("co-author", "both-changed.decide", { actorId: "a", addressedTo: ["b"] })).toBe(false);
    expect(can("co-author", "both-changed.decide", { actorId: "a", addressedTo: ["a"] })).toBe(true);
    expect(can("co-author", "edited-elsewhere.accept-undo", { path: "study-guide/x.md" })).toBe(true);
    expect(can("co-author", "edited-elsewhere.accept-undo", { path: "concepts/x.md" })).toBe(false);
    expect(can("co-author", "github.direct")).toBe(false);
    expect(can("co-author", "github.direct", { githubCollaborator: true })).toBe(true);
  });
});

describe("A2.9 the agent is capped by its invoker", () => {
  it("canAgent ⊆ can(invoker) for every action, role and context", () => {
    const ctxs = [{}, { aiAllowed: true }, { path: "study-guide/x.md" }, { actorId: "a", uploaderId: "a", sharedWithCourse: true, addressedTo: ["a"], githubCollaborator: true }];
    for (const inv of ROLES) for (const a of ACTIONS) for (const c of ctxs) {
      if (canAgent(inv, a, c)) expect(can(inv, a, c), `${inv}/${a}`).toBe(true);
    }
  });
  it("an agent started by nobody can do nothing", () => {
    for (const a of ACTIONS) expect(canAgent("none", a, { aiAllowed: true })).toBe(false);
  });
});

describe("path → edit action", () => {
  it("maps spaces and refuses server-only, harness and manifest paths", () => {
    expect(editActionForPath("study-guide/x.md")).toBe("edit.materials");
    expect(editActionForPath("slides/x.slides.md")).toBe("edit.materials");
    expect(editActionForPath("concepts/x.md")).toBe("edit.plan");
    expect(editActionForPath("assessment-support/x.md")).toBe("edit.plan");
    expect(editActionForPath("private/instructor/key.md")).toBe("edit.private");
    expect(editActionForPath("README.md")).toBe("edit.course-files");
    for (const p of ["alembic.json", "LICENSE", "CITATION.cff", ".github/workflows/x.yml", ".alembic/a.json", ".gitignore",
      "private/sources/src_abcdefghijklmnopqrstuvwxyz.json", "private/coursewerk/LOG.jsonl", "private/legacy/x.md"]) {
      expect(editActionForPath(p), p).toBeNull();
    }
  });
  it("co-authors can't edit course files; nobody writes server-only paths", () => {
    expect(canWritePath("co-author", "README.md")).toBe(false);
    expect(canWritePath("deputy", "README.md")).toBe(true);
    for (const r of ROLES) expect(canWritePath(r, ".github/workflows/deploy.yml", { invoker: "owner" }), r).toBe(false);
    expect(canWritePath("agent", "study-guide/x.md", { invoker: "co-author" })).toBe(true);
    expect(canWritePath("agent", "README.md", { invoker: "co-author" })).toBe(false);
    expect(canWritePath("agent", "study-guide/x.md")).toBe(false);
  });
  it("rejects hostile paths before mapping", () => {
    expect(() => editActionForPath("study-guide/../private/instructor/k.md")).toThrow();
  });
});
