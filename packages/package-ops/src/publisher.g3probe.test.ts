/** G3 adversary probes (publisher pure core). Each `it` fails today. */
import { describe, expect, it } from "vitest";
import { WorkingManifestV3Schema } from "@alembic/package-contract";
import { decideUnits, publishWithLinkCheck, relativeLinks, unitOf, type TreeFile } from "./publisher";

const manifest = (slugs: string[], draft: string[] = []) =>
  WorkingManifestV3Schema.parse({
    schemaVersion: 3, packageId: "pkg-1", title: "Chem", license: "CC-BY-4.0", createdAt: "2026-10-27T00:00:00Z",
    privateRepo: { owner: "yu", name: "chem-private" },
    chapters: slugs.map((s) => ({ slug: s, title: s, mode: draft.includes(s) ? "draft" : "package" })),
  });
const t = (text: string): TreeFile => ({ text });

describe("G3 probe: assets deleted at W", () => {
  it("an asset deleted at W and used by no kept chapter leaves the public repo", () => {
    // assets/stolen.png was published last run; the owner deleted it at W (e.g. a rights problem).
    const working = new Map<string, TreeFile>([["study-guide/atoms.md", t("# Atoms\n")], ["concepts/course.md", t("map")]]);
    const published = new Map<string, TreeFile & { unit: string }>([
      ["study-guide/atoms.md", { text: "# Atoms\n![x](../assets/stolen.png)\n", unit: "chapter:atoms" }],
      ["assets/stolen.png", { blobSha: "b-stolen", unit: "asset:assets/stolen.png" }],
    ]);
    const d = decideUnits({ units: ["chapter:atoms", "course"], findings: [], draft: new Set(), approved: new Set(["atoms"]), publishAnyway: new Set() });
    const out = publishWithLinkCheck(
      { working, published, manifest: manifest(["atoms"]), everPublishedChapters: new Set(["atoms"]) },
      { units: ["chapter:atoms", "course"], findings: [], draft: new Set(), approved: new Set(["atoms"]), publishAnyway: new Set() },
    );
    expect(d.get("chapter:atoms")!.result).toBe("pass");
    expect(out.tree.files.has("assets/stolen.png")).toBe(false); // FAILS: kept forever
  });
});

describe("G3 probe: chapter-scoped dirs with a non-slug name (Q.8)", () => {
  it("files under <space>/chapters/<name>/ are never a course unit", () => {
    const ch = new Set(["gases"]);
    for (const p of ["study-guide/chapters/Gases/answers.md", "practice/chapters/gases_v2/key.md", "slides/chapters/gases./x.md"]) {
      expect(unitOf(p, ch, new Set()).kind, p).not.toBe("course"); // FAILS: published with the course unit, no chapter gating
    }
  });
});

describe("G3 probe: link check vs assets kept at an older version (§3 step 9)", () => {
  it("a passing chapter referencing an asset kept at its old version gets a default finding", () => {
    const working = new Map<string, TreeFile>([
      ["study-guide/atoms.md", t("![f](../assets/fig.svg)")],
      ["assets/fig.svg", t("<svg>new, copied</svg>")],
    ]);
    const published = new Map<string, TreeFile & { unit: string }>([["assets/fig.svg", { text: "<svg>old</svg>", unit: "asset:assets/fig.svg" }]]);
    const out = publishWithLinkCheck(
      { working, published, manifest: manifest(["atoms"]), everPublishedChapters: new Set() },
      {
        units: ["chapter:atoms", "asset:assets/fig.svg"],
        findings: [{ unit: "asset:assets/fig.svg", check: "copying", severity: "always", message: "copied" }],
        draft: new Set(), approved: new Set(["atoms"]), publishAnyway: new Set(),
      },
    );
    expect(out.tree.files.get("assets/fig.svg")!.text).toBe("<svg>old</svg>");
    expect(out.decisions.get("chapter:atoms")!.result).toBe("kept"); // FAILS: passes, shows the old figure
  });
});

describe("G3 probe: absolute links (link check)", () => {
  it("a root-absolute link to a Draft chapter is checked", () => {
    expect(relativeLinks("study-guide/atoms.md", "[g](/study-guide/gases.md)")).toContain("study-guide/gases.md"); // FAILS: ignored
  });
});

describe("G3 probe: removed chapter still linked from the course map (§2)", () => {
  it("a removed chapter linked from concepts/course.md at W is not deleted (or the course unit gets a finding)", () => {
    const working = new Map<string, TreeFile>([["concepts/course.md", t("[old](../study-guide/old.md)")], ["study-guide/atoms.md", t("# A")]]);
    const published = new Map<string, TreeFile & { unit: string }>([["study-guide/old.md", { text: "old", unit: "chapter:old" }]]);
    const out = publishWithLinkCheck(
      { working, published, manifest: manifest(["atoms"]), everPublishedChapters: new Set(["old"]) },
      { units: ["chapter:atoms", "course"], findings: [], draft: new Set(), approved: new Set(["atoms"]), publishAnyway: new Set() },
    );
    const dangling = out.tree.files.has("concepts/course.md") && !out.tree.files.has("study-guide/old.md");
    expect(dangling).toBe(false); // FAILS: course map published with a dead link to the removed chapter
  });
});

