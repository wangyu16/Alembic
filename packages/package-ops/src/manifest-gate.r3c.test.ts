/**
 * Loop r3 (correctness), L3-2 — P5.B.1.y: the course details file
 * (`alembic.json`) can never be stored broken through the file write path.
 *
 * Before: the editor's whole-file save accepted `alembic.json` as raw text
 * (`prepareEditorEdit` → `writeThrough`), so invalid JSON or a manifest the
 * schema refuses was stored — and every later `updateManifest` failed forever.
 */
import { describe, expect, it } from "vitest";
import { createSandboxPackage } from "./create";
import { MemoryPackageStore } from "./memory-store";
import { prepareEditorEdit } from "./editor-edit";
import { updateManifest, MANIFEST_PATH } from "./manifest-ops";
import { writeThrough, type Committer } from "./write-through";

async function seeded() {
  const store = new MemoryPackageStore();
  const { packageId } = await createSandboxPackage(store, {
    ownerId: "a",
    title: "Src",
    license: "CC-BY-4.0",
  });
  const before = (await store.readFile(packageId, "public", MANIFEST_PATH))!;
  return { store, packageId, before };
}

describe("P5.B.1.y alembic.json is never stored broken", () => {
  it("[P5.B.1.y] the editor save refuses alembic.json — course details change only through the manifest owner", async () => {
    const { store, packageId, before } = await seeded();
    for (const source of ['{"title": "oops"', JSON.stringify({ title: "no schema" }), before]) {
      expect(() => prepareEditorEdit({ path: "alembic.json", repo: "public", source })).toThrow(
        /course details/i,
      );
      expect(() => prepareEditorEdit({ path: "./alembic.json", repo: "public", source })).toThrow();
    }
    expect(await store.readFile(packageId, "public", MANIFEST_PATH)).toBe(before);
    // The manifest owner still works.
    const { manifest } = await updateManifest(store, null, packageId, (m) => ({ ...m, title: "Ok" }));
    expect(manifest.title).toBe("Ok");
  });

  it("[P5.B.1.y] writeThrough refuses an invalid, schema-invalid, foreign or deleted alembic.json before any commit", async () => {
    const { store, packageId, before } = await seeded();
    let commits = 0;
    const committer: Committer = {
      async commit() {
        commits += 1;
        return { commitSha: "sha" };
      },
    };
    const foreign = JSON.stringify({ ...JSON.parse(before), packageId: "pkg-other-aaaaaaaa" });
    for (const content of ['{"title": "oops"', JSON.stringify({ title: "no schema" }), foreign, null]) {
      for (const c of [null, committer]) {
        await expect(
          writeThrough(store, c, packageId, {
            changes: [{ repo: "public", path: "alembic.json", content }],
            summary: "x",
          }),
        ).rejects.toThrow(/course details/i);
      }
    }
    expect(commits).toBe(0);
    expect(await store.readFile(packageId, "public", MANIFEST_PATH)).toBe(before);
    await expect(updateManifest(store, null, packageId, (m) => m)).resolves.toBeDefined();
  });

  it("[P5.B.1.y] a valid manifest for this course still goes through (whole-course upload)", async () => {
    const { store, packageId, before } = await seeded();
    const next = JSON.stringify({ ...JSON.parse(before), title: "Uploaded" }, null, 2) + "\n";
    await writeThrough(store, null, packageId, {
      changes: [{ repo: "public", path: "alembic.json", content: next }],
      summary: "x",
    });
    expect(await store.readFile(packageId, "public", MANIFEST_PATH)).toBe(next);
  });
});
