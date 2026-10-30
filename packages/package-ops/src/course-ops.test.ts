import { describe, expect, it } from "vitest";
import { applyCourseOp, parseCourseOp, type CourseOp } from "./course-ops";

const manifest = (chapters: Array<{ slug: string; title: string; mode?: string }>) =>
  `${JSON.stringify({ schemaVersion: 3, packageId: "pkg-x-abc123", title: "Chem", license: "CC-BY-4.0", createdAt: "2026-10-29T00:00:00Z", chapters: chapters.map((c) => ({ mode: "package", ...c })) }, null, 2)}\n`;
const parts = (slug: string) => [`concepts/${slug}.md`, `study-guide/${slug}.md`, `slides/${slug}.slides.md`, `assessment-support/${slug}.md`, `practice/${slug}.md`];
let n = 0;
const uid = () => `doc-test${String(++n).padStart(8, "0")}`;

/** Apply ops one after another at the head, as the committer does. */
function run(text: string, paths: Set<string>, ops: CourseOp[]) {
  const results = [];
  for (const op of ops) {
    const r = applyCourseOp(text, paths, op, uid);
    results.push(r);
    if (!r.ok) continue;
    for (const w of r.writes) (w.content === null ? paths.delete(w.path) : paths.add(w.path));
    text = r.writes.find((w) => w.path === "alembic.json")!.content!;
  }
  return { text, paths, results, chapters: JSON.parse(text).chapters as Array<{ slug: string; title: string; mode: string }> };
}

describe("course operations applied at the head (K1.15)", () => {
  it("[K1.15] two operations made from the same version both land, in order (no lost change, no browser re-apply)", () => {
    const start = manifest([{ slug: "gases", title: "Gases" }, { slug: "atoms", title: "Atoms" }]);
    const paths = new Set([...parts("gases"), ...parts("atoms")]);
    const out = run(start, paths, [
      { op: "renameChapter", slug: "gases", title: "The Gas Laws" },
      { op: "renameChapter", slug: "atoms", title: "Atomic Structure" },
      { op: "setChapterMode", slug: "atoms", mode: "draft" },
      { op: "moveChapter", slug: "atoms", toIndex: 0 },
    ]);
    expect(out.results.every((r) => r.ok)).toBe(true);
    expect(out.chapters).toEqual([{ slug: "atoms", title: "Atomic Structure", mode: "draft" }, { slug: "gases", title: "The Gas Laws", mode: "package" }]);
  });
  it("[K1.15] an operation that no longer applies is refused with a reason, and nothing is written", () => {
    const out = run(manifest([{ slug: "gases", title: "Gases" }]), new Set(parts("gases")), [
      { op: "removeChapter", slug: "gases" },
      { op: "renameChapter", slug: "gases", title: "Too late" },
    ]);
    expect(out.results[1]).toEqual({ ok: false, reason: "that chapter is no longer in the course" });
    expect(out.chapters).toEqual([]);
  });
  it("[K1.16] removing a chapter removes it and its part files in one change", () => {
    const r = applyCourseOp(manifest([{ slug: "gases", title: "Gases" }, { slug: "atoms", title: "Atoms" }]), new Set([...parts("gases"), ...parts("atoms"), "assets/gases/x.png"]), { op: "removeChapter", slug: "gases" }, uid);
    expect(r.ok && r.writes.filter((w) => w.content === null).map((w) => w.path).sort()).toEqual(parts("gases").sort());
    expect(r.ok && r.summary).toBe("Removed chapter “Gases”");
  });
  it("[K1.15] adding chapters starts the parts the profile requires (concept map, study guide, assessment guide), or all five; never a chapter without them", () => {
    const r = applyCourseOp(manifest([]), new Set(), { op: "addChapters", titles: ["Gases", "Atoms"], startParts: false }, uid);
    expect(r.ok && r.writes.map((w) => w.path)).toEqual(["alembic.json", "concepts/gases.md", "study-guide/gases.md", "assessment-support/gases.md", "concepts/atoms.md", "study-guide/atoms.md", "assessment-support/atoms.md"]);
    const all = applyCourseOp(manifest([]), new Set(), { op: "addChapters", titles: ["Gases"], startParts: true }, uid);
    expect(all.ok && all.writes.length).toBe(6);
  });
  it("[K1.15] a course that already breaks a rule can still be changed; an operation can't introduce a new break", () => {
    // "empty" lists no study guide already (made before the rule); renaming another chapter still works.
    const start = manifest([{ slug: "gases", title: "Gases" }, { slug: "empty", title: "Empty" }]);
    const r = applyCourseOp(start, new Set(parts("gases")), { op: "renameChapter", slug: "gases", title: "Gas Laws" }, uid);
    expect(r.ok).toBe(true);
  });
  it("[K1.15] operations from a client are shape-checked; unknown operations and bad slugs are refused", () => {
    expect(parseCourseOp({ op: "renameChapter", slug: "gases", title: " A \n B " })).toEqual({ op: "renameChapter", slug: "gases", title: "A B" });
    expect(parseCourseOp({ op: "deleteCourse" })).toBeNull();
    expect(parseCourseOp({ op: "setLicense", license: "CC0-1.0" })).toEqual({ op: "setLicense", license: "CC0-1.0" });
    expect(parseCourseOp({ op: "setLicense", license: "MIT" })).toBeNull(); // not in the profile's list
    expect(parseCourseOp({ op: "restoreChapter", slug: "gases", fromCommit: "HEAD~1" })).toBeNull();
    expect(parseCourseOp({ op: "removeChapter", slug: "../x" })).toBeNull();
    expect(parseCourseOp({ op: "setCourseDetails" })).toBeNull();
    const d = applyCourseOp(manifest([]), new Set(), parseCourseOp({ op: "setCourseDetails", description: "An open course." })!, uid);
    expect(d.ok && JSON.parse(d.writes[0]!.content!).description).toBe("An open course.");
  });
  it("[K1.15] renaming a chapter that already lacks a required part isn't a new problem (problems compare under the new title)", () => {
    const r = applyCourseOp(manifest([{ slug: "gases", title: "Gases" }]), new Set(["study-guide/gases.md"]), { op: "renameChapter", slug: "gases", title: "The Gas Laws" }, uid);
    expect(r.ok).toBe(true);
    const add = applyCourseOp(manifest([{ slug: "gases", title: "Gases" }]), new Set(["study-guide/gases.md"]), { op: "removeChapter", slug: "gases" }, uid);
    expect(add.ok).toBe(true);
  });
});
