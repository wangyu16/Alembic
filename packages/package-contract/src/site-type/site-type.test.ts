import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { coursewerkOerProfile as oracle } from "../profile/coursewerk-oer";
import { activeProfile } from "../profile";
import { spaceForPathV3 } from "../contract-v3";
import { docKey, parseSiteType, profileFromDefinition, siteType, SITE_TYPES } from ".";

const course = siteType("oer-course@1");

describe("the vendored site types", () => {
  it("[K1.21] load, pass the schema and the cross-field rules, and carry every file they name", () => {
    expect([...SITE_TYPES.keys()]).toEqual(["oer-course@1"]);
    expect(course.definition.schema).toBe("alembic.site-type/1");
    // Coursewerk's tagged release, copied by scripts/type-packages.ts (family SITE-TYPE-CONTRACT §3, FD-11).
    expect(course.vendor).toMatchObject({ source: "type-package", repo: "orz-coursewerk", tag: "site-type-1.0.0-dev.1" });
  });

  it("[K1.21] the bundle and the JSON Schema are up to date with the vendored folders", () => {
    const root = join(__dirname, "../../../..");
    expect(() => execFileSync("npx", ["tsx", "scripts/type-packages.ts", "check"], { cwd: root, stdio: "pipe" })).not.toThrow();
  });
});

