import { describe, expect, it } from "vitest";
import {
  assertPathAllowedInRepo,
  layerForPath,
  PathLayerError,
  RepoBoundaryViolation,
} from "./layers";

describe("layerForPath", () => {
  it("maps layer directories to layers", () => {
    expect(layerForPath("study-guide/ch01.md")).toBe("study-guide");
    expect(layerForPath("private-instructor/answer-keys/quiz1.md")).toBe(
      "private-instructor",
    );
    expect(layerForPath("materials/worksheets/ws1.md")).toBe("materials");
  });

  it("allows manifest and root metadata files", () => {
    expect(layerForPath("alembic.json")).toBeNull();
    expect(layerForPath("README.md")).toBeNull();
    expect(layerForPath(".alembic/build.json")).toBeNull();
  });

  it("fails closed on unknown locations", () => {
    expect(() => layerForPath("random-dir/file.md")).toThrow(PathLayerError);
    expect(() => layerForPath("secrets.txt")).toThrow(PathLayerError);
  });

  it("rejects path traversal", () => {
    expect(() => layerForPath("study-guide/../private-instructor/keys.md")).toThrow(
      PathLayerError,
    );
  });
});

describe("assertPathAllowedInRepo — the two-repo invariant", () => {
  it("allows public layers in the public repo", () => {
    expect(() =>
      assertPathAllowedInRepo("study-guide/ch01.md", "public"),
    ).not.toThrow();
  });

  it("allows private-instructor content in the private repo", () => {
    expect(() =>
      assertPathAllowedInRepo("private-instructor/notes.md", "private"),
    ).not.toThrow();
  });

  // Adversarial cases: every shape a private path could take toward the public repo.
  const privateLeakAttempts = [
    "private-instructor/answer-keys/exam1.md",
    "private-instructor/x.md",
    "/private-instructor/x.md",
    "private-instructor\\windows\\style.md",
    "private-instructor/deeply/nested/embargoed/final.md",
  ];

  for (const path of privateLeakAttempts) {
    it(`blocks private path "${path}" from the public repo`, () => {
      expect(() => assertPathAllowedInRepo(path, "public")).toThrow(
        RepoBoundaryViolation,
      );
    });
  }

  it("blocks traversal-disguised private paths entirely", () => {
    expect(() =>
      assertPathAllowedInRepo("materials/../private-instructor/keys.md", "public"),
    ).toThrow(PathLayerError);
  });

  it("blocks public layers from the private repo (separation is two-way)", () => {
    expect(() =>
      assertPathAllowedInRepo("study-guide/ch01.md", "private"),
    ).toThrow(RepoBoundaryViolation);
  });
});
