/** Publisher v3 pure core: claims P.1, P.2, P.3, P.6, P.7, P.17, P.18, Q.8. */
import { describe, expect, it } from "vitest";
import { WorkingManifestV3Schema } from "@alembic/package-contract";
import { assemblePublicTree, chapterSlugOf, decideUnits, publishWithLinkCheck, relativeLinks, unitKey, unitOf, type TreeFile } from "./publisher";

const manifest = (slugs: string[]) =>
  WorkingManifestV3Schema.parse({
    schemaVersion: 3, packageId: "pkg-1", title: "Chem", license: "CC-BY-4.0", createdAt: "2026-10-27T00:00:00Z",
    privateRepo: { owner: "yu", name: "chem-private" }, publicRepo: { owner: "yu", name: "chem-oer" },
    chapters: slugs.map((s) => ({ slug: s, title: s })),
  });
const t = (text: string): TreeFile => ({ text });

const W = new Map<string, TreeFile>([
  ["study-guide/atoms.md", t("# Atoms\nSee [gases](gases.md) and ![fig](../assets/fig.svg)\n")],
  ["study-guide/gases.md", t("# Gases\n")],
  ["slides/atoms.slides.md", t("slides")],
  ["concepts/atoms.md", t("plan")],
  ["concepts/course.md", t("course map")],
  ["assets/fig.svg", t("<svg/>")],
  ["study-guide/chapters/atoms/extra.md", t("extra")],
  ["study-guide/stray.md", t("orphan")],
  ["private/instructor/key.md", t("ANSWERS")],
  ["private/coursewerk/LOG.jsonl", t("{}")],
  [".github/workflows/x.yml", t("on: push")],
  ["alembic.json", t("{\"working\": true}")],
  ["README.md", t("readme")],
]);

describe("units (P.1, Q.8)", () => {
  const ch = new Set(["atoms", "gases"]);
  it("every projectable path belongs to exactly one unit; private and generated to none", () => {
    expect(unitOf("study-guide/atoms.md", ch, new Set())).toEqual({ kind: "chapter", slug: "atoms" });
    expect(unitOf("slides/atoms.slides.md", ch, new Set())).toEqual({ kind: "chapter", slug: "atoms" });
    expect(unitOf("study-guide/chapters/atoms/extra.md", ch, new Set())).toEqual({ kind: "chapter", slug: "atoms" });
    expect(unitOf("concepts/course.md", ch, new Set())).toEqual({ kind: "course" });
    expect(unitOf("assets/fig.svg", ch, new Set())).toEqual({ kind: "asset", path: "assets/fig.svg" });
    expect(unitOf("README.md", ch, new Set())).toEqual({ kind: "course" });
    for (const p of ["private/instructor/key.md", "private/coursewerk/LOG.jsonl", ".github/workflows/x.yml", "alembic.json"]) {
      expect(unitOf(p, ch, new Set()).kind, p).toBe("none");
    }
  });
  it("chapter files for a slug never in the manifest are orphans (never published)", () => {
    expect(unitOf("study-guide/stray.md", ch, new Set())).toEqual({ kind: "orphan", slug: "stray" });
    expect(unitOf("study-guide/stray.md", ch, new Set(["stray"]))).toEqual({ kind: "chapter", slug: "stray" });
  });
  it("slug parsing", () => {
    expect(chapterSlugOf("concepts/course.md")).toBeNull();
    expect(chapterSlugOf("slides/a-b.slides.md")).toBe("a-b");
    expect(chapterSlugOf("practice/chapters/x/q.md")).toBe("x");
  });
});

describe("decisions (P.7)", () => {
  const base = { units: ["chapter:atoms", "chapter:gases", "course"], draft: new Set<string>(), approved: new Set(["atoms", "gases"]), publishAnyway: new Set<string>() };
  it("always-findings can't be overridden; default ones can, per chapter; draft and unapproved are kept", () => {
    const findings = [
      { unit: "chapter:atoms", check: "copying", severity: "always" as const, message: "too close to a source" },
      { unit: "chapter:gases", check: "a11y", severity: "default" as const, message: "missing alt" },
    ];
    const d1 = decideUnits({ ...base, findings, publishAnyway: new Set(["atoms", "gases"]) });
    expect(d1.get("chapter:atoms")!.result).toBe("kept");
    expect(d1.get("chapter:gases")!.result).toBe("pass");
    const d2 = decideUnits({ ...base, findings, draft: new Set(["gases"]) });
    expect(d2.get("chapter:gases")!.result).toBe("kept");
    const d3 = decideUnits({ ...base, findings: [], approved: new Set(["atoms"]) });
    expect(d3.get("chapter:gases")!.why).toContain("Course plan not approved");
  });
});

