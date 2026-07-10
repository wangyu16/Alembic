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

  // Both gates iterate EVERY public file through the repo check. They used the
  // v1-only assert, so a native-v2 path — most urgently `current/`, which has
  // no v1 layer at all — would have failed them and silently blocked
  // publishing. The dual-mode swap fixes that; these guard both directions.
  it("passes both gates for native-v2 public spaces (current/, assets/)", async () => {
    const store = new MemoryPackageStore();
    const { packageId } = await createSandboxPackage(store, input);
    await store.putFiles(packageId, [
      { repo: "public", path: "current/2026-spring/syllabus.md", content: "# Syllabus" },
      { repo: "public", path: "assets/chapters/01-getting-started/fig.svg", content: "<svg/>" },
    ]);
    const result = await releaseGates(store, packageId);
    expect(result.checks.find((c) => c.name === "Public/private separation")?.ok).toBe(true);
    expect(result.checks.find((c) => c.name === "Answer keys & embargo")?.ok).toBe(true);
  });

  it("still fails both gates for a v2 private-space file staged public", async () => {
    const store = new MemoryPackageStore();
    const { packageId } = await createSandboxPackage(store, input);
    // `private/` is the v2 private space; it must be rejected for the public
    // repo exactly as `private-instructor/` (v1) is. The dual-mode OR must not
    // have opened a hole on the v2 side.
    await store.putFiles(packageId, [
      { repo: "public", path: "private/answer-keys/quiz1.json", content: "leaked" },
    ]);
    const result = await releaseGates(store, packageId);
    expect(result.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "Public/private separation")?.ok).toBe(false);
    expect(result.checks.find((c) => c.name === "Answer keys & embargo")?.ok).toBe(false);
  });
});
