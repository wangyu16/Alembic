/** Claim K1.6 (manifest part) of docs/specs/v3/package-contract-v3.md. */
import { describe, expect, it } from "vitest";
import { PublicManifestV3Schema, toPublicManifest, WorkingManifestV3Schema } from "./manifest-v3";

const working = {
  schemaVersion: 3,
  packageId: "pkg-abc",
  title: "General Chemistry",
  license: "CC-BY-4.0",
  createdAt: "2026-10-27T00:00:00Z",
  publicRepo: { owner: "yu", name: "genchem-oer" },
  privateRepo: { owner: "yu", name: "genchem-private" },
  chapters: [
    { slug: "atoms", title: "Atoms" },
    { slug: "gases", title: "Gases", mode: "draft" },
    { slug: "bonds", title: "Bonds" },
  ],
};

describe("manifest v3", () => {
  it("parses a working manifest and defaults chapter mode to package", () => {
    const m = WorkingManifestV3Schema.parse(working);
    expect(m.chapters[0]!.mode).toBe("package");
    expect(m.chapters[1]!.mode).toBe("draft");
  });

  it("rejects schemaVersion 2, the reserved slug and duplicate slugs", () => {
    expect(() => WorkingManifestV3Schema.parse({ ...working, schemaVersion: 2 })).toThrow();
    expect(() => WorkingManifestV3Schema.parse({ ...working, chapters: [{ slug: "course", title: "x" }] })).toThrow(/reserved/);
    expect(() =>
      WorkingManifestV3Schema.parse({ ...working, chapters: [{ slug: "a", title: "x" }, { slug: "a", title: "y" }] }),
    ).toThrow(/Duplicate/);
  });

  it("public manifest never names a repository and rejects unknown keys", () => {
    const { publicRepo: _a, privateRepo: _b, ...noRepos } = working;
    expect(() => PublicManifestV3Schema.parse(working)).toThrow();
    expect(() => PublicManifestV3Schema.parse({ ...noRepos, privateRepo: working.privateRepo })).toThrow();
    expect(() => PublicManifestV3Schema.parse({ ...noRepos, repos: { private: "genchem-private" } })).toThrow();
    expect(PublicManifestV3Schema.parse(noRepos).title).toBe("General Chemistry");
  });

  it("toPublicManifest keeps working order and only published chapters, without repos", () => {
    const pub = toPublicManifest(WorkingManifestV3Schema.parse(working), new Set(["bonds", "atoms"]));
    expect(pub.chapters.map((c) => c.slug)).toEqual(["atoms", "bonds"]);
    expect(JSON.stringify(pub)).not.toContain("genchem-private");
    expect("privateRepo" in pub).toBe(false);
  });
});
