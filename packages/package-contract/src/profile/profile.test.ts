import { describe, expect, it } from "vitest";
import { activeProfile, coursewerkOerProfileForTests, unitPartForPath } from "./test-exports";
import { can, editActionForPath } from "../access";

describe("the content profile (FD-10)", () => {
  it("[K1.17] the active profile is Coursewerk's OER profile, versioned, and every part path maps back to its part", () => {
    expect(activeProfile).toBe(coursewerkOerProfileForTests);
    expect(activeProfile.version).toMatch(/^0\.11\.0/);
    for (const p of activeProfile.unitParts) expect(unitPartForPath(p.path("gases"))).toEqual({ part: p.id, slug: "gases" });
    expect(unitPartForPath("study-guide/a/b.md")).toBeNull();
    expect(unitPartForPath("assets/gases.md")).toBeNull();
  });
  it("[K1.17] a listed chapter without its study guide is a problem the profile names", () => {
    const files = new Set(["study-guide/gases.md"]);
    expect(activeProfile.unitProblems([{ slug: "gases", title: "Gases" }], files)).toEqual([]);
    expect(activeProfile.unitProblems([{ slug: "atoms", title: "Atoms" }], files)).toEqual(["Chapter “Atoms” has no study guide."]);
  });
});

describe("instructor documents and the core's own files (contract v3 §12)", () => {
  it("[K1.14] instructor documents are writable by edit.private roles; the template's private/README.md and the licence files by nobody", () => {
    expect(editActionForPath("private/instructor/exam-1.md")).toBe("edit.private");
    expect(editActionForPath("private/README.md")).toBeNull();
    expect(editActionForPath("private/sources/src_aaaaaaaaaaaaaaaaaaaaaaaaaa.json")).toBeNull();
    expect(editActionForPath("LICENSE")).toBeNull();
    expect(editActionForPath("alembic.json")).toBeNull();
    expect(editActionForPath("README.md")).toBe("edit.course-files");
    expect(editActionForPath("concepts/course.md")).toBe("edit.plan");
    expect(editActionForPath("slides/gases.slides.md")).toBe("edit.materials");
  });
  it("[K1.13] deleting in private/ is the owner's and deputy's only", () => {
    expect(can("owner", "delete.private")).toBe(true);
    expect(can("deputy", "delete.private")).toBe(true);
    expect(can("co-author", "delete.private")).toBe(false);
    expect(can("agent", "delete.private")).toBe(false);
  });
});