describe("the definition's cross-field rules (contract §5 Validation)", () => {
  const base = () => JSON.parse(JSON.stringify(course.definition));
  const problems = (mut: (d: any) => void) => { const d = base(); mut(d); const r = parseSiteType(d); return r.ok ? [] : r.problems; };
  it("refuses unit documents without a unit name", () => expect(problems((d) => { delete d.names.unit; })).toContain("unit documents need names.unit"));
  it("refuses placeholders where they don't belong", () => expect(problems((d) => { d.folders.push({ path: "notes/{unit}", who: "editor" }); }).join()).toMatch(/only documents, unit folders and figures/));
  it("refuses private entries outside private/ and public folders inside it", () => {
    expect(problems((d) => { d.private.push({ path: "secret", who: "editor" }); }).join()).toMatch(/must be under private/);
    expect(problems((d) => { d.folders.push({ path: "private/x", who: "editor" }); }).join()).toMatch(/declare it in private/);
  });
  it("[K1.21] refuses Alembic's own paths and the front page files", () => {
    expect(problems((d) => { d.rootFiles.push({ name: "alembic.json", who: "lead" }); }).join()).toMatch(/Alembic's own paths/);
    expect(problems((d) => { d.folders.push({ path: "private/sources", who: "editor" }); }).join()).toMatch(/Alembic's own paths|declare it in private/);
    expect(problems((d) => { d.rootFiles.push({ name: "index.md", who: "lead" }); }).join()).toMatch(/reserved for the front page/);
  });
  it("refuses references to undeclared things", () => {
    expect(problems((d) => { d.relations.push({ from: "nope", to: "study-guide", kind: "pairs" }); }).join()).toMatch(/unknown document "nope"/);
    expect(problems((d) => { d.website.unitLinks.push("readme"); }).join()).toMatch(/not a unit document/);
  });
  it("refuses a licence file that something else places, or a bad name", () => {
    expect(problems((d) => { d.licences.choices[0].files["README.md"] = "licences/CC-BY-4.0.txt"; }).join()).toMatch(/also placed/);
    expect(problems((d) => { d.licences.choices[0].files["LICENSE.html"] = "licences/CC-BY-4.0.txt"; }).join()).toMatch(/accepted text ending/);
  });
  it("refuses a format whose path doesn't end right", () => expect(problems((d) => { d.documents[2].path = "slides/{unit}.md"; }).join()).toMatch(/ends with \.slides\.md/));
  it("[K1.21] allows a site type without units (a one-page site)", () => {
    const r = parseSiteType({ schema: "alembic.site-type/1", type: "one-page", version: "1.0.0", names: { site: "site" }, groups: [{ id: "site", label: "Site" }],
      documents: [{ id: "home", scope: "site", label: "Home", path: "home.md", format: "md", required: true, group: "site" }],
      website: { front: [{ show: "title" }, { show: "doc", doc: "home" }] } });
    expect(r.ok).toBe(true);
  });
});

describe("the bridge reproduces today's Coursewerk profile (only the intended changes)", () => {
  const paths = [
    "alembic.json", "README.md", "LICENSE", "CITATION.cff", ".gitignore", "orz-site.json",
    "concepts/gases.md", "concepts/course.md", "assessment-support/gases.md", "study-guide/gases.md", "slides/gases.slides.md", "practice/gases.md",
    "study-guide/chapters/gases/extra.md", "slides/chapters/gases/deck.slides.md", "practice/other.md", "study-guide/notes.md",
    "assets/gases/fig.png", "assets/fig.svg", "current/syllabus.md", "metadata/PROVENANCE.json", "provenance/coursewerk/ATTRIBUTION.md",
    "private/instructor/key.md", "private/instructor/figures/gases/f.png", "private/coursewerk/LOG.jsonl", "private/legacy/old.md", "private/README.md",
  ];
  it("[K1.21] classifies every kind of path the same way", () => {
    for (const p of paths) {
      const space = spaceForPathV3(p);
      if (space === null) continue;
      expect([p, activeProfile.pathClass(p, space)]).toEqual([p, oracle.pathClass(p, space)]);
    }
  });
  it("keeps the folders, root files, server-only files, reserved slugs, media and licences", () => {
    expect(new Set(Object.keys(activeProfile.folders))).toEqual(new Set(Object.keys(oracle.folders)));
    // The course-website add-on's places are accepted in every course (course-website-addon §5, interim).
    expect(new Set(activeProfile.rootFiles)).toEqual(new Set([...oracle.rootFiles, "home.md"]));
    expect(activeProfile.serverOnlyFiles).toEqual(oracle.serverOnlyFiles);
    expect(new Set(activeProfile.privateSubfolders)).toEqual(new Set([...oracle.privateSubfolders, "exams"]));
    expect(activeProfile.reservedUnitSlugs).toEqual(oracle.reservedUnitSlugs);
    expect(activeProfile.media).toEqual(oracle.media);
    expect(activeProfile.licences).toEqual(oracle.licences);
  });
  it("[K1.21] has the same parts at the same paths; ids and one label follow the contract; every starter (Coursewerk's own) is filled and keeps its header", () => {
    const ids = { concepts: "concept-map", "study-guide": "study-guide", slides: "slides", "assessment-support": "assessment-guide", practice: "practice" } as const;
    expect(activeProfile.unitParts.map((p) => p.id)).toEqual(oracle.unitParts.map((p) => ids[p.id as keyof typeof ids]));
    for (const [i, p] of activeProfile.unitParts.entries()) {
      const o = oracle.unitParts[i]!;
      expect(p.path("gases")).toBe(o.path("gases"));
      for (const title of ["Gases", "Acids }} and {{bases}}", "Two\nlines", ""]) {
        const text = p.starter(title, "u-123");
        expect(text, `${p.id}: ${title}`).not.toMatch(/\{\{(title|uid)\}\}/);
        expect(text, p.id).toMatch(/^\{\{nyml\n[\s\S]*?uid: u-123\n[\s\S]*?\}\}/);
        expect(text.split("\n").filter((l) => l === "}}").length, `${p.id}: the header stays closed once`).toBeGreaterThanOrEqual(1);
      }
    }
    expect(activeProfile.unitParts.map((p) => p.label)).toEqual(["Concept map", "Study guide", "Slides", "Assessment guide", "Practice questions"]);
  });
  it("requires the concept map and assessment guide too (owner, 2026-10-30)", () => {
    expect(activeProfile.requiredParts).toEqual(["concept-map", "study-guide", "assessment-guide"]);
    expect(activeProfile.unitProblems([{ slug: "gases", title: "Gases" }], new Set(["study-guide/gases.md"]))).toEqual(["Chapter “Gases” has no concept map.", "Chapter “Gases” has no assessment guide."]);
  });
  it("puts a declared document's figures where it did, and other pages' by their whole path", () => {
    for (const p of ["study-guide/gases.md", "slides/gases.slides.md"]) expect(activeProfile.figureFolder(p)).toBe(oracle.figureFolder(p));
    expect(activeProfile.figureFolder("private/instructor/key.md")).toBe("private/instructor/figures/private--instructor--key");
    expect(activeProfile.figureFolder("study-guide/chapters/gases/extra.md")).toBe("assets/study-guide--chapters--gases--extra");
    expect(docKey(course.definition, "current/syllabus.md")).toBe("current--syllabus");
  });
  it("a starter's title can't break the document header", () => {
    const sg = profileFromDefinition(course.definition, course.files).unitParts.find((p) => p.id === "study-guide")!;
    expect(sg.starter("x }}\nkind: evil", "u1")).not.toMatch(/^kind: evil/m);
  });
});
