/** G3 round-3 adversary probes (publisher pure core). Each `it` fails today. */
import { describe, expect, it } from "vitest";
import { WorkingManifestV3Schema } from "@alembic/package-contract";
import { gitBlobSha } from "./publish-job";
import { publishWithLinkCheck, type TreeFile } from "./publisher";

const manifest = (slugs: string[]) =>
  WorkingManifestV3Schema.parse({
    schemaVersion: 3, packageId: "pkg-1", title: "Chem", license: "CC-BY-4.0", createdAt: "2026-10-27T00:00:00Z",
    privateRepo: { owner: "yu", name: "chem-private" }, chapters: slugs.map((s) => ({ slug: s, title: s, mode: "package" })),
  });

describe("G3r3: stale-asset check on TEXT assets (r2 L4 line)", () => {
  it("a kept text asset that is unchanged since it was published is not 'published only in an older version'", async () => {
    const csv = "t,conc\n0,1.0\n";
    const working = new Map<string, TreeFile>([["study-guide/atoms.md", { text: "[data](../assets/data.csv)" }], ["assets/data.csv", { text: csv }]]);
    // Records carry only blob ids (no text), exactly as runPublish builds `published`.
    const published = new Map<string, TreeFile & { unit: string }>([["assets/data.csv", { blobSha: await gitBlobSha(csv), unit: "asset:assets/data.csv" }]]);
    const out = publishWithLinkCheck(
      { working, published, manifest: manifest(["atoms"]), everPublishedChapters: new Set() },
      { units: ["chapter:atoms", "asset:assets/data.csv"], findings: [{ unit: "asset:assets/data.csv", check: "a11y", severity: "default", message: "x" }],
        draft: new Set(), approved: new Set(["atoms"]), publishAnyway: new Set() },
    );
    expect(out.decisions.get("chapter:atoms")!.result).toBe("pass"); // FAILS: pub.text (undefined) !== atW.text → spurious "older version"
  });
});

describe("G3r3: a removed chapter kept by the course map (r2 H1)", () => {
  it("keeps the deleted asset its kept published text links to (no broken image in a file that stays public)", () => {
    const working = new Map<string, TreeFile>([
      ["study-guide/atoms.md", { text: "# Atoms" }],
      ["concepts/course.md", { text: "[Gases](../study-guide/gases.md)" }],
    ]);
    const published = new Map<string, TreeFile & { unit: string }>([
      ["study-guide/gases.md", { blobSha: "g1", unit: "chapter:gases" }],
      ["assets/gas.png", { blobSha: "png1", unit: "asset:assets/gas.png" }],
    ]);
    const keptTexts = new Map([["study-guide/gases.md", { unit: "chapter:gases", text: "# Gases ![](../assets/gas.png)" }]]);
    const out = publishWithLinkCheck(
      { working, published, manifest: manifest(["atoms"]), everPublishedChapters: new Set(["gases"]), keptTexts },
      { units: ["chapter:atoms", "course"], findings: [], draft: new Set(), approved: new Set(["atoms"]), publishAnyway: new Set() },
    );
    expect(out.tree.files.has("study-guide/gases.md")).toBe(true);
    expect(out.tree.files.has("assets/gas.png")).toBe(true); // FAILS: keptTexts filter drops removed chapters
  });
  it("is reported as a decision (kept, because the course map links it), not silently retained", () => {
    const working = new Map<string, TreeFile>([["concepts/course.md", { text: "[Gases](../study-guide/gases.md)" }]]);
    const published = new Map<string, TreeFile & { unit: string }>([["study-guide/gases.md", { blobSha: "g1", unit: "chapter:gases" }]]);
    const out = publishWithLinkCheck(
      { working, published, manifest: manifest(["atoms"]), everPublishedChapters: new Set(["gases"]) },
      { units: ["course"], findings: [], draft: new Set(), approved: new Set(), publishAnyway: new Set() },
    );
    expect(out.tree.files.has("study-guide/gases.md")).toBe(true);
    expect(out.decisions.get("chapter:gases")?.result).toBe("kept"); // FAILS: no decision for the removed-chapter unit
  });
});
