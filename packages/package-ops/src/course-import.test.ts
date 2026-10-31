import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCourseImport } from "./course-import";

const enc = (t: string) => new TextEncoder().encode(t);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const base = () => new Map<string, Uint8Array>([
  ["alembic.json", enc(JSON.stringify({ title: "Chem", license: "CC-BY-4.0", chapters: [{ slug: "gases", title: "Gases" }] }))],
  ["study-guide/gases.md", enc("# Gases\n")], ["assets/gases/fig.png", PNG], ["README.md", enc("# Chem\n")],
]);
const sums = (m: Map<string, Uint8Array>) => [...m].map(([p, b]) => `${sha(b)}  ./${p}`).join("\n");

describe("importing a course package (K1.32)", () => {
  it("[K1.32] a clean package becomes one first commit; Alembic rebuilds its settings; pages start as drafts with the ready list only suggested", () => {
    const files = base();
    const r = planCourseImport({ files, sums: sums(files), packageId: "pkg-chem-abc123", ready: ["study-guide/gases.md", "nope.md"] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.files.map((f) => f.path).sort()).toEqual(["README.md", "alembic.json", "assets/gases/fig.png", "study-guide/gases.md"]);
    expect(r.plan.manifest).toMatchObject({ packageId: "pkg-chem-abc123", type: "oer-course@1", chapters: [{ slug: "gases", title: "Gases" }] });
    expect(r.plan.manifest.status).toBeUndefined();
    expect(r.plan.suggestedCompleted).toEqual(["study-guide/gases.md"]);
  });
  it("[K1.32] a checksum that doesn't match, a listed file missing, or an unlisted file refuses the whole package", () => {
    const files = base();
    const s = sums(files);
    files.set("study-guide/gases.md", enc("# Gases, changed\n"));
    expect(planCourseImport({ files, sums: s, packageId: "pkg-chem-abc123" })).toMatchObject({ ok: false });
    const extra = base(); const s2 = sums(extra); extra.set("practice/gases.md", enc("x"));
    expect(planCourseImport({ files: extra, sums: s2, packageId: "pkg-chem-abc123" })).toMatchObject({ ok: false });
  });
  it("[K1.32] Alembic's own files, unsafe files and stray chapters are left out with a reason, never imported", () => {
    const files = base();
    for (const [p, b] of [[".github/workflows/x.yml", enc("on: push")], ["private/sources/src.json", enc("{}")], ["assets/gases/evil.svg", enc('<svg onload="x()"/>')],
      ["assets/gases/fake.png", enc("not a png")], ["metadata/evidence/page.html", enc("<script>x</script>")], ["study-guide/atoms.md", enc("# Atoms")], ["../escape.md", enc("x")]] as const) files.set(p, b);
    const r = planCourseImport({ files, packageId: "pkg-chem-abc123" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = new Set(r.plan.leftOut.map((x) => x.path));
    for (const p of [".github/workflows/x.yml", "private/sources/src.json", "assets/gases/evil.svg", "assets/gases/fake.png", "metadata/evidence/page.html", "study-guide/atoms.md", "../escape.md"]) expect(out.has(p), p).toBe(true);
  });
  it("[K1.32] the real General Chemistry files plan cleanly (only old evidence pages left out)", () => {
    const root = join(__dirname, "../../../../output/genchem-for-coursewerk");
    try { statSync(root); } catch { return; } // the family copy is only on the owner's machine
    const files = new Map<string, Uint8Array>();
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.set(p.slice(root.length + 1), readFileSync(p)); } };
    walk(root);
    const r = planCourseImport({ files, packageId: "pkg-gc-abc123", title: "General Chemistry" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const reasons = new Set(r.plan.leftOut.filter((x) => !/^metadata\/evidence\/.*\.html$/.test(x.path) && x.path !== ".gitignore").map((x) => `${x.path}: ${x.why}`));
    expect([...reasons]).toEqual([]);
    // No chapter list in this copy: the 19 chapters come from the study guides' own headers, in their order.
    expect(r.plan.manifest.chapters.length).toBe(19);
    expect(r.plan.manifest.chapters[5]!.title).toBe("Thermochemistry");
    expect(r.plan.files.length).toBeGreaterThan(250);
  });
});
