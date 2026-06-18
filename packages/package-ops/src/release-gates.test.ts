import { describe, expect, it } from "vitest";
import { createSandboxPackage } from "./create";
import { createChapter } from "./chapters";
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

  it("passes when content lives in a non-default chapter (multi-chapter)", async () => {
    const store = new MemoryPackageStore();
    const { packageId } = await createSandboxPackage(store, input);
    // Second chapter carries content; empty the first/default chapter.
    await createChapter(store, packageId, { title: "Acids" });
    await saveStudyGuide(store, packageId, {
      path: (await loadStudyGuide(store, packageId)).path,
      preamble: "",
      blocks: [],
    });
    const result = await releaseGates(store, packageId);
    expect(result.checks.find((c) => c.name === "Study guide")?.ok).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("fails only when EVERY chapter is empty", async () => {
    const store = new MemoryPackageStore();
    const { packageId } = await createSandboxPackage(store, input);
    const ch2 = await createChapter(store, packageId, { title: "Acids" });
    for (const path of [(await loadStudyGuide(store, packageId)).path, ch2.path]) {
      await saveStudyGuide(store, packageId, { path, preamble: "", blocks: [] });
    }
    const result = await releaseGates(store, packageId);
    expect(result.checks.find((c) => c.name === "Study guide")?.ok).toBe(false);
  });

  it("passes the Answer keys & embargo gate for a clean package", async () => {
    const store = new MemoryPackageStore();
    const { packageId } = await createSandboxPackage(store, input);
    const result = await releaseGates(store, packageId);
    expect(result.checks.find((c) => c.name === "Answer keys & embargo")?.ok).toBe(true);
  });

  it("fails the Answer keys & embargo gate when an answer key is staged public", async () => {
    const store = new MemoryPackageStore();
    const { packageId } = await createSandboxPackage(store, input);
    // Plant an answer-key-style file in the PUBLIC partition (simulating a leak).
    await store.putFiles(packageId, [
      {
        repo: "public",
        path: "private-instructor/answer-keys/qi-abcd1234.json",
        content: JSON.stringify({ itemId: "qi-abcd1234", answer: "leaked" }),
      },
    ]);
    const result = await releaseGates(store, packageId);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "Answer keys & embargo")?.ok).toBe(false);
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
