import { describe, expect, it } from "vitest";
import { parseManifest } from "@alembic/package-contract";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";
import {
  PackageRenameError,
  normalizeTitle,
  renamePackageTitle,
  withTitle,
} from "./lifecycle";

const input = {
  ownerId: "user-1",
  title: "Thermochemistry",
  license: "CC-BY-4.0" as const,
};

async function seeded() {
  const store = new MemoryPackageStore();
  const { packageId } = await createSandboxPackage(store, input);
  return { store, packageId };
}

async function readManifest(store: MemoryPackageStore, packageId: string) {
  const files = await store.listFiles(packageId);
  const file = files.find((f) => f.repo === "public" && f.path === "alembic.json");
  return parseManifest(JSON.parse(file!.content));
}

describe("normalizeTitle", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeTitle("  Acids and Bases  ")).toBe("Acids and Bases");
  });
  it("rejects an empty title", () => {
    expect(() => normalizeTitle("   ")).toThrow(PackageRenameError);
  });
  it("rejects an over-long title", () => {
    expect(() => normalizeTitle("x".repeat(201))).toThrow(PackageRenameError);
  });
});

describe("withTitle", () => {
  it("returns a new manifest with the title replaced, leaving the id intact", async () => {
    const { store, packageId } = await seeded();
    const manifest = await readManifest(store, packageId);
    const next = withTitle(manifest, "Renamed");
    expect(next.title).toBe("Renamed");
    expect(next.packageId).toBe(manifest.packageId);
    expect(manifest.title).toBe("Thermochemistry"); // original untouched
  });
});

describe("renamePackageTitle", () => {
  it("updates the title in the manifest file and returns the new manifest", async () => {
    const { store, packageId } = await seeded();
    const before = await readManifest(store, packageId);

    const updated = await renamePackageTitle(store, packageId, "  Intro Acid–Base  ");

    expect(updated.title).toBe("Intro Acid–Base");
    // Persisted to the source-of-truth file.
    const after = await readManifest(store, packageId);
    expect(after.title).toBe("Intro Acid–Base");
    // packageId is immutable across a rename.
    expect(after.packageId).toBe(before.packageId);
  });

  it("rejects an empty title without writing", async () => {
    const { store, packageId } = await seeded();
    await expect(renamePackageTitle(store, packageId, "  ")).rejects.toThrow(
      PackageRenameError,
    );
    const after = await readManifest(store, packageId);
    expect(after.title).toBe("Thermochemistry");
  });

  it("throws when the manifest file is missing", async () => {
    const store = new MemoryPackageStore();
    await expect(renamePackageTitle(store, "pkg-nope-00000000", "X")).rejects.toThrow(
      PackageRenameError,
    );
  });
});
