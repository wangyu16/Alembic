import { describe, expect, it } from "vitest";
import { LicenseSchema, type License } from "@alembic/package-contract";
import { createSandboxPackage } from "./create";
import { LICENSE_PATH, ensureLicenseFile, licenseFileContent } from "./license-file";
import { LICENSE_TEXTS } from "./license-texts.generated";
import { MemoryPackageStore } from "./memory-store";

const ALL: readonly License[] = LicenseSchema.options;

describe("licenseFileContent — verbatim legal code", () => {
  it("covers every license the schema allows", () => {
    // A license added to the schema without re-running scripts/fetch-licenses.mjs
    // would otherwise throw at publish time, in production.
    for (const license of ALL) {
      expect(() => licenseFileContent(license)).not.toThrow();
      expect(licenseFileContent(license).length).toBeGreaterThan(5000);
    }
  });

  it("is the real legal text, not a summary", () => {
    // Operative language quoted from the deeds. If anyone "helpfully" replaces
    // these with a human-readable summary, this fails.
    expect(licenseFileContent("CC-BY-4.0")).toContain("Attribution 4.0 International");
    expect(licenseFileContent("CC-BY-4.0")).toContain("Section 1 -- Definitions.");
    expect(licenseFileContent("CC-BY-SA-4.0")).toContain("ShareAlike");
    expect(licenseFileContent("CC-BY-NC-4.0")).toContain("NonCommercial");
    expect(licenseFileContent("CC-BY-NC-SA-4.0")).toContain("NonCommercial-ShareAlike");
    expect(licenseFileContent("CC0-1.0")).toContain("CC0 1.0 Universal");
  });

  it("carries NO copyright preamble — that would defeat GitHub's detector", () => {
    // The rights notice lives on the published page, in the JSON-LD and in
    // CITATION.cff. LICENSE is the verbatim text and nothing else.
    for (const license of ALL) {
      const text = licenseFileContent(license);
      expect(text.startsWith("Attribution") || text.startsWith("Creative Commons")).toBe(true);
      expect(text).not.toContain("© 20");
    }
  });

  it("records the canonical source and a checksum for every vendored text", () => {
    for (const license of ALL) {
      const v = LICENSE_TEXTS[license];
      expect(v.url).toMatch(/^https:\/\/creativecommons\.org\//);
      expect(v.sha256).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});

const input = {
  ownerId: "u1",
  title: "Intro Acid-Base Chemistry",
  license: "CC-BY-4.0" as const,
};

describe("LICENSE as a package file", () => {
  it("is seeded into the public repo when a package is created", async () => {
    const store = new MemoryPackageStore();
    const created = await createSandboxPackage(store, input);
    const files = await store.listFiles(created.packageId);
    const lic = files.find((f) => f.path === LICENSE_PATH);
    expect(lic?.repo).toBe("public");
    expect(lic?.content).toBe(licenseFileContent("CC-BY-4.0"));
  });

  it("never lands in the private repo", async () => {
    const store = new MemoryPackageStore();
    const created = await createSandboxPackage(store, input);
    const files = await store.listFiles(created.packageId);
    expect(files.filter((f) => f.path === LICENSE_PATH).map((f) => f.repo)).toEqual(["public"]);
  });
});

describe("ensureLicenseFile", () => {
  it("is idempotent for a freshly created package", async () => {
    const store = new MemoryPackageStore();
    const created = await createSandboxPackage(store, input);
    // create() already seeded it, so there is nothing to write.
    expect(await ensureLicenseFile(store, created.packageId, { license: "CC-BY-4.0" })).toBe(false);
  });

  it("rewrites the file when the license changes", async () => {
    const store = new MemoryPackageStore();
    const created = await createSandboxPackage(store, input);
    expect(await ensureLicenseFile(store, created.packageId, { license: "CC0-1.0" })).toBe(true);
    const files = await store.listFiles(created.packageId);
    expect(files.find((f) => f.path === LICENSE_PATH)?.content).toBe(licenseFileContent("CC0-1.0"));
  });

  it("backfills a package that predates the seed (the publish path)", async () => {
    const store = new MemoryPackageStore();
    const created = await createSandboxPackage(store, input);
    // Simulate an old package: drop the LICENSE the seed added.
    await store.deleteFiles(created.packageId, [{ repo: "public", path: LICENSE_PATH }]);
    expect((await store.listFiles(created.packageId)).some((f) => f.path === LICENSE_PATH)).toBe(false);

    expect(await ensureLicenseFile(store, created.packageId, { license: "CC-BY-4.0" })).toBe(true);
    const files = await store.listFiles(created.packageId);
    expect(files.find((f) => f.path === LICENSE_PATH)?.content).toBe(licenseFileContent("CC-BY-4.0"));
  });
});
