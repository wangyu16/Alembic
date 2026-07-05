import { describe, expect, it } from "vitest";
import type { PackageFile } from "./store";
import { MemoryPackageStore } from "./memory-store";
import { findLeakedPaths, reconcilePublicRepo, type RepoReader } from "./reconcile";

const PKG = "pkg-1";

/**
 * Hand-written fake RepoReader: a fixed head SHA, a canned changed-path list,
 * and a Map of path -> content representing the tree AT head. Absent from the
 * map == null (file removed/not present).
 */
class FakeRepoReader implements RepoReader {
  constructor(
    private readonly headSha: string,
    private readonly changed: Array<{
      path: string;
      status: "added" | "modified" | "removed";
    }>,
    private readonly contentAtHead: Map<string, string>,
  ) {}

  async getHeadSha(): Promise<string> {
    return this.headSha;
  }

  async listChangedPaths(): Promise<
    Array<{ path: string; status: "added" | "modified" | "removed" }>
  > {
    return this.changed;
  }

  async readFileAtRef(path: string, _ref: string): Promise<string | null> {
    return this.contentAtHead.get(path) ?? null;
  }
}

/** A study-guide chapter with valid, unique block-ID markers. */
function validStudyGuide(): string {
  return [
    "# Chapter 1",
    "",
    "## Energy {{attrs[#blk-aaaa1111]}}",
    "",
    "Energy is conserved.",
    "",
    "## Heat {{attrs[#blk-bbbb2222]}}",
    "",
    "Heat flows.",
    "",
  ].join("\n");
}

function fileSet(files: PackageFile[]): Set<string> {
  return new Set(files.map((f) => `${f.repo} ${f.path}`));
}

