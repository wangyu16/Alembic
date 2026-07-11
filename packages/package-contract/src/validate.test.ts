import { describe, expect, it } from "vitest";
import { repoForPath, validateProject } from "./validate";
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
  { repo: "public", path: "LICENSE" },
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

describe("validateProject — contract v2 (dual-mode paths)", () => {
  const v2Manifest = {
    schemaVersion: 2,
    packageId: "pkg-genchem-v2",
    title: "Thermochemistry (v2)",
    license: "CC-BY-4.0",
    currentTerm: "2026-fall",
    createdAt: "2026-07-05T12:00:00Z",
  };

  const v2Files: ProjectFile[] = [
    { repo: "public", path: "alembic.json" },
    { repo: "public", path: "LICENSE" },
    { repo: "public", path: "assets/structures/benzene.ketcher.svg" },
    { repo: "public", path: "slides/lecture-01.slides.html" },
    { repo: "public", path: "practice/set-01.md.html" },
    { repo: "public", path: "current/quiz-01.md.html" },
    { repo: "private", path: "private/answer-key.md" },
  ];

  it("accepts a native v2-layout package (assets/, slides/, practice/, current/, private/)", () => {
    const result = validateProject({ manifest: v2Manifest, files: v2Files }, KNOWN);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("still recognizes v1 paths alongside v2 (mid-migration)", () => {
    const mixed: ProjectFile[] = [
      { repo: "public", path: "alembic.json" },
      { repo: "public", path: "LICENSE" },
      { repo: "public", path: "materials/structures/old.ketcher.svg" },
      { repo: "public", path: "assets/structures/new.ketcher.svg" },
    ];
    const result = validateProject({ manifest: v2Manifest, files: mixed }, KNOWN);
    expect(result.ok).toBe(true);
  });

  it("accepts a known carrier under assets/ as public (v2)", () => {
    const files: ProjectFile[] = [
      { repo: "public", path: "alembic.json" },
      { repo: "public", path: "LICENSE" },
      { repo: "public", path: "assets/figures/plot.plot.svg" },
    ];
    const result = validateProject({ manifest: v2Manifest, files }, KNOWN);
    expect(result.ok).toBe(true);
  });

  it("fails closed: a v2 private-space path declared in the public repo is rejected", () => {
    const files: ProjectFile[] = [
      { repo: "public", path: "private/answer-key.md" },
    ];
    const result = validateProject({ manifest: v2Manifest, files }, KNOWN);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "private/answer-key.md")).toBe(true);
  });

  it("fails closed: a v2 private-space carrier in the public repo is an error", () => {
    const files: ProjectFile[] = [
      { repo: "private", path: "private/secret.ketcher.svg" },
    ];
    const result = validateProject({ manifest: v2Manifest, files }, KNOWN);
    // Known carrier in a private location → must be public → error.
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((i) => i.path === "private/secret.ketcher.svg"),
    ).toBe(true);
  });
});

describe("validateProject — required package skeleton", () => {
  it("requires alembic.json and LICENSE to be present as files", () => {
    // A manifest that parses, but a tree missing the skeleton files.
    const result = validateProject(
      { manifest: goodManifest, files: [
        { repo: "public", path: "study-guide/01-energy.md" },
        { repo: "public", path: "study-guide/02-enthalpy.md" },
      ] },
      KNOWN,
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === "alembic.json")).toBe(true);
    expect(result.issues.some((i) => i.path === "LICENSE")).toBe(true);
  });
});

describe("repoForPath — the two-repo split as a total, fail-closed derivation", () => {
  it("classifies public directories (v1 + v2) as public", () => {
    for (const p of [
      "study-guide/01.md",
      "materials/figures/x.png",
      "assets/figures/x.png",
      "slides/deck.slides.html",
      "current/2026-fall/announcements/a.md",
    ]) {
      expect(repoForPath(p)).toBe("public");
    }
  });

  it("classifies private directories (v1 private-instructor + v2 private) as private", () => {
    expect(repoForPath("private-instructor/keys.md")).toBe("private");
    expect(repoForPath("private/keys.md")).toBe("private");
  });

  it("treats root-allowlisted files as public", () => {
    expect(repoForPath("alembic.json")).toBe("public");
    expect(repoForPath("LICENSE")).toBe("public");
    expect(repoForPath("README.md")).toBe("public");
  });

  it("throws (fail-closed) for a path in no known directory", () => {
    expect(() => repoForPath("random-top-dir/x.md")).toThrow();
    expect(() => repoForPath("../escape")).toThrow();
  });
});
