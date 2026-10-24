/**
 * Loop r4 (P5.B.3.k, P5.B.3.l) — reconcile, IO-free: blob ids first, absorbs
 * by compare-and-set, text that isn't text held back, and a quarantine that
 * says which files it holds back.
 */
import { describe, expect, it, vi } from "vitest";
import { MemoryPackageStore } from "./memory-store";
import { reconcilePublicRepo, UnreadableFileError, type RepoReader } from "./reconcile";

const PKG = "pkg-1";

function reader(
  changed: Array<{ path: string; status: "added" | "modified" | "removed" }>,
  atHead: Record<string, string>,
  extra: Partial<RepoReader> = {},
): RepoReader {
  return {
    getHeadSha: async () => "sha-2",
    listChangedPaths: async () => changed,
    readFileAtRef: async (p) => atHead[p] ?? null,
    ...extra,
  };
}

describe("reconcile, loop r4", () => {
  it("[P5.B.3.k] a file whose blob id matches the stored copy is never read", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [{ repo: "public", path: "assets/big.png", content: "AAAA" }]);
    const read = vi.fn(async () => "BBBB");
    const out = await reconcilePublicRepo(store, PKG, {
      lastSyncedSha: "sha-1",
      reader: reader([{ path: "assets/big.png", status: "modified" }], {}, {
        readFileAtRef: read,
        sameAsStored: async () => true,
      }),
    });
    expect(read).not.toHaveBeenCalled();
    expect(out.status).toBe("absorbed");
    if (out.status === "absorbed") expect(out.changedPaths).toEqual([]);
  });

  it("[P5.B.3.k] a save that lands while reconcile runs is kept: every absorb is compare-and-set against the copy it read", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "study-guide/ch1.md", content: "# Old\n" },
      { repo: "public", path: "study-guide/ch2.md", content: "# Two\n" },
    ]);
    const out = await reconcilePublicRepo(store, PKG, {
      lastSyncedSha: "sha-1",
      reader: reader(
        [
          { path: "study-guide/ch2.md", status: "removed" }, // its stored copy is read first
          { path: "study-guide/ch1.md", status: "modified" },
        ],
        {},
        {
          readFileAtRef: async () => {
            // The educator's newer save lands between the read and the absorb.
            await store.putFiles(PKG, [
              { repo: "public", path: "study-guide/ch1.md", content: "# Newer, saved in Alembic\n" },
              { repo: "public", path: "study-guide/ch2.md", content: "# Two, saved in Alembic\n" },
            ]);
            return "# Head\n";
          },
        },
      ),
    });
    expect(out.status).toBe("absorbed");
    expect(await store.readFile(PKG, "public", "study-guide/ch1.md")).toBe("# Newer, saved in Alembic\n");
    expect(await store.readFile(PKG, "public", "study-guide/ch2.md")).toBe("# Two, saved in Alembic\n");
  });

  it("[P5.B.3.k] text that is not text is held back by path; nothing is written", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [{ repo: "public", path: "study-guide/ch1.md", content: "# One\n" }]);
    const out = await reconcilePublicRepo(store, PKG, {
      lastSyncedSha: "sha-1",
      reader: reader([{ path: "study-guide/ch1.md", status: "modified" }], {}, {
        readFileAtRef: async (p) => {
          throw new UnreadableFileError(p);
        },
      }),
    });
    expect(out.status).toBe("quarantined");
    if (out.status === "quarantined") expect(out.violationPaths).toEqual(["study-guide/ch1.md"]);
    expect(await store.readFile(PKG, "public", "study-guide/ch1.md")).toBe("# One\n");
  });

  it("[P5.B.3.l] a quarantine names the files it is about and the clean differences it held back with them", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [
      { repo: "public", path: "study-guide/ch1.md", content: "# One\n" },
      { repo: "public", path: "study-guide/ch2.md", content: "# Two\n" },
      { repo: "public", path: "study-guide/ch3.md", content: "# Three\n" },
    ]);
    const out = await reconcilePublicRepo(store, PKG, {
      lastSyncedSha: "sha-1",
      reader: reader(
        [
          { path: "study-guide/ch1.md", status: "modified" },
          { path: "study-guide/ch2.md", status: "modified" },
          { path: "study-guide/ch3.md", status: "modified" },
          { path: "private/answers.md", status: "added" },
        ],
        {
          "study-guide/ch1.md": "# One, edited\n",
          "study-guide/ch2.md": "## A{{attrs[#blk-aaaaaaaa1]}}\n\n## B{{attrs[#blk-aaaaaaaa1]}}\n",
          "study-guide/ch3.md": "# Three\n", // Alembic's own save: no difference
        },
      ),
    });
    expect(out.status).toBe("quarantined");
    if (out.status !== "quarantined") return;
    expect(out.violationPaths.sort()).toEqual(["private/answers.md", "study-guide/ch2.md"]);
    expect(out.changedPaths).toEqual(["study-guide/ch1.md"]);
    expect(await store.readFile(PKG, "public", "study-guide/ch1.md")).toBe("# One\n");
  });
});