describe("reconcilePublicRepo", () => {
  it("up-to-date: head === lastSyncedSha writes nothing", async () => {
    const store = new MemoryPackageStore();
    const reader = new FakeRepoReader("sha-1", [], new Map());

    const out = await reconcilePublicRepo(store, PKG, {
      lastSyncedSha: "sha-1",
      reader,
    });

    expect(out).toEqual({ status: "up-to-date", headSha: "sha-1" });
    expect(await store.listFiles(PKG)).toEqual([]);
  });

  it("clean absorb: a foreign-modified study guide is projected into the store", async () => {
    const store = new MemoryPackageStore();
    const path = "study-guide/ch01.md";
    const content = validStudyGuide();
    const reader = new FakeRepoReader(
      "sha-2",
      [{ path, status: "modified" }],
      new Map([[path, content]]),
    );

    const out = await reconcilePublicRepo(store, PKG, {
      lastSyncedSha: "sha-1",
      reader,
    });

    expect(out.status).toBe("absorbed");
    if (out.status === "absorbed") {
      expect(out.headSha).toBe("sha-2");
      expect(out.changedPaths).toEqual([path]);
    }

    const files = await store.listFiles(PKG);
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({ repo: "public", path, content });
  });

  it("absorb a removal: a removed path is deleted from the store", async () => {
    const store = new MemoryPackageStore();
    const path = "study-guide/ch01.md";
    // Seed the store with the file as the existing projection.
    await store.putFiles(PKG, [{ repo: "public", path, content: "old" }]);

    const reader = new FakeRepoReader(
      "sha-2",
      [{ path, status: "removed" }],
      new Map(), // absent at head
    );

    const out = await reconcilePublicRepo(store, PKG, {
      lastSyncedSha: "sha-1",
      reader,
    });

    expect(out.status).toBe("absorbed");
    if (out.status === "absorbed") {
      expect(out.changedPaths).toEqual([path]);
    }
    expect(await store.listFiles(PKG)).toEqual([]);
  });

  it("QUARANTINE — leak: a private-instructor path in the PUBLIC repo is rejected, store unchanged", async () => {
    const store = new MemoryPackageStore();
    const leakPath = "private-instructor/answers.md";
    const reader = new FakeRepoReader(
      "sha-2",
      [{ path: leakPath, status: "added" }],
      new Map([[leakPath, "Solutions: ..."]]),
    );

    const out = await reconcilePublicRepo(store, PKG, {
      lastSyncedSha: "sha-1",
      reader,
    });

    expect(out.status).toBe("quarantined");
    if (out.status === "quarantined") {
      expect(out.headSha).toBe("sha-2");
      expect(out.violations.length).toBeGreaterThan(0);
      expect(out.violations.some((v) => v.includes(leakPath))).toBe(true);
    }
    // Provably wrote nothing.
    expect(await store.listFiles(PKG)).toEqual([]);
  });

  it("QUARANTINE — block IDs: a foreign study guide with a duplicate ID is rejected, store unchanged", async () => {
    const store = new MemoryPackageStore();
    const path = "study-guide/ch01.md";
    const dupContent = [
      "# Chapter 1",
      "",
      "## Energy {{attrs[#blk-aaaa1111]}}",
      "",
      "Body.",
      "",
      "## Heat {{attrs[#blk-aaaa1111]}}", // duplicate ID
      "",
      "Body.",
      "",
    ].join("\n");
    const reader = new FakeRepoReader(
      "sha-2",
      [{ path, status: "modified" }],
      new Map([[path, dupContent]]),
    );

    const out = await reconcilePublicRepo(store, PKG, {
      lastSyncedSha: "sha-1",
      reader,
    });

    expect(out.status).toBe("quarantined");
    if (out.status === "quarantined") {
      expect(out.violations.some((v) => v.includes("Duplicate block ID"))).toBe(
        true,
      );
      expect(out.violations.some((v) => v.includes(path))).toBe(true);
    }
    expect(await store.listFiles(PKG)).toEqual([]);
  });

  it("ABSORB — block IDs: an anonymous section (no marker) is legal (contract v2 §4)", async () => {
    const store = new MemoryPackageStore();
    const path = "study-guide/ch01.md";
    // A heading with no marker parses to id === null. Under contract v2 §4 a
    // missing block id is a legal anonymous section, so reconcile absorbs it.
    const anonymous = [
      "# Chapter 1",
      "",
      "## Energy", // no block-ID marker at all → anonymous section
      "",
      "Body.",
      "",
    ].join("\n");
    const reader = new FakeRepoReader(
      "sha-2",
      [{ path, status: "added" }],
      new Map([[path, anonymous]]),
    );

    const out = await reconcilePublicRepo(store, PKG, {
      lastSyncedSha: "sha-1",
      reader,
    });

    expect(out.status).toBe("absorbed");
  });

  it("never synced (lastSyncedSha null): validates then absorbs", async () => {
    const store = new MemoryPackageStore();
    const path = "study-guide/ch01.md";
    const content = validStudyGuide();
    const reader = new FakeRepoReader(
      "sha-1",
      [{ path, status: "added" }],
      new Map([[path, content]]),
    );

    const out = await reconcilePublicRepo(store, PKG, {
      lastSyncedSha: null,
      reader,
    });

    expect(out.status).toBe("absorbed");
    const files = await store.listFiles(PKG);
    expect(files).toHaveLength(1);
    expect(files[0]).toEqual({ repo: "public", path, content });
  });

  it("mixed: one clean file + one leaking file → quarantined, clean file NOT absorbed", async () => {
    const store = new MemoryPackageStore();
    const cleanPath = "study-guide/ch01.md";
    const leakPath = "private-instructor/key.md";
    const reader = new FakeRepoReader(
      "sha-2",
      [
        { path: cleanPath, status: "modified" },
        { path: leakPath, status: "added" },
      ],
      new Map([
        [cleanPath, validStudyGuide()],
        [leakPath, "answer key"],
      ]),
    );

    const out = await reconcilePublicRepo(store, PKG, {
      lastSyncedSha: "sha-1",
      reader,
    });

    expect(out.status).toBe("quarantined");
    if (out.status === "quarantined") {
      expect(out.violations.some((v) => v.includes(leakPath))).toBe(true);
    }
    // Whole reconcile rejected: the clean file is NOT in the store either.
    const files = await store.listFiles(PKG);
    expect(fileSet(files).has(`public ${cleanPath}`)).toBe(false);
    expect(files).toEqual([]);
  });

  it("absorbs added, modified, and removed in a single clean changeset", async () => {
    const store = new MemoryPackageStore();
    const removed = "concepts/old.md";
    await store.putFiles(PKG, [
      { repo: "public", path: removed, content: "stale" },
    ]);

    const added = "concepts/new.md";
    const modified = "study-guide/ch01.md";
    const sg = validStudyGuide();
    const reader = new FakeRepoReader(
      "sha-2",
      [
        { path: added, status: "added" },
        { path: modified, status: "modified" },
        { path: removed, status: "removed" },
      ],
      new Map([
        [added, "new concept"],
        [modified, sg],
      ]),
    );

    const out = await reconcilePublicRepo(store, PKG, {
      lastSyncedSha: "sha-1",
      reader,
    });

    expect(out.status).toBe("absorbed");
    const files = await store.listFiles(PKG);
    const set = fileSet(files);
    expect(set.has(`public ${added}`)).toBe(true);
    expect(set.has(`public ${modified}`)).toBe(true);
    expect(set.has(`public ${removed}`)).toBe(false);
  });
});

describe("findLeakedPaths (M21 audit)", () => {
  it("returns nothing for a clean public tree", () => {
    const paths = [
      "study-guide/ch01.md",
      "materials/structures/x.ketcher.svg",
      "alembic.json",
      "README.md",
      "CITATION.cff",
    ];
    expect(findLeakedPaths(paths)).toEqual([]);
  });

  it("flags private-layer paths that leaked into the public repo", () => {
    const paths = [
      "study-guide/ch01.md",
      "private-instructor/answers.md",
      "private-instructor/keys/exam1.md",
    ];
    const leaked = findLeakedPaths(paths);
    expect(leaked).toContain("private-instructor/answers.md");
    expect(leaked).toContain("private-instructor/keys/exam1.md");
    expect(leaked).not.toContain("study-guide/ch01.md");
  });
});
