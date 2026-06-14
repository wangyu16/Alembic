import { describe, expect, it } from "vitest";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";
import { loadStudyGuide, saveStudyGuide } from "./study-guide";
import { releaseGates } from "./release-gates";

const input = { ownerId: "u1", title: "Thermo", license: "CC-BY-4.0" as const };

describe("releaseGates", () => {
  it("passes a freshly seeded package", async () => {
    const store = new MemoryPackageStore();
    const { packageId } = await createSandboxPackage(store, input);
    const result = await releaseGates(store, packageId);
    expect(result.ok).toBe(true);
  });

  it("fails when the study guide is empty", async () => {
    const store = new MemoryPackageStore();
    const { packageId } = await createSandboxPackage(store, input);
    await saveStudyGuide(store, packageId, {
      path: (await loadStudyGuide(store, packageId)).path,
      preamble: "",
      blocks: [],
    });
    const result = await releaseGates(store, packageId);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "Study guide")?.ok).toBe(false);
  });

  it("flags a public file placed in a private layer path", async () => {
    const store = new MemoryPackageStore();
    const { packageId } = await createSandboxPackage(store, input);
    // Corrupt the projection directly (simulating external tampering).
    await store.putFiles(packageId, [
      { repo: "public", path: "private-instructor/leak.md", content: "oops" },
    ]);
    const result = await releaseGates(store, packageId);
    expect(result.ok).toBe(false);
    expect(
      result.checks.find((c) => c.name === "Public/private separation")?.ok,
    ).toBe(false);
  });
});
