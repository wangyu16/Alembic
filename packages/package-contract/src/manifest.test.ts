import { describe, expect, it } from "vitest";
import {
  PACKAGE_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  isV2Manifest,
  parseManifest,
} from "./manifest";

const valid = {
  schemaVersion: PACKAGE_SCHEMA_VERSION,
  packageId: "pkg-gen-chem-01",
  title: "General Chemistry: Bonding",
  license: "CC-BY-4.0",
  publicRepo: { owner: "educator", name: "gen-chem-bonding-oer" },
  privateRepo: { owner: "educator", name: "gen-chem-bonding-private" },
  createdAt: "2026-06-11T12:00:00Z",
};

describe("parseManifest", () => {
  it("parses a valid manifest and applies defaults", () => {
    const manifest = parseManifest(valid);
    expect(manifest.discipline).toBe("chemistry");
    expect(manifest.privateRepo?.name).toBe("gen-chem-bonding-private");
  });

  it("allows sandbox packages without a private repo", () => {
    const { privateRepo: _omitted, ...sandbox } = valid;
    expect(parseManifest(sandbox).privateRepo).toBeUndefined();
  });

  it("allows sandbox packages with no repos at all", () => {
    const { privateRepo: _p, publicRepo: _q, ...sandbox } = valid;
    const manifest = parseManifest(sandbox);
    expect(manifest.publicRepo).toBeUndefined();
    expect(manifest.privateRepo).toBeUndefined();
  });

  it("rejects unknown licenses", () => {
    expect(() => parseManifest({ ...valid, license: "all-rights-reserved" })).toThrow();
  });

  it("omits chapters by default (single implicit chapter)", () => {
    expect(parseManifest(valid).chapters).toBeUndefined();
  });

  it("parses an ordered chapters index", () => {
    const m = parseManifest({
      ...valid,
      chapters: [
        { slug: "01-stoichiometry", title: "Stoichiometry" },
        { slug: "02-thermochemistry", title: "Thermochemistry" },
      ],
    });
    expect(m.chapters?.map((c) => c.slug)).toEqual([
      "01-stoichiometry",
      "02-thermochemistry",
    ]);
  });

  it("rejects a non-filename-safe chapter slug", () => {
    expect(() =>
      parseManifest({ ...valid, chapters: [{ slug: "Ch 1!", title: "x" }] }),
    ).toThrow();
  });

  it("rejects a manifest missing the schema version", () => {
    const { schemaVersion: _omitted, ...rest } = valid;
    expect(() => parseManifest(rest)).toThrow();
  });

  it("parses a v1 manifest without currentTerm unchanged (additive)", () => {
    expect(parseManifest(valid).currentTerm).toBeUndefined();
  });

  it("parses currentTerm when present", () => {
    expect(parseManifest({ ...valid, currentTerm: "2026-fall" }).currentTerm).toBe(
      "2026-fall",
    );
  });

  it("parses the course theme (dark/light) and defaults to absent", () => {
    expect(parseManifest(valid).theme).toBeUndefined();
    expect(parseManifest({ ...valid, theme: "light" }).theme).toBe("light");
    expect(parseManifest({ ...valid, theme: "dark" }).theme).toBe("dark");
    expect(() => parseManifest({ ...valid, theme: "neon" })).toThrow();
  });
});

describe("schema version awareness (contract v2)", () => {
  it("keeps the creation default at 1 (new packages stay v1)", () => {
    expect(PACKAGE_SCHEMA_VERSION).toBe(1);
    expect(SUPPORTED_SCHEMA_VERSIONS).toEqual([1, 2]);
  });

  it("parses a v1 manifest unchanged", () => {
    const m = parseManifest(valid);
    expect(m.schemaVersion).toBe(1);
    expect(isV2Manifest(m)).toBe(false);
  });

  it("parses a v2 manifest (schemaVersion:2, currentTerm set)", () => {
    const m = parseManifest({
      ...valid,
      schemaVersion: 2,
      currentTerm: "2026-fall",
    });
    expect(m.schemaVersion).toBe(2);
    expect(m.currentTerm).toBe("2026-fall");
    expect(isV2Manifest(m)).toBe(true);
  });

  it("rejects an unsupported schema version (3)", () => {
    expect(() => parseManifest({ ...valid, schemaVersion: 3 })).toThrow();
  });
});