describe("assembly (P.2, P.3, P.6, P.18)", () => {
  const m = manifest(["atoms", "gases"]);
  const published = new Map<string, TreeFile & { unit: string }>([
    ["study-guide/gases.md", { text: "# Gases (old)\n", unit: "chapter:gases" }],
    ["study-guide/removed.md", { text: "old", unit: "chapter:removed" }],
  ]);
  const decisions = decideUnits({ units: ["chapter:atoms", "chapter:gases", "course", "asset:assets/fig.svg"], findings: [], draft: new Set(["gases"]), approved: new Set(["atoms", "gases"]), publishAnyway: new Set() });
  const tree = assemblePublicTree({ working: W, published, decisions, manifest: m, everPublishedChapters: new Set(["gases", "removed"]) });

  it("never contains private, harness, .github or the working manifest", () => {
    for (const p of tree.files.keys()) {
      expect(p.startsWith("private/"), p).toBe(false);
      expect(p.startsWith(".github/"), p).toBe(false);
    }
    expect(JSON.parse(tree.files.get("alembic.json")!.text!)).not.toHaveProperty("working");
    expect(tree.files.get("alembic.json")!.text).not.toContain("chem-private");
  });
  it("a kept chapter keeps its last published bytes; a never-published kept chapter is absent", () => {
    expect(tree.files.get("study-guide/gases.md")!.text).toBe("# Gases (old)\n");
  });
  it("orphans and removed chapters are not published", () => {
    expect(tree.files.has("study-guide/stray.md")).toBe(false);
    expect(tree.files.has("study-guide/removed.md")).toBe(false);
  });
  it("the public manifest lists exactly the published chapters", () => {
    const pub = JSON.parse(tree.files.get("alembic.json")!.text!);
    expect(pub.chapters.map((c: { slug: string }) => c.slug)).toEqual(["atoms", "gases"]);
    expect([...tree.publishedChapters].sort()).toEqual(["atoms", "gases"]);
  });
  it("refuses a generated file outside the generated list (fail closed)", () => {
    expect(() =>
      assemblePublicTree({ working: W, published, decisions, manifest: m, everPublishedChapters: new Set(), generated: new Map([["private/instructor/x.md", t("x")]]) }),
    ).toThrow();
  });
});

describe("link check (P.17)", () => {
  it("resolves relative links and ignores external ones", () => {
    expect(relativeLinks("study-guide/atoms.md", "[a](gases.md) ![f](../assets/fig.svg) [x](https://e.org) [y](#top) <img src=\"../assets/p.png\">").sort())
      .toEqual(["assets/fig.svg", "assets/p.png", "study-guide/gases.md"]);
  });
  it("a passing chapter linking to unpublished content is kept, transitively, until stable", () => {
    const m = manifest(["atoms", "gases", "bonds"]);
    const W2 = new Map<string, TreeFile>([
      ["study-guide/atoms.md", t("[b](bonds.md)")],
      ["study-guide/bonds.md", t("[g](gases.md)")],
      ["study-guide/gases.md", t("draft")],
    ]);
    const out = publishWithLinkCheck(
      { working: W2, published: new Map(), manifest: m, everPublishedChapters: new Set() },
      { units: ["chapter:atoms", "chapter:bonds", "chapter:gases", "course"], findings: [], draft: new Set(["gases"]), approved: new Set(["atoms", "bonds", "gases"]), publishAnyway: new Set() },
    );
    expect(out.decisions.get("chapter:gases")!.result).toBe("kept");
    expect(out.decisions.get("chapter:bonds")!.result).toBe("kept");
    expect(out.decisions.get("chapter:atoms")!.result).toBe("kept");
    expect(out.rounds).toBeGreaterThan(1);
    expect(unitKey({ kind: "course" })).toBe("course");
  });
});
