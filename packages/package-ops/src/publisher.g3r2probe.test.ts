/** G3 round-2 adversary probes (publisher pure core). Each `it` fails today. */
import { describe, expect, it } from "vitest";
import { WorkingManifestV3Schema } from "@alembic/package-contract";
import { publishWithLinkCheck, relativeLinks, unitOf, type TreeFile } from "./publisher";

const manifest = (slugs: string[]) =>
  WorkingManifestV3Schema.parse({
    schemaVersion: 3, packageId: "pkg-1", title: "Chem", license: "CC-BY-4.0", createdAt: "2026-10-27T00:00:00Z",
    privateRepo: { owner: "yu", name: "chem-private" }, chapters: slugs.map((s) => ({ slug: s, title: s, mode: "package" })),
  });

describe("G3r2: slot-level chapter files that escape chapter gating (M1 nearby)", () => {
  it("study-guide/gases.MD, study-guide/Gases.md, practice/gases_v2.md are never the course unit", () => {
    for (const p of ["study-guide/gases.MD", "study-guide/Gases.md", "practice/gases_v2.md", "study-guide/gases.markdown"]) {
      expect(unitOf(p, new Set(["gases"]), new Set()).kind, p).not.toBe("course"); // FAILS: course unit, no Draft/approval gate
    }
  });
});

describe("G3r2: link-check false positives", () => {
  it("percent-encoded and angle-bracketed paths with spaces resolve to the real file", () => {
    expect(relativeLinks("study-guide/atoms.md", "![f](../assets/My%20Figure.png)")).toEqual(["assets/My Figure.png"]); // FAILS
    expect(relativeLinks("study-guide/atoms.md", "![f](<../assets/My Figure.png>)")).toEqual(["assets/My Figure.png"]); // FAILS
  });
  it("a [Home](/) link does not keep a chapter", () => {
    const working = new Map<string, TreeFile>([["study-guide/atoms.md", { text: "[Home](/) # Atoms" }]]);
    const out = publishWithLinkCheck(
      { working, published: new Map(), manifest: manifest(["atoms"]), everPublishedChapters: new Set() },
      { units: ["chapter:atoms"], findings: [], draft: new Set(), approved: new Set(["atoms"]), publishAnyway: new Set() },
    );
    expect(out.decisions.get("chapter:atoms")!.result).toBe("pass"); // FAILS: "Links to , which is not published"
  });
  it("M4 applies to binary assets too: a passing chapter linking a PNG kept at an older blob gets a finding", () => {
    const working = new Map<string, TreeFile>([["study-guide/atoms.md", { text: "![f](../assets/fig.png)" }], ["assets/fig.png", { blobSha: "new" }]]);
    const published = new Map<string, TreeFile & { unit: string }>([["assets/fig.png", { blobSha: "old", unit: "asset:assets/fig.png" }]]);
    const out = publishWithLinkCheck(
      { working, published, manifest: manifest(["atoms"]), everPublishedChapters: new Set() },
      { units: ["chapter:atoms", "asset:assets/fig.png"], findings: [{ unit: "asset:assets/fig.png", check: "a11y", severity: "default", message: "x" }],
        draft: new Set(), approved: new Set(["atoms"]), publishAnyway: new Set() },
    );
    expect(out.tree.files.get("assets/fig.png")!.blobSha).toBe("old");
    expect(out.decisions.get("chapter:atoms")!.result).toBe("kept"); // FAILS: text undefined === undefined, not "stale"
  });
});
