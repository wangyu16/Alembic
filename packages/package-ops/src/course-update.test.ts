import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { planCourseUpdate } from "./course-update";

const enc = (t: string) => new TextEncoder().encode(t);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PNG2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 14]);
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
const sums = (m: Map<string, Uint8Array>) => [...m].map(([p, b]) => `${sha(b)}  ./${p}`).join("\n");
const imported = () => new Map<string, Uint8Array>([
  ["alembic.json", enc(JSON.stringify({ title: "Chem", chapters: [{ slug: "gases", title: "Gases" }] }))],
  ["study-guide/gases.md", enc("# Gases\nKa = 2.9e-3\n")], ["practice/gases.md", enc("# Practice\n")], ["assets/gases/fig.png", PNG],
  ["assets/gases/old.png", PNG], ["private/coursewerk/LOG.jsonl", enc("{\"a\":1}\n")], ["README.md", enc("# Chem\n")],
]);

describe("updating a course from a type package's new delivery (owner 2026-11-02)", () => {
  it("[K1.49] changed files carry the imported version as their base (so later course edits combine); new files are added; files no longer delivered are deleted, records never", () => {
    const delivery = imported();
    delivery.set("study-guide/gases.md", enc("# Gases\n$K_a = 2.9\\times10^{-3}$\n"));
    delivery.set("assets/gases/fig.png", PNG2);
    delivery.set("assessment-support/gases.md", enc("# Guide\n"));
    delivery.delete("assets/gases/old.png");
    delivery.delete("private/coursewerk/LOG.jsonl");
    const r = planCourseUpdate({ delivery, sums: sums(delivery), imported: imported(), packageId: "pkg-chem-abc123" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const by = Object.fromEntries(r.changes.map((c) => [c.path, c]));
    expect(by["study-guide/gases.md"]).toMatchObject({ kind: "change", baseVersion: sha("# Gases\nKa = 2.9e-3\n") });
    expect(by["assets/gases/fig.png"]).toMatchObject({ kind: "change" });
    expect(by["assets/gases/fig.png"]!.baseBlob).toMatch(/^[0-9a-f]{40}$/);
    expect(by["assessment-support/gases.md"]).toMatchObject({ kind: "add", baseVersion: null });
    expect(by["assets/gases/old.png"]).toMatchObject({ kind: "delete", text: null });
    expect(by["private/coursewerk/LOG.jsonl"]).toBeUndefined();
    expect(r.keptRecords).toEqual(["private/coursewerk/LOG.jsonl"]);
    expect(by["practice/gases.md"]).toBeUndefined(); // unchanged
    expect(r.changes.some((c) => c.path === "alembic.json")).toBe(false); // the course's settings are never taken from a delivery
  });

  it("[K1.49] refused: a checksum mismatch, or different chapters (a course operation, not a file update)", () => {
    const delivery = imported();
    const s = sums(delivery);
    delivery.set("study-guide/gases.md", enc("# tampered\n"));
    expect(planCourseUpdate({ delivery, sums: s, imported: imported(), packageId: "pkg-chem-abc123" }).ok).toBe(false);
    const more = imported();
    more.set("alembic.json", enc(JSON.stringify({ title: "Chem", chapters: [{ slug: "gases", title: "Gases" }, { slug: "atoms", title: "Atoms" }] })));
    more.set("study-guide/atoms.md", enc("# Atoms\n"));
    expect(planCourseUpdate({ delivery: more, sums: sums(more), imported: imported(), packageId: "pkg-chem-abc123" })).toMatchObject({ ok: false });
  });
});
