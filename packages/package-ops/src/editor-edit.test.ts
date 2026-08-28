import { describe, expect, it } from "vitest";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";
import { applyEditorEdit, prepareEditorEdit } from "./editor-edit";
import { loadStudyGuide, saveStudyGuide } from "./study-guide";

const input = { ownerId: "u1", title: "Thermo", license: "CC-BY-4.0" as const };

async function seeded() {
  const store = new MemoryPackageStore();
  const { packageId } = await createSandboxPackage(store, input);
  // Packages are created empty (slots, not placeholders — spec §4), so a test
  // that needs a study guide authors one through the real save path.
  await saveStudyGuide(store, packageId, {
    path: "study-guide/01-getting-started.md",
    preamble: "",
    blocks: [{ id: null, title: "Getting started", body: "First section." }],
  });
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

/**
 * The prepare half (T15): the same routing and the same gates, returning the
 * bytes instead of writing them, so the caller can commit before it projects
 * (docs/specs/storage-and-write-paths.md §3).
 */
describe("prepareEditorEdit", () => {
  it("returns exactly what applyEditorEdit writes for a study-guide file", async () => {
    const { store, packageId } = await seeded();
    const path = "study-guide/01-prepare.md";
    // An id is already present, so both calls canonicalize to the same bytes
    // (minting is the only non-deterministic step, and rule 7 forbids re-minting).
    const source = "# Ch\n\n## Energy{{attrs[#blk-aaaaaaaaaaaa]}}\n\nBody.";
    const prepared = prepareEditorEdit({ path, repo: "public", source });
    await applyEditorEdit(store, packageId, { path, repo: "public", source });
    const written = (await files(store, packageId)).find((f) => f.path === path);
    expect(prepared).toEqual(written);
    // Study-guide markdown is canonicalized, so the committed bytes are the
    // re-serialization, not the raw source.
    expect(prepared.content).toContain("blk-aaaaaaaaaaaa");
  });

  it("passes a non-study-guide public carrier through byte-exact", () => {
    const prepared = prepareEditorEdit({
      path: "materials/figures/note.md",
      repo: "public",
      source: "edited",
    });
    expect(prepared).toEqual({
      repo: "public",
      path: "materials/figures/note.md",
      content: "edited",
    });
  });

  it("scans public text carriers for private references", () => {
    expect(() =>
      prepareEditorEdit({
        path: "materials/figures/note.md",
        repo: "public",
        source: "![k](private-instructor/answer-keys/ch1.md)",
      }),
    ).toThrow();
  });

  it("leaves private files byte-exact (path-validated only)", () => {
    const prepared = prepareEditorEdit({
      path: "private-instructor/answer-keys/q1.md",
      repo: "private",
      source: "The answer is 42. See private-instructor/notes/x.md",
    });
    expect(prepared.repo).toBe("private");
    expect(prepared.content).toBe("The answer is 42. See private-instructor/notes/x.md");
  });

  it("fails closed when a private path is routed at the public repo", () => {
    expect(() =>
      prepareEditorEdit({
        path: "private-instructor/answer-keys/q1.md",
        repo: "public",
        source: "leak",
      }),
    ).toThrow();
  });

  it("writes nothing when it refuses", async () => {
    const { store, packageId } = await seeded();
    const before = await store.listFiles(packageId);
    expect(() =>
      prepareEditorEdit({ path: "study-guide/x.md", repo: "private", source: "x" }),
    ).toThrow();
    expect(await store.listFiles(packageId)).toEqual(before);
  });
});
