/**
 * Loop r3 (P5.B.3.g): reconcile reports — and writes — only the paths whose
 * content at head really differs from Alembic's stored copy. The committer
 * relies on this to tell "the outside change was Alembic's own save, already
 * in the store" (safe to retry the save) from a real outside edit (refuse;
 * the edit has now been brought in).
 */
import { describe, expect, it, vi } from "vitest";
import { parseManifest } from "@alembic/package-contract";
import { MemoryPackageStore } from "./memory-store";
import { reconcilePublicRepo, type RepoReader } from "./reconcile";
import { MANIFEST_PATH, serializeManifest } from "./manifest-ops";

const PKG = "pkg-1";

function reader(
  changed: Array<{ path: string; status: "added" | "modified" | "removed" }>,
  atHead: Record<string, string>,
): RepoReader {
  return {
    getHeadSha: async () => "sha-2",
    listChangedPaths: async () => changed,
    readFileAtRef: async (p) => atHead[p] ?? null,
  };
}

describe("reconcile reports only real differences (loop r3, P5.B.3.g)", () => {
  it("[P5.B.3.g] a listed path whose content equals the stored copy is neither written nor reported", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "study-guide/ch1.md", content: "# Same\n" },
      { repo: "public", path: "study-guide/ch2.md", content: "# Old\n" },
    ]);
    const put = vi.spyOn(store, "putFiles");
    const out = await reconcilePublicRepo(store, PKG, {
      lastSyncedSha: "sha-1",
      reader: reader(
        [
          { path: "study-guide/ch1.md", status: "modified" },
          { path: "study-guide/ch2.md", status: "modified" },
        ],
        { "study-guide/ch1.md": "# Same\n", "study-guide/ch2.md": "# New\n" },
      ),
    });
    expect(out.status).toBe("absorbed");
    if (out.status === "absorbed") expect(out.changedPaths).toEqual(["study-guide/ch2.md"]);
    expect(put.mock.calls.map((c) => c[1].map((f) => f.path))).toEqual([["study-guide/ch2.md"]]);
    expect(await store.readFile(PKG, "public", "study-guide/ch2.md")).toBe("# New\n");
  });

  it("[P5.B.3.g] a listed removal of a file the store does not have is not reported", async () => {
    const store = new MemoryPackageStore();
    const out = await reconcilePublicRepo(store, PKG, {
      lastSyncedSha: "sha-1",
      reader: reader([{ path: "study-guide/gone.md", status: "removed" }], {}),
    });
    expect(out.status).toBe("absorbed");
    if (out.status === "absorbed") expect(out.changedPaths).toEqual([]);
  });

  it("[P5.B.3.g] an unchanged course details file is not re-absorbed", async () => {
    const store = new MemoryPackageStore();
    const m = parseManifest({
      schemaVersion: 2,
      packageId: PKG,
      title: "T",
      license: "CC-BY-4.0",
      createdAt: "2026-08-28T00:00:00.000Z",
    });
    const text = serializeManifest(m);
    await store.putFiles(PKG, [{ repo: "public", path: MANIFEST_PATH, content: text }]);
    const out = await reconcilePublicRepo(store, PKG, {
      lastSyncedSha: "sha-1",
      reader: reader([{ path: MANIFEST_PATH, status: "modified" }], { [MANIFEST_PATH]: text }),
    });
    expect(out.status).toBe("absorbed");
    if (out.status === "absorbed") {
      expect(out.changedPaths).toEqual([]);
      expect(out.manifest).toBeUndefined();
    }
  });
});
