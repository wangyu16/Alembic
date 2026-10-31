/** Publisher v3 pure core: units (P.1, Q.8), links, and the public tree by file status (K1.23; family SITE-TYPE-CONTRACT §7). */
import { describe, expect, it } from "vitest";
import { WorkingManifestV3Schema, type StatusMap } from "@alembic/package-contract";
import { assembleByFile, chapterSlugOf, relativeLinks, unitOf, type TreeFile } from "./publisher";

const manifest = (slugs: string[]) =>
  WorkingManifestV3Schema.parse({
    schemaVersion: 3, packageId: "pkg-1", title: "Chem", license: "CC-BY-4.0", createdAt: "2026-10-27T00:00:00Z",
    privateRepo: { owner: "yu", name: "chem-private" }, publicRepo: { owner: "yu", name: "chem-oer" },
    chapters: slugs.map((s) => ({ slug: s, title: s })),
  });
const at = (unit: string, text: string): TreeFile & { unit: string } => ({ text, unit });

describe("units (P.1, Q.8)", () => {
  const ch = new Set(["atoms", "gases"]);
  it("[P.1] every projectable path belongs to exactly one unit; private and generated to none", () => {
    expect(unitOf("study-guide/atoms.md", ch, new Set())).toEqual({ kind: "chapter", slug: "atoms" });
    expect(unitOf("slides/atoms.slides.md", ch, new Set())).toEqual({ kind: "chapter", slug: "atoms" });
    expect(unitOf("study-guide/chapters/atoms/extra.md", ch, new Set())).toEqual({ kind: "chapter", slug: "atoms" });
    expect(unitOf("concepts/course.md", ch, new Set())).toEqual({ kind: "course" });
    expect(unitOf("assets/fig.svg", ch, new Set())).toEqual({ kind: "asset", path: "assets/fig.svg" });
    expect(unitOf("README.md", ch, new Set())).toEqual({ kind: "course" });
    for (const p of ["private/instructor/key.md", "private/coursewerk/LOG.jsonl", ".github/workflows/x.yml", "alembic.json"]) expect(unitOf(p, ch, new Set()).kind, p).toBe("none");
  });
  it("[Q.8] chapter files for a slug never in the manifest are orphans; odd names under a chapter folder or slot never become the course unit", () => {
    expect(unitOf("study-guide/stray.md", ch, new Set())).toEqual({ kind: "orphan", slug: "stray" });
    for (const p of ["study-guide/chapters/Gases/answers.md", "practice/chapters/gases_v2/key.md", "study-guide/gases.MD", "practice/gases_v2.md"]) expect(unitOf(p, ch, new Set()).kind, p).not.toBe("course");
    expect(chapterSlugOf("concepts/course.md")).toBeNull();
    expect(chapterSlugOf("slides/a-b.slides.md")).toBe("a-b");
  });
  it("[P.17] links resolve relative, root-absolute, encoded and bracketed paths, and ignore external ones and [Home](/)", () => {
    expect(relativeLinks("study-guide/atoms.md", "[a](gases.md) ![f](../assets/fig.svg) [x](https://e.org) [y](#top) <img src=\"../assets/p.png\"> [h](/)").sort())
      .toEqual(["assets/fig.svg", "assets/p.png", "study-guide/gases.md"]);
    expect(relativeLinks("study-guide/atoms.md", "![f](../assets/My%20Figure.png) ![g](<../assets/My Figure.png>)")).toEqual(["assets/My Figure.png"]);
  });
});

describe("the public tree by file status (K1.23)", () => {
  const working = new Map([
    ["study-guide/atoms.md", at("chapter:atoms", "# Atoms NOW\n")],
    ["study-guide/gases.md", at("chapter:gases", "# Gases NOW\n")],
    ["slides/atoms.slides.md", at("chapter:atoms", "slides NOW")],
    ["assets/fig.png", { blobSha: "b-fig-now", unit: "asset:assets/fig.png" }],
    ["assets/secret.png", { blobSha: "b-secret", unit: "asset:assets/secret.png" }],
    ["provenance/coursewerk/ATTRIBUTION.md", at("course", "credits")],
  ]);
  const published = new Map<string, TreeFile & { unit: string }>([
    ["study-guide/gases.md", at("chapter:gases", "# Gases THEN\n![o](../assets/old.png)\n")],
    ["slides/atoms.slides.md", at("chapter:atoms", "slides THEN")],
    ["assets/old.png", { blobSha: "b-old", unit: "asset:assets/old.png" }],
    ["assets/gone.png", { blobSha: "b-gone", unit: "asset:assets/gone.png" }],
  ]);
  const status: StatusMap = { "study-guide/atoms.md": "completed", "assets/secret.png": "withdrawn" };
  const run = (s: StatusMap = status) => assembleByFile({
    working, published, status: s, manifest: manifest(["atoms", "gases"]),
    publishedTexts: new Map([["study-guide/gases.md", "# Gases THEN\n![o](../assets/old.png)\n"]]),
  });
  it("[K1.23] completed pages go out as they are now; a draft never published stays off", () => {
    const t = run();
    expect(t.files.get("study-guide/atoms.md")!.text).toBe("# Atoms NOW\n");
    expect(t.files.has("slides/atoms.slides.md")).toBe(true); // a draft published before: its last version
    expect(t.files.get("slides/atoms.slides.md")!.text).toBe("slides THEN");
  });
  it("[K1.23] a page set back to draft keeps its last published version, with the deleted figures that version shows", () => {
    const t = run();
    expect(t.files.get("study-guide/gases.md")!.text).toBe("# Gases THEN\n![o](../assets/old.png)\n");
    expect(t.kept.sort()).toEqual(["slides/atoms.slides.md", "study-guide/gases.md"]);
    expect(t.files.get("assets/old.png")!.blobSha).toBe("b-old"); // deleted at W, still shown by a kept draft
    expect(t.files.has("assets/gone.png")).toBe(false); // deleted at W and shown by nothing kept
  });
  it("[K1.23] other public files go out as they are now unless withdrawn; withdrawing takes any file off", () => {
    const t = run();
    expect(t.files.get("assets/fig.png")!.blobSha).toBe("b-fig-now");
    expect(t.files.has("assets/secret.png")).toBe(false);
    const off = run({ ...status, "study-guide/atoms.md": "withdrawn", "slides/atoms.slides.md": "withdrawn" });
    expect(off.files.has("study-guide/atoms.md")).toBe(false);
    expect(off.files.has("slides/atoms.slides.md")).toBe(false); // even its last published version
  });
  it("[K1.23] the type package's public records are published as they are, with no status", () => {
    expect(run().files.get("provenance/coursewerk/ATTRIBUTION.md")!.text).toBe("credits");
  });
  it("[K1.23] the public manifest lists the chapters with a page on the website, and never statuses", () => {
    const t = run();
    expect([...t.publishedChapters].sort()).toEqual(["atoms", "gases"]);
    const pub = JSON.parse(t.files.get("alembic.json")!.text!);
    expect(pub.chapters.map((c: { slug: string }) => c.slug)).toEqual(["atoms", "gases"]);
    expect(pub.status).toBeUndefined();
    expect(pub.privateRepo).toBeUndefined();
  });
  it("[P.2] a private file that reached assembly is refused outright (fail closed), never published", () => {
    expect(() => assembleByFile({ working: new Map([...working, ["private/instructor/key.md", at("none", "ANSWERS")]]), published: new Map(), status, manifest: manifest(["atoms"]) })).toThrow();
  });
});
