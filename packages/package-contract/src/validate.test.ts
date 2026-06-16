import { describe, expect, it } from "vitest";
import { validateProject } from "./validate";
import type { ProjectFile, ValidateOptions } from "./validate";

const KNOWN: ValidateOptions = {
  knownCarrierExtensions: [
    ".ketcher.svg",
    ".plot.svg",
    ".md.html",
    ".slides.html",
  ],
};

const goodManifest = {
  schemaVersion: 1,
  packageId: "pkg-genchem-thermo",
  title: "Thermochemistry",
  license: "CC-BY-4.0",
  chapters: [
    { slug: "01-energy", title: "Energy and heat" },
    { slug: "02-enthalpy", title: "Enthalpy" },
  ],
  createdAt: "2026-06-16T12:00:00Z",
};

const goodFiles: ProjectFile[] = [
  { repo: "public", path: "alembic.json" },
  { repo: "public", path: "study-guide/01-energy.md" },
  { repo: "public", path: "study-guide/02-enthalpy.md" },
  { repo: "public", path: "materials/structures/benzene.ketcher.svg" },
];

describe("validateProject — happy path", () => {
  it("accepts a valid project with no issues", () => {
    const result = validateProject(
      { manifest: goodManifest, files: goodFiles },
      KNOWN,
    );
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});

describe("validateProject — manifest", () => {
  it("reports an invalid manifest", () => {
    const result = validateProject(
      { manifest: { schemaVersion: 1 }, files: [] },
      KNOWN,
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "alembic.json")).toBe(true);
  });
});

describe("validateProject — chapters", () => {
  it("flags a chapter whose study-guide page is missing", () => {
    const files = goodFiles.filter(
      (f) => f.path !== "study-guide/02-enthalpy.md",
    );
    const result = validateProject({ manifest: goodManifest, files }, KNOWN);
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((i) => i.path === "study-guide/02-enthalpy.md"),
    ).toBe(true);
  });
});

describe("validateProject — repo boundary", () => {
  it("flags a file disallowed in its declared repo", () => {
    // private-instructor content declared as a public file → boundary violation.
    const files: ProjectFile[] = [
      ...goodFiles,
      { repo: "public", path: "private-instructor/notes.md" },
    ];
    const result = validateProject({ manifest: goodManifest, files }, KNOWN);
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((i) => i.path === "private-instructor/notes.md"),
    ).toBe(true);
  });
});

describe("validateProject — carriers", () => {
  it("flags a known carrier under a private layer", () => {
    const files: ProjectFile[] = [
      ...goodFiles,
      { repo: "private", path: "private-instructor/secret.ketcher.svg" },
    ];
    const result = validateProject({ manifest: goodManifest, files }, KNOWN);
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((i) =>
        i.path === "private-instructor/secret.ketcher.svg",
      ),
    ).toBe(true);
  });

  it("warns (but does not fail) on an unknown carrier-like file under materials/", () => {
    const files: ProjectFile[] = [
      ...goodFiles,
      { repo: "public", path: "materials/figures/diagram.geogebra.svg" },
    ];
    const result = validateProject({ manifest: goodManifest, files }, KNOWN);
    // Unknown carrier-like file is a warning only.
    expect(result.ok).toBe(true);
    const warn = result.issues.find(
      (i) => i.path === "materials/figures/diagram.geogebra.svg",
    );
    expect(warn).toBeDefined();
    expect(warn?.message).toMatch(/Heads up:/);
  });

  it("does not warn on a plain image that is not carrier-like", () => {
    const files: ProjectFile[] = [
      ...goodFiles,
      { repo: "public", path: "materials/figures/photo.png" },
    ];
    const result = validateProject({ manifest: goodManifest, files }, KNOWN);
    expect(result.ok).toBe(true);
    expect(
      result.issues.some((i) => i.path === "materials/figures/photo.png"),
    ).toBe(false);
  });
});
