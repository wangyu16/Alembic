import { describe, expect, it } from "vitest";
import { BLOCK_ID_PATTERN, parseManifest } from "@alembic/package-contract";
import { createSandboxPackage } from "./create";
import type { PackageFile, PackageRecord, PackageStore } from "./store";

class MemoryStore implements PackageStore {
  records: PackageRecord[] = [];
  files: PackageFile[] = [];
  async createPackage(record: PackageRecord, files: PackageFile[]) {
    this.records.push(record);
    this.files.push(...files);
  }
}

const input = {
  ownerId: "user-1",
  title: "Intro Acid-Base Chemistry",
  license: "CC-BY-4.0" as const,
  now: () => new Date("2026-06-11T12:00:00Z"),
};

describe("createSandboxPackage", () => {
  it("creates a valid sandbox manifest with no repo refs", async () => {
    const store = new MemoryStore();
    const created = await createSandboxPackage(store, input);
    const manifest = parseManifest(created.manifest);
    expect(manifest.publicRepo).toBeUndefined();
    expect(manifest.privateRepo).toBeUndefined();
    expect(manifest.packageId).toMatch(/^pkg-intro-acid-base-chemistry-/);
    expect(store.records[0]?.storage).toBe("sandbox");
  });

  it("seeds starter files in both partitions with valid layer placement", async () => {
    const store = new MemoryStore();
    await createSandboxPackage(store, input);
    const paths = store.files.map((f) => `${f.repo}:${f.path}`);
    expect(paths).toContain("public:alembic.json");
    expect(paths).toContain("public:study-guide/01-getting-started.md");
    expect(paths).toContain("private:private-instructor/notes/getting-started.md");
  });

  it("stamps block IDs into seeded study-guide content", async () => {
    const store = new MemoryStore();
    await createSandboxPackage(store, input);
    const guide = store.files.find((f) => f.path.startsWith("study-guide/"));
    const match = guide?.content.match(/\{\{attrs\[#(blk-[a-z0-9]+)\]\}\}/);
    expect(match?.[1]).toMatch(BLOCK_ID_PATTERN);
  });

  it("never places private-layer content in the public partition", async () => {
    const store = new MemoryStore();
    await createSandboxPackage(store, input);
    const misplaced = store.files.filter(
      (f) => f.repo === "public" && f.path.startsWith("private-instructor/"),
    );
    expect(misplaced).toEqual([]);
    // And every file the operation hands the store re-validates cleanly:
    const { assertPathAllowedInRepo } = await import("@alembic/package-contract");
    for (const f of store.files) {
      expect(() => assertPathAllowedInRepo(f.path, f.repo)).not.toThrow();
    }
  });
});
