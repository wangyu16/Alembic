import { describe, expect, it } from "vitest";
import { PathLayerError } from "./layers";
import {
  assertPathAllowedInRepoV2,
  PACKAGE_SPACES,
  SPACE_DIR,
  SPACE_REPO,
  SpaceBoundaryViolation,
  spaceForPath,
  spaceForV1Layer,
} from "./spaces";

describe("PACKAGE_SPACES", () => {
  it("has the ten v2 spaces, private last", () => {
    expect(PACKAGE_SPACES).toEqual([
      "study-guide",
      "slides",
      "practice",
      "concepts",
      "assessment-support",
      "assets",
      "current",
      "metadata",
      "provenance",
      "private",
    ]);
  });

  it("every space has a dir and a repo; only private is private", () => {
    for (const space of PACKAGE_SPACES) {
      expect(SPACE_DIR[space]).toBeTruthy();
      expect(SPACE_REPO[space]).toBe(space === "private" ? "private" : "public");
    }
  });
});

describe("spaceForPath", () => {
  it("maps space directories to spaces", () => {
    expect(spaceForPath("study-guide/acids.md.html")).toBe("study-guide");
    expect(spaceForPath("slides/acids.slides.html")).toBe("slides");
    expect(spaceForPath("practice/acids.md.html")).toBe("practice");
    expect(spaceForPath("assets/figures/titration.png")).toBe("assets");
    expect(spaceForPath("private/exams/final.md")).toBe("private");
  });

  it("resolves any depth under a space dir to that space", () => {
    expect(spaceForPath("current/2026-spring/assignments/quiz1.pdf")).toBe("current");
    expect(spaceForPath("assets/deeply/nested/dirs/mol.ketcher.svg")).toBe("assets");
  });

  it("maps the manifest and root housekeeping files to metadata", () => {
    expect(spaceForPath("alembic.json")).toBe("metadata");
    expect(spaceForPath("README.md")).toBe("metadata");
    expect(spaceForPath(".alembic/build.json")).toBe("metadata");
  });

  it("fails closed on unknown locations", () => {
    expect(() => spaceForPath("random-dir/file.md")).toThrow(PathLayerError);
    expect(() => spaceForPath("secrets.txt")).toThrow(PathLayerError);
  });

  it("does NOT resolve v1-only directory names", () => {
    expect(() => spaceForPath("materials/ws1.md")).toThrow(PathLayerError);
    expect(() => spaceForPath("private-instructor/keys.md")).toThrow(PathLayerError);
    expect(() => spaceForPath("objectives/ch01.md")).toThrow(PathLayerError);
  });

  it("rejects path traversal and empty paths", () => {
    expect(() => spaceForPath("assets/../private/keys.md")).toThrow(PathLayerError);
    expect(() => spaceForPath("")).toThrow(PathLayerError);
  });
});

describe("assertPathAllowedInRepoV2 — the two-repo invariant", () => {
  it("allows public spaces in the public repo", () => {
    expect(() =>
      assertPathAllowedInRepoV2("study-guide/acids.md.html", "public"),
    ).not.toThrow();
    expect(() =>
      assertPathAllowedInRepoV2("current/2026-spring/assignments/quiz.pdf", "public"),
    ).not.toThrow();
  });

  it("allows private content in the private repo", () => {
    expect(() =>
      assertPathAllowedInRepoV2("private/notes.md", "private"),
    ).not.toThrow();
  });

  it("allows housekeeping root files in either repo", () => {
    expect(() => assertPathAllowedInRepoV2("README.md", "private")).not.toThrow();
    expect(() => assertPathAllowedInRepoV2("alembic.json", "public")).not.toThrow();
  });

  // Adversarial cases: every shape a private path could take toward the public repo.
  const privateLeakAttempts = [
    "private/answer-keys/exam1.md",
    "private/x.md",
    "/private/x.md",
    "private\\windows\\style.md",
    "private/deeply/nested/embargoed/final.md",
  ];

  for (const path of privateLeakAttempts) {
    it(`blocks private path "${path}" from the public repo`, () => {
      expect(() => assertPathAllowedInRepoV2(path, "public")).toThrow(
        SpaceBoundaryViolation,
      );
    });
  }

  it("blocks traversal-disguised private paths entirely", () => {
    expect(() =>
      assertPathAllowedInRepoV2("assets/../private/keys.md", "public"),
    ).toThrow(PathLayerError);
  });

  it("blocks public spaces from the private repo (separation is two-way)", () => {
    expect(() =>
      assertPathAllowedInRepoV2("study-guide/acids.md.html", "private"),
    ).toThrow(SpaceBoundaryViolation);
  });

  it("fails closed on unclassifiable paths in either repo", () => {
    expect(() => assertPathAllowedInRepoV2("mystery/file.md", "public")).toThrow(
      PathLayerError,
    );
    expect(() => assertPathAllowedInRepoV2("mystery/file.md", "private")).toThrow(
      PathLayerError,
    );
  });
});

describe("spaceForV1Layer", () => {
  it("maps the renamed v1 layers", () => {
    expect(spaceForV1Layer("materials")).toBe("assets");
    expect(spaceForV1Layer("private-instructor")).toBe("private");
    expect(spaceForV1Layer("objectives")).toBe("concepts");
  });

  it("maps same-name layers to themselves", () => {
    for (const name of [
      "study-guide",
      "concepts",
      "assessment-support",
      "provenance",
      "metadata",
    ] as const) {
      expect(spaceForV1Layer(name)).toBe(name);
    }
  });

  it("returns null for research-schema (no v2 space) and unknown names", () => {
    expect(spaceForV1Layer("research-schema")).toBeNull();
    expect(spaceForV1Layer("not-a-layer")).toBeNull();
  });
});
