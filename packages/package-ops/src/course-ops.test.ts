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
    for (const w of r.writes) (("content" in w && w.content === null) ? paths.delete(w.path) : paths.add(w.path));
    text = (r.writes.find((w) => w.path === "alembic.json")! as { content: string }).content;
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
    expect(r.ok && r.writes.filter((w) => ("content" in w && w.content === null)).map((w) => w.path).sort()).toEqual(parts("gases").sort());
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
    expect(d.ok && JSON.parse((d.writes[0] as { content: string }).content).description).toBe("An open course.");
  });
  it("[K1.15] renaming a chapter that already lacks a required part isn't a new problem (problems compare under the new title)", () => {
    const r = applyCourseOp(manifest([{ slug: "gases", title: "Gases" }]), new Set(["study-guide/gases.md"]), { op: "renameChapter", slug: "gases", title: "The Gas Laws" }, uid);
    expect(r.ok).toBe(true);
    const add = applyCourseOp(manifest([{ slug: "gases", title: "Gases" }]), new Set(["study-guide/gases.md"]), { op: "removeChapter", slug: "gases" }, uid);
    expect(add.ok).toBe(true);
  });
});

describe("setStatus (SITE-TYPE-CONTRACT §7)", () => {
  const files = new Set(["alembic.json", "study-guide/gases.md", "slides/gases.slides.md", "assets/gases/f.png", "private/instructor/key.md"]);
  const m = `${JSON.stringify({ schemaVersion: 3, packageId: "pkg-a", title: "Chem", license: "CC-BY-4.0", createdAt: "2026-10-30T00:00:00Z", chapters: [] })}\n`;
  const uid = () => "doc-x";
  it("[K1.22] marks many pages completed at once, and takes any public file off the website", () => {
    const r = applyCourseOp(m, files, { op: "setStatus", paths: ["study-guide/gases.md", "slides/gases.slides.md"], status: "completed" }, uid);
    expect(r.ok && r.manifest.status).toEqual({ "study-guide/gases.md": "completed", "slides/gases.slides.md": "completed" });
    expect(r.ok && r.summary).toBe("Marked 2 files completed");
    const w = applyCourseOp(m, files, { op: "setStatus", paths: ["assets/gases/f.png"], status: "withdrawn" }, uid);
    expect(w.ok && w.manifest.status).toEqual({ "assets/gases/f.png": "withdrawn" });
  });
  it("[K1.22] refuses with a plain reason: a file that's gone, an instructor-only file, completing a non-page; in a bulk change a gone page is skipped", () => {
    const why = (paths: string[], status: "completed" | "withdrawn") => { const r = applyCourseOp(m, files, { op: "setStatus", paths, status }, uid); return r.ok ? "" : r.reason; };
    expect(why(["study-guide/atoms.md"], "completed")).toMatch(/no longer in the course/);
    // Many at once: a page deleted meanwhile is skipped, the rest change.
    const some = applyCourseOp(m, files, { op: "setStatus", paths: ["study-guide/atoms.md", "study-guide/gases.md"], status: "completed" }, uid);
    expect(some.ok && some.manifest.status).toEqual({ "study-guide/gases.md": "completed" });
    expect(why(["private/instructor/key.md"], "withdrawn")).toMatch(/instructor-only/);
    expect(why(["assets/gases/f.png"], "completed")).toMatch(/isn't a page/);
  });
  it("[K1.22] a client's status change is shape-checked: at most a thousand paths, clean paths, a known status", () => {
    expect(parseCourseOp({ op: "setStatus", paths: ["../x.md"], status: "completed" })).toBeNull();
    expect(parseCourseOp({ op: "setStatus", paths: ["a.md"], status: "published" })).toBeNull();
    expect(parseCourseOp({ op: "setStatus", paths: Array.from({ length: 1001 }, (_, i) => `p${i}.md`), status: "draft" })).toBeNull();
    expect(parseCourseOp({ op: "setStatus", paths: ["a.md", "a.md"], status: "draft" })).toEqual({ op: "setStatus", paths: ["a.md"], status: "draft" });
  });
});

describe("course options", () => {
  it("[K1.26] the owner or deputy turns 'an edit returns a completed page to draft' on or off; it never goes public", () => {
    const m = `${JSON.stringify({ schemaVersion: 3, packageId: "pkg-a", title: "Chem", license: "CC-BY-4.0", createdAt: "2026-10-30T00:00:00Z", chapters: [] })}\n`;
    const r = applyCourseOp(m, new Set(["alembic.json"]), { op: "setOption", option: "editReturnsToDraft", value: true }, () => "doc-x");
    expect(r.ok && r.manifest.options).toEqual({ editReturnsToDraft: true });
    expect(parseCourseOp({ op: "setOption", option: "other", value: true })).toBeNull();
  });
});


describe("the course-website add-on (course-website-addon)", () => {
  const m = `${JSON.stringify({ schemaVersion: 3, packageId: "pkg-a", title: "Chem", license: "CC-BY-4.0", createdAt: "2026-10-30T00:00:00Z", chapters: [] })}\n`;
  const uid = () => "doc-x";
  it("[K1.31] switching it on starts a home page (a draft) and a first term; nothing is overwritten", () => {
    const r = applyCourseOp(m, new Set(["alembic.json"]), { op: "setAddon", addon: "course-website", on: true }, uid);
    expect(r.ok && r.manifest.addons).toEqual(["course-website"]);
    expect(r.ok && r.manifest.terms?.length).toBe(1);
    expect(r.ok && r.manifest.currentTerm).toBe(r.ok ? r.manifest.terms![0]!.slug : "");
    expect(r.ok && r.writes.map((w) => w.path)).toEqual(["alembic.json", "home.md"]);
    const again = applyCourseOp(m, new Set(["alembic.json", "home.md"]), { op: "setAddon", addon: "course-website", on: true }, uid);
    expect(again.ok && again.writes.map((w) => w.path)).toEqual(["alembic.json"]);
  });
  it("[K1.31] a term's slug comes from its title; a new term can start from the last term's pages, never over a file; the current term must exist", () => {
    const on = JSON.stringify({ ...JSON.parse(m), addons: ["course-website"], terms: [{ slug: "fall-2026", title: "Fall 2026" }], currentTerm: "fall-2026" });
    const r = applyCourseOp(on, new Set(["alembic.json", "current/fall-2026/syllabus.md", "current/spring-2027/syllabus.md"]),
      { op: "addTerm", title: "Spring 2027", copyFrom: "fall-2026", makeCurrent: true }, uid,
      { termFiles: [{ path: "current/fall-2026/syllabus.md", content: "S" }, { path: "current/fall-2026/schedule.md", content: "T" }] });
    expect(r.ok && r.manifest.terms?.map((t) => t.slug)).toEqual(["fall-2026", "spring-2027"]);
    expect(r.ok && r.manifest.currentTerm).toBe("spring-2027");
    expect(r.ok && r.writes.map((w) => w.path)).toEqual(["alembic.json", "current/spring-2027/schedule.md"]); // the syllabus was already there
    const bad = applyCourseOp(on, new Set(["alembic.json"]), { op: "setCurrentTerm", slug: "winter-2030" }, uid);
    expect(bad.ok).toBe(false);
  });
});

describe("copying a term (round 1 audit M3)", () => {
  it("[K1.31] a copied term gets the figures too, new document ids, and keeps files taken off the website off", () => {
    const m0 = JSON.stringify({ schemaVersion: 3, packageId: "pkg-a", title: "Chem", license: "CC-BY-4.0", createdAt: "2026-10-30T00:00:00Z", chapters: [],
      addons: ["course-website"], terms: [{ slug: "fall-2026", title: "Fall 2026" }], currentTerm: "fall-2026", status: { "current/fall-2026/old.csv": "withdrawn" } });
    const r = applyCourseOp(m0, new Set(["alembic.json"]), { op: "addTerm", title: "Spring 2027", copyFrom: "fall-2026" }, () => "doc-new",
      { termFiles: [{ path: "current/fall-2026/syllabus.md", content: "{{nyml\nkind: document\nuid: doc-old\n}}\n# S\n![f](fig.png)\n" },
        { path: "current/fall-2026/fig.png", blobSha: "b".repeat(40) }, { path: "current/fall-2026/old.csv", content: "a,b\n" }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w = new Map(r.writes.map((x) => [x.path, x]));
    expect((w.get("current/spring-2027/syllabus.md") as { content: string }).content).toContain("uid: doc-new");
    expect(w.get("current/spring-2027/fig.png")).toEqual({ path: "current/spring-2027/fig.png", blobSha: "b".repeat(40) });
    expect(r.manifest.status?.["current/spring-2027/old.csv"]).toBe("withdrawn");
  });
});
