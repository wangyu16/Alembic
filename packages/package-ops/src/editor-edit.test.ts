import { describe, expect, it } from "vitest";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";
import { applyEditorEdit } from "./editor-edit";
import { loadStudyGuide } from "./study-guide";

const input = { ownerId: "u1", title: "Thermo", license: "CC-BY-4.0" as const };

async function seeded() {
  const store = new MemoryPackageStore();
  const { packageId } = await createSandboxPackage(store, input);
  return { store, packageId };
}

async function files(store: MemoryPackageStore, packageId: string) {
  return (await store.listFiles(packageId)).filter((f) => f.repo === "public");
}

describe("applyEditorEdit", () => {
  it("routes study-guide markdown through saveStudyGuide (IDs preserved)", async () => {
    const { store, packageId } = await seeded();
    const doc = await loadStudyGuide(store, packageId);
    const id = doc.blocks[0]!.id!;
    const source = `## ${doc.blocks[0]!.title}{{attrs[#${id}]}}\n\nrewritten by AI.`;
    await applyEditorEdit(store, packageId, { path: doc.path, repo: "public", source });
    const after = await loadStudyGuide(store, packageId);
    expect(after.blocks[0]!.id).toBe(id); // preserved
    expect(after.blocks[0]!.body).toContain("rewritten by AI");
  });

  it("rejects a study-guide edit that references a private file", async () => {
    const { store, packageId } = await seeded();
    const doc = await loadStudyGuide(store, packageId);
    const source = `## X{{attrs[#${doc.blocks[0]!.id}]}}\n\n![k](private-instructor/key.md)`;
    await expect(
      applyEditorEdit(store, packageId, { path: doc.path, repo: "public", source }),
    ).rejects.toThrow();
  });

  it("writes a public carrier file (materials) by path", async () => {
    const { store, packageId } = await seeded();
    const path = "materials/figures/note.md";
    await applyEditorEdit(store, packageId, { path, repo: "public", source: "edited" });
    const f = (await files(store, packageId)).find((x) => x.path === path);
    expect(f?.content).toBe("edited");
  });

  it("writes a private file (answer key) by path", async () => {
    const { store, packageId } = await seeded();
    const path = "private-instructor/answer-keys/q1.md";
    await applyEditorEdit(store, packageId, { path, repo: "private", source: "key" });
    const f = (await store.listFiles(packageId)).find(
      (x) => x.repo === "private" && x.path === path,
    );
    expect(f?.content).toBe("key");
  });

  it("fails closed when path and repo disagree (public path claimed private)", async () => {
    const { store, packageId } = await seeded();
    await expect(
      applyEditorEdit(store, packageId, {
        path: "study-guide/x.md",
        repo: "private",
        source: "x",
      }),
    ).rejects.toThrow();
  });
});
