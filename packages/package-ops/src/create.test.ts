import { describe, expect, it } from "vitest";
import {
  assertPathAllowedInRepo,
  BLOCK_ID_PATTERN,
  parseManifest,
  parseStudyGuide,
} from "@alembic/package-contract";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";

const input = {
  ownerId: "user-1",
  title: "Intro Acid-Base Chemistry",
  license: "CC-BY-4.0" as const,
  now: () => new Date("2026-06-11T12:00:00Z"),
};

describe("createSandboxPackage", () => {
  it("creates a valid sandbox manifest with no repo refs", async () => {
    const store = new MemoryPackageStore();
    const created = await createSandboxPackage(store, input);
    const manifest = parseManifest(created.manifest);
    expect(manifest.publicRepo).toBeUndefined();
    expect(manifest.privateRepo).toBeUndefined();
    expect(manifest.packageId).toMatch(/^pkg-intro-acid-base-chemistry-/);

    const record = await store.getPackage(created.packageId);
    expect(record?.storage).toBe("sandbox");
  });

  it("seeds starter files in both partitions with valid layer placement", async () => {
    const store = new MemoryPackageStore();
    const created = await createSandboxPackage(store, input);
    const files = await store.listFiles(created.packageId);
    const paths = files.map((f) => `${f.repo}:${f.path}`);
    expect(paths).toContain("public:alembic.json");
    expect(paths).toContain("public:study-guide/01-getting-started.md");
    expect(paths).toContain("private:private-instructor/notes/getting-started.md");
  });

  it("stamps block IDs into seeded study-guide content", async () => {
    const store = new MemoryPackageStore();
    const created = await createSandboxPackage(store, input);
    const files = await store.listFiles(created.packageId);
    const guide = files.find((f) => f.path.startsWith("study-guide/"));
    const match = guide?.content.match(/\{\{attrs\[#(blk-[a-z0-9]+)\]\}\}/);
    expect(match?.[1]).toMatch(BLOCK_ID_PATTERN);
  });

  it("opens with a plain '# Title' line (preamble) followed by a real '##' section — not an empty course", async () => {
    const store = new MemoryPackageStore();
    const created = await createSandboxPackage(store, input);
    const files = await store.listFiles(created.packageId);
    const guide = files.find((f) => f.path.startsWith("study-guide/"))!;
    expect(guide.content.startsWith(`# ${input.title}`)).toBe(true);
    const parsed = parseStudyGuide(guide.content);
    expect(parsed.preamble).toContain(`# ${input.title}`);
    // At least one real section — a fresh course must clear the "study guide
    // has content" release gate, not just have a title line.
    expect(parsed.blocks.length).toBeGreaterThan(0);
  });

  it("never places private-layer content in the public partition", async () => {
    const store = new MemoryPackageStore();
    const created = await createSandboxPackage(store, input);
    const files = await store.listFiles(created.packageId);
    const misplaced = files.filter(
      (f) => f.repo === "public" && f.path.startsWith("private-instructor/"),
    );
    expect(misplaced).toEqual([]);
    // Every file the operation handed the store re-validates cleanly:
    for (const f of files) {
      expect(() => assertPathAllowedInRepo(f.path, f.repo)).not.toThrow();
    }
  });
});
