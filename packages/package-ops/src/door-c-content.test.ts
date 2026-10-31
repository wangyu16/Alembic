import { describe, expect, it } from "vitest";
import { classifyPushedContent, type PushedFile } from "./door-c";

const M = (o: Record<string, unknown> = {}) => JSON.stringify({ schemaVersion: 3, packageId: "pkg-x-abc123", title: "Chem", license: "CC-BY-4.0", createdAt: "2026-10-29T00:00:00Z", chapters: [{ slug: "gases", title: "Gases", mode: "package" }], ...o });
const enc = (t: string) => new TextEncoder().encode(t);
const paths = new Set(["alembic.json", "study-guide/gases.md"]);
const run = (files: PushedFile[], after = M(), pusherIsOwner = false, pathsAfter = paths) => classifyPushedContent({ files, manifestBefore: M(), manifestAfter: after, pathsAfter, pusherIsOwner });

describe("Door C: what a push may not change by content (contract v3 §13.6)", () => {
  it("[K1.18] a licence change pushed by anyone but the owner is undone; the owner's is kept and the licence files regenerated; edits to LICENSE are undone", () => {
    expect(run([{ path: "alembic.json", status: "modified" }], M({ license: "CC0-1.0" })).undo).toEqual([{ path: "alembic.json", why: "only the owner changes the licence" }]);
    expect(run([{ path: "alembic.json", status: "modified" }], M({ license: "CC0-1.0" }), true)).toEqual({ undo: [], regenerateLicense: "CC0-1.0" });
    expect(run([{ path: "LICENSE", status: "modified", bytes: enc("mine") }]).undo[0]!.path).toBe("LICENSE");
  });
  it("[K1.15] pushed course settings that are invalid, change Alembic's own fields, or list a chapter with no study guide are undone; the owner's title change is taken, anyone else's is undone", () => {
    expect(run([{ path: "alembic.json", status: "modified" }], "{not json").undo[0]!.why).toMatch(/aren't valid/);
    expect(run([{ path: "alembic.json", status: "modified" }], M({ publicRepo: { owner: "evil", name: "x" } })).undo[0]!.why).toMatch(/Alembic's own settings/);
    expect(run([{ path: "alembic.json", status: "modified" }], M({ chapters: [{ slug: "gases", title: "Gases", mode: "package" }, { slug: "atoms", title: "Atoms", mode: "package" }] })).undo[0]!.why).toMatch(/has no (concept map|study guide)/);
    expect(run([{ path: "alembic.json", status: "modified" }], M({ title: "General Chemistry" }), true).undo).toEqual([]);
    // Anyone else's settings change on GitHub is undone, with the way forward (SITE-TYPE-CONTRACT §6).
    expect(run([{ path: "alembic.json", status: "modified" }], M({ title: "General Chemistry" })).undo[0]!.why).toMatch(/make this change in Alembic/);
  });
  it("[K1.13] removing a listed chapter's part on GitHub is undone; removing another file is taken", () => {
    expect(run([{ path: "study-guide/gases.md", status: "removed" }]).undo[0]!.why).toMatch(/removed with the chapter/);
    expect(run([{ path: "assets/old.png", status: "removed" }]).undo).toEqual([]);
  });
  it("[K1.11] an unsafe SVG or a file whose bytes don't match its kind, pushed on GitHub, is undone", () => {
    expect(run([{ path: "assets/x.svg", status: "added", bytes: enc('<svg onload="x()"/>') }]).undo[0]!.why).toMatch(/event handler/);
    expect(run([{ path: "assets/x.png", status: "added", bytes: enc("<html>") }]).undo[0]!.why).toMatch(/isn't a PNG/);
    expect(run([{ path: "assets/mol.ketcher.svg", status: "modified", bytes: enc("<svg><script/></svg>") }]).undo[0]!.why).toMatch(/script/);
    expect(run([{ path: "assets/ok.svg", status: "added", bytes: enc('<svg viewBox="0 0 1 1"/>') }]).undo).toEqual([]);
    // Round 3 audit HIGH-1: a kind of file a course can't hold, pushed on GitHub, is undone.
    expect(run([{ path: "metadata/evidence/page.html", status: "added" }]).undo[0]!.why).toMatch(/can't hold/);
    expect(run([{ path: "assets/run.js", status: "modified" }]).undo[0]!.why).toMatch(/can't hold/);
  });
});

describe("Door C and page statuses (SITE-TYPE-CONTRACT §6, §7)", () => {
  it("[K1.25] the owner's pushed statuses are taken when each names a public page or file of the course; anyone else's are undone", () => {
    const st = (status: Record<string, string>) => M({ status });
    expect(run([{ path: "alembic.json", status: "modified" }], st({ "study-guide/gases.md": "completed" }), true).undo).toEqual([]);
    expect(run([{ path: "alembic.json", status: "modified" }], st({ "study-guide/gases.md": "completed" })).undo[0]!.why).toMatch(/make this change in Alembic/);
    for (const bad of [{ "study-guide/atoms.md": "completed" }, { "private/instructor/key.md": "withdrawn" }] as Array<Record<string, string>>) {
      expect(run([{ path: "alembic.json", status: "modified" }], st(bad), true).undo[0]!.why, JSON.stringify(bad)).toMatch(/isn't a public page or file/);
    }
  });
  it("[K1.25] a file deleted on GitHub that had a status gets it dropped (a follow-up change), so a file added later at that path starts as a draft", () => {
    const after = M({ status: { "study-guide/extra.md": "completed" } });
    const v = classifyPushedContent({ files: [{ path: "study-guide/extra.md", status: "removed" }], manifestBefore: after, manifestAfter: after, pathsAfter: paths, pusherIsOwner: false });
    expect(v.undo).toEqual([]);
    expect(v.dropStatus).toEqual(["study-guide/extra.md"]);
  });
});

describe("Door C status follow-ups (round 1 audit M1, M2)", () => {
  it("[K1.25] an old status naming a gone file never undoes the owner's later settings push; it is dropped quietly", () => {
    const before = M({ status: { "study-guide/gone.md": "completed" } });
    const after = M({ title: "New title", status: { "study-guide/gone.md": "completed" } });
    const v = classifyPushedContent({ files: [{ path: "alembic.json", status: "modified" }], manifestBefore: before, manifestAfter: after, pathsAfter: paths, pusherIsOwner: true });
    expect(v.undo).toEqual([]);
    expect(v.dropStatus).toEqual(["study-guide/gone.md"]);
  });
  it("[K1.25] any file deleted on GitHub loses its status, a figure or a term page too", () => {
    const m = M({ status: { "assets/gases/f.png": "withdrawn", "current/fall-2026/syllabus.md": "completed" } });
    const v = classifyPushedContent({ files: [{ path: "assets/gases/f.png", status: "removed" }, { path: "current/fall-2026/syllabus.md", status: "removed" }], manifestBefore: m, manifestAfter: m, pathsAfter: paths, pusherIsOwner: false });
    expect(v.dropStatus?.sort()).toEqual(["assets/gases/f.png", "current/fall-2026/syllabus.md"]);
  });
});
