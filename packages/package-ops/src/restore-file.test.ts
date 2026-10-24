/**
 * Loop r3 (M3-4 sibling, P5.B.3.h): restoring one chapter of a published
 * course saves it online first and records it in Alembic's copy only after
 * that succeeded. Before r3 the restore action wrote the copy first; a
 * refused save then left Alembic showing a restore that never happened.
 */
import { describe, expect, it } from "vitest";
import { CommitFailedError, type Committer, type CommitPlanInput } from "./write-through";
import { MemoryPackageStore } from "./memory-store";
import { restoreStudyGuideFile } from "./restore-file";
import { MemoryDocumentRegistryStore, computeSourceHash } from "./document-registry";

const PKG = "pkg-1";
const PATH = "study-guide/ch01.md";
const OLD = "# Chapter 1\n\n## Energy {{attrs[#blk-aaaa1111]}}\n\nOld words.\n";

describe("single-chapter restore (loop r3, P5.B.3.h)", () => {
  it("[P5.B.3.h] a refused restore leaves Alembic's copy unchanged", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [{ repo: "public", path: PATH, content: "# Current\n" }]);
    const refuse: Committer = {
      commit: async () => {
        throw new CommitFailedError("refused");
      },
    };
    await expect(
      restoreStudyGuideFile(store, refuse, PKG, { path: PATH, content: OLD, summary: "Restore" }),
    ).rejects.toBeInstanceOf(CommitFailedError);
    expect(await store.readFile(PKG, "public", PATH)).toBe("# Current\n");
  });

  it("[P5.B.3.h] a restore that saves records exactly what was saved online", async () => {
    const store = new MemoryPackageStore();
    const plans: CommitPlanInput[] = [];
    const ok: Committer = {
      commit: async (plan) => {
        plans.push(plan);
        return { commitSha: "c1" };
      },
    };
    await restoreStudyGuideFile(store, ok, PKG, { path: PATH, content: OLD, summary: "Restore" });
    expect(plans).toHaveLength(1);
    expect(plans[0]!.repo).toBe("public");
    const committed = plans[0]!.changes[0]!;
    expect(committed.path).toBe(PATH);
    expect(await store.readFile(PKG, "public", PATH)).toBe(committed.content);
    expect(committed.content).toContain("Old words.");
  });

  it("[P5.B.3.h] a restore registers the restored file (its permalink records the restored version)", async () => {
    const registry = new MemoryDocumentRegistryStore();
    const store = new MemoryPackageStore(registry);
    await store.putFiles(PKG, [{ repo: "public", path: PATH, content: "# Current\n" }]);
    const ok: Committer = { commit: async () => ({ commitSha: "c1" }) };
    await restoreStudyGuideFile(store, ok, PKG, { path: PATH, content: OLD, summary: "Restore" });
    const row = (await registry.listLiveByPackage(PKG)).find((r) => r.path === PATH);
    expect(row).toBeDefined();
    expect(row!.sourceHash).toBe(computeSourceHash((await store.readFile(PKG, "public", PATH))!));
  });
});
