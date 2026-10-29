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
  it("[K1.15] pushed course settings that are invalid, change Alembic's own fields, or list a chapter with no study guide are undone; a title change is taken", () => {
    expect(run([{ path: "alembic.json", status: "modified" }], "{not json").undo[0]!.why).toMatch(/aren't valid/);
    expect(run([{ path: "alembic.json", status: "modified" }], M({ publicRepo: { owner: "evil", name: "x" } })).undo[0]!.why).toMatch(/Alembic's own settings/);
    expect(run([{ path: "alembic.json", status: "modified" }], M({ chapters: [{ slug: "gases", title: "Gases", mode: "package" }, { slug: "atoms", title: "Atoms", mode: "package" }] })).undo[0]!.why).toMatch(/no study guide/);
    expect(run([{ path: "alembic.json", status: "modified" }], M({ title: "General Chemistry" })).undo).toEqual([]);
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
  });
});
