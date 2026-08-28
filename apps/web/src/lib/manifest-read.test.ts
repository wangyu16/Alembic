import { describe, expect, it } from "vitest";
import type { PackageFile } from "@alembic/package-ops";
import { manifestFromFiles } from "./manifest-read";

const manifestJson = {
  schemaVersion: 2,
  packageId: "pkg-1",
  title: "Thermochemistry",
  license: "CC-BY-4.0",
  createdAt: "2026-08-28T00:00:00.000Z",
  chapters: [
    { slug: "01-getting-started", title: "Thermochemistry" },
    { slug: "enthalpy", title: "Enthalpy" },
  ],
};

function manifestRow(json: unknown = manifestJson): PackageFile {
  return {
    repo: "public",
    path: "alembic.json",
    content: JSON.stringify(json, null, 2) + "\n",
  };
}

describe("manifestFromFiles", () => {
  it("parses the public alembic.json row (chapters included)", () => {
    const files: PackageFile[] = [
      { repo: "public", path: "study-guide/index.md", content: "# Hi" },
      manifestRow(),
      { repo: "private", path: "notes.md", content: "secret" },
    ];
    const manifest = manifestFromFiles(files);
    expect(manifest.packageId).toBe("pkg-1");
    expect(manifest.chapters?.map((c) => c.slug)).toEqual([
      "01-getting-started",
      "enthalpy",
    ]);
  });

  it("throws a clear error when the manifest file is absent", () => {
    const files: PackageFile[] = [
      { repo: "public", path: "study-guide/index.md", content: "# Hi" },
    ];
    expect(() => manifestFromFiles(files)).toThrow(/alembic\.json/);
  });

  it("ignores a private-repo file that happens to be named alembic.json", () => {
    const files: PackageFile[] = [
      { repo: "private", path: "alembic.json", content: "{}" },
    ];
    expect(() => manifestFromFiles(files)).toThrow(/alembic\.json/);
  });

  it("rejects a manifest file that fails the contract schema", () => {
    expect(() => manifestFromFiles([manifestRow({ schemaVersion: 99 })])).toThrow();
  });
});
