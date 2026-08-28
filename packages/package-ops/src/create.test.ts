import { describe, expect, it } from "vitest";
import {
  assertPathAllowedInRepo,
  parseManifest,
} from "@alembic/package-contract";
import {
  createSandboxPackage,
  FIRST_CHAPTER_SLUG,
  ROOT_SCAFFOLD_PATHS,
  isPristinePackage,
} from "./create";
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

  it("writes root scaffold only — no seeded content files (slots, not placeholders)", async () => {
    const store = new MemoryPackageStore();
    const created = await createSandboxPackage(store, input);
    const files = await store.listFiles(created.packageId);
    const paths = files.map((f) => `${f.repo}:${f.path}`);

    expect(paths).toContain("public:alembic.json");
    expect(paths).toContain("public:LICENSE");
    // The two legacy welcome placeholders are gone for good.
    expect(paths).not.toContain("public:study-guide/01-getting-started.md");
    expect(paths).not.toContain(
      "private:private-instructor/notes/getting-started.md",
    );
    // Nothing at all outside the root scaffold.
    const scaffold = new Set<string>(ROOT_SCAFFOLD_PATHS);
    expect(files.filter((f) => !scaffold.has(f.path))).toEqual([]);
  });

  it("declares one explicit first chapter so no phantom chapter is derived", async () => {
    const store = new MemoryPackageStore();
    const created = await createSandboxPackage(store, input);

    // Both the returned manifest and the persisted alembic.json carry it.
    expect(created.manifest.chapters).toEqual([
      { slug: FIRST_CHAPTER_SLUG, title: input.title },
    ]);

    const files = await store.listFiles(created.packageId);
    const file = files.find(
      (f) => f.repo === "public" && f.path === "alembic.json",
    )!;
    const persisted = parseManifest(JSON.parse(file.content));
    expect(persisted.chapters).toEqual([
      { slug: FIRST_CHAPTER_SLUG, title: input.title },
    ]);

    // …and that chapter has no file behind it: the slot is empty until the
    // educator saves real content.
    expect(
      files.some((f) => f.path === `study-guide/${FIRST_CHAPTER_SLUG}.md`),
    ).toBe(false);
  });

  it("is still pristine by the (unchanged) populate gate", async () => {
    const store = new MemoryPackageStore();
    const created = await createSandboxPackage(store, input);
    const files = await store.listFiles(created.packageId);
    expect(isPristinePackage(files)).toBe(true);
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
