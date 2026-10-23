import { describe, expect, it } from "vitest";
import { embedSource } from "@alembic/carriers";
import type { PackageFile } from "./store";
import { MemoryPackageStore } from "./memory-store";
import { findLeakedPaths, reconcilePublicRepo, type RepoReader } from "./reconcile";
import { parseManifest } from "@alembic/package-contract";
import { createSandboxPackage } from "./create";
import { MANIFEST_PATH, serializeManifest } from "./manifest-ops";

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

  // ── contract v2: .md.html study guides + v2 spaces (door-#3 origin parity) ──

  it("ABSORB — v2 study guide as .md.html (block IDs validated from extracted source)", async () => {
    const store = new MemoryPackageStore();
    const path = "study-guide/ch01.md.html";
    const file = embedSource({
      kind: "md",
      format: 1,
      payload: "html",
      rendered: "<!doctype html><html><body><main>rendered</main></body></html>",
      source: validStudyGuide(),
    });
    const reader = new FakeRepoReader(
      "sha-2",
      [{ path, status: "added" }],
      new Map([[path, file]]),
    );
    const out = await reconcilePublicRepo(store, PKG, { lastSyncedSha: "sha-1", reader });
    expect(out.status).toBe("absorbed");
  });

  it("QUARANTINE — v2 .md.html study guide with DUPLICATE block IDs", async () => {
    const store = new MemoryPackageStore();
    const path = "study-guide/ch01.md.html";
    const dupSource = [
      "# Chapter 1",
      "",
      "## Energy {{attrs[#blk-aaaa1111]}}",
      "",
      "Body A.",
      "",
      "## Heat {{attrs[#blk-aaaa1111]}}", // same id — corruption that breaks identity
      "",
      "Body B.",
      "",
    ].join("\n");
    const file = embedSource({
      kind: "md",
      format: 1,
      payload: "html",
      rendered: "<!doctype html><html><body>x</body></html>",
      source: dupSource,
    });
    const reader = new FakeRepoReader(
      "sha-2",
      [{ path, status: "added" }],
      new Map([[path, file]]),
    );
    const out = await reconcilePublicRepo(store, PKG, { lastSyncedSha: "sha-1", reader });
    expect(out.status).toBe("quarantined");
    expect(await store.listFiles(PKG)).toEqual([]);
  });

  it("QUARANTINE — a v2 private-space path in the PUBLIC repo (invariant holds under dual-mode)", async () => {
    const store = new MemoryPackageStore();
    const path = "private/answer-keys/exam.md"; // v2 private space — must never be public
    const reader = new FakeRepoReader(
      "sha-2",
      [{ path, status: "added" }],
      new Map([[path, "secret"]]),
    );
    const out = await reconcilePublicRepo(store, PKG, { lastSyncedSha: "sha-1", reader });
    expect(out.status).toBe("quarantined");
    expect(await store.listFiles(PKG)).toEqual([]);
  });

  it("ABSORB — a v2 public-space path (assets/) is not wrongly rejected", async () => {
    const store = new MemoryPackageStore();
    const path = "assets/figures/benzene.png"; // v2 assets space (was v1 materials/)
    const reader = new FakeRepoReader(
      "sha-2",
      [{ path, status: "added" }],
      new Map([[path, "\x89PNG…"]]),
    );
    const out = await reconcilePublicRepo(store, PKG, { lastSyncedSha: "sha-1", reader });
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

/**
 * The PRIVATE repo is never reconciled (public-only by design — DecisionLog
 * 2026-07-11, "Deferred" 1), so the boundary property to hold is: a public
 * reconcile can never read, write, delete or register anything private.
 * Adversarial cases (Phase 5 Track B.3).
 */
describe("reconcilePublicRepo — the private repo is out of reach", () => {
  const SECRET = { repo: "private" as const, path: "private-instructor/notes/answers.md", content: "Answer key" };
  const V2_SECRET = { repo: "private" as const, path: "private/notes/key.md", content: "Key v2" };

  it("[P5.B.3.c] a foreign REMOVAL of a private-looking path deletes nothing private", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [SECRET, V2_SECRET]);
    // Someone deletes same-named paths in the PUBLIC repo (they never belonged
    // there). Removals are not validated, so this must be harmless by design.
    const reader = new FakeRepoReader(
      "sha-2",
      [
        { path: SECRET.path, status: "removed" },
        { path: V2_SECRET.path, status: "removed" },
      ],
      new Map(),
    );
    const out = await reconcilePublicRepo(store, PKG, { lastSyncedSha: "sha-1", reader });
    expect(out.status).toBe("absorbed");
    expect(await store.readFile(PKG, "private", SECRET.path)).toBe("Answer key");
    expect(await store.readFile(PKG, "private", V2_SECRET.path)).toBe("Key v2");
  });

  it("[P5.B.3.c] absorbed files land in the PUBLIC partition only, never overwriting a private file", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [SECRET]);
    const reader = new FakeRepoReader(
      "sha-2",
      [{ path: "assets/fig.svg", status: "added" }],
      new Map([["assets/fig.svg", "<svg/>"]]),
    );
    const out = await reconcilePublicRepo(store, PKG, { lastSyncedSha: "sha-1", reader });
    expect(out.status).toBe("absorbed");
    const files = await store.listFiles(PKG);
    expect(files.filter((f) => f.repo === "private")).toEqual([SECRET]);
    expect(files.find((f) => f.path === "assets/fig.svg")?.repo).toBe("public");
  });

  it("[P5.B.3.c] a quarantined leak is not readable afterwards from either partition", async () => {
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [SECRET]);
    const reader = new FakeRepoReader(
      "sha-2",
      [{ path: SECRET.path, status: "modified" }],
      new Map([[SECRET.path, "LEAKED copy"]]),
    );
    const out = await reconcilePublicRepo(store, PKG, { lastSyncedSha: "sha-1", reader });
    expect(out.status).toBe("quarantined");
    expect(await store.readFile(PKG, "public", SECRET.path)).toBeNull();
    expect(await store.readFile(PKG, "private", SECRET.path)).toBe("Answer key");
  });

  it("[P5.B.3.c] registering an absorbed diff (the web door) touches no private record", async () => {
    const { MemoryDocumentRegistryStore, rebuildPackageRegistry, registerChangedFiles } =
      await import("./document-registry");
    const store = new MemoryPackageStore();
    await store.putFiles(PKG, [SECRET, { repo: "public", path: "assets/old.svg", content: "<svg>o</svg>" }]);
    const registry = new MemoryDocumentRegistryStore();
    await rebuildPackageRegistry(registry, store, PKG);
    const privateBefore = (await registry.listByPackage(PKG)).filter((r) => r.repo === "private");
    expect(privateBefore).toHaveLength(1);

    const reader = new FakeRepoReader(
      "sha-2",
      [
        { path: "assets/old.svg", status: "removed" },
        { path: SECRET.path, status: "removed" },
        { path: "assets/new.svg", status: "added" },
      ],
      new Map([["assets/new.svg", "<svg>n</svg>"]]),
    );
    const out = await reconcilePublicRepo(store, PKG, { lastSyncedSha: "sha-1", reader });
    if (out.status !== "absorbed") throw new Error("expected absorb");
    // What lib/github.ts does with the outcome: register the diff, public repo.
    await registerChangedFiles(
      registry,
      store,
      PKG,
      out.changedPaths.map((path) => ({ repo: "public" as const, path })),
      "external-commit",
    );
    const after = await registry.listByPackage(PKG);
    expect(after.filter((r) => r.repo === "private")).toEqual(privateBefore);
    expect(after.find((r) => r.path === "assets/old.svg")?.tombstoned).toBe(true);
    expect(after.find((r) => r.path === "assets/new.svg" && !r.tombstoned)?.repo).toBe("public");
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

describe("reconcilePublicRepo — the course details file (alembic.json)", () => {
  async function seeded() {
    const store = new MemoryPackageStore();
    const { packageId } = await createSandboxPackage(store, {
      ownerId: "user-1",
      title: "Thermochemistry",
      license: "CC-BY-4.0",
    });
    const raw = (await store.readFile(packageId, "public", MANIFEST_PATH))!;
    return { store, packageId, raw, manifest: parseManifest(JSON.parse(raw)) };
  }

  it("[P5.B.3.e] a reconcile that absorbs alembic.json updates packages.manifest through the manifest write path so the projection sees licence/listing changes", async () => {
    const { store, packageId, manifest } = await seeded();
    // Edited on GitHub: licence changed, no trailing newline / other spacing.
    const foreign = JSON.stringify({ ...manifest, license: "CC0-1.0" });
    const reader = new FakeRepoReader(
      "sha-9",
      [{ path: MANIFEST_PATH, status: "modified" }],
      new Map([[MANIFEST_PATH, foreign]]),
    );

    const out = await reconcilePublicRepo(store, packageId, { lastSyncedSha: "sha-1", reader });

    expect(out.status).toBe("absorbed");
    // The outcome carries the validated manifest — the web layer refreshes
    // the packages.manifest read cache from it (as after every updateManifest).
    expect(out.status === "absorbed" && out.manifest?.license).toBe("CC0-1.0");
    // The stored file went through the write path: validated + canonical form.
    const stored = (await store.readFile(packageId, "public", MANIFEST_PATH))!;
    expect(parseManifest(JSON.parse(stored)).license).toBe("CC0-1.0");
    expect(stored).toBe(serializeManifest(parseManifest(JSON.parse(foreign))));
  });

  it("[P5.B.3.e] a reconcile that does not touch alembic.json reports no manifest", async () => {
    const { store, packageId } = await seeded();
    const path = "study-guide/ch01.md";
    const reader = new FakeRepoReader("sha-9", [{ path, status: "added" }], new Map([[path, validStudyGuide()]]));
    const out = await reconcilePublicRepo(store, packageId, { lastSyncedSha: "sha-1", reader });
    expect(out.status).toBe("absorbed");
    expect(out.status === "absorbed" && out.manifest).toBeUndefined();
  });

  it("[P5.B.3.e] an invalid foreign alembic.json is quarantined: the stored manifest is kept and the problem reported", async () => {
    for (const bad of ["{ not json", JSON.stringify({ title: "no schema" })]) {
      const { store, packageId, raw } = await seeded();
      const other = "study-guide/ch01.md";
      const reader = new FakeRepoReader(
        "sha-9",
        [
          { path: other, status: "added" },
          { path: MANIFEST_PATH, status: "modified" },
        ],
        new Map([
          [other, validStudyGuide()],
          [MANIFEST_PATH, bad],
        ]),
      );
      const out = await reconcilePublicRepo(store, packageId, { lastSyncedSha: "sha-1", reader });
      expect(out.status).toBe("quarantined");
      expect(out.status === "quarantined" && out.violations.join("\n")).toContain(MANIFEST_PATH);
      expect(await store.readFile(packageId, "public", MANIFEST_PATH)).toBe(raw);
      expect(await store.readFile(packageId, "public", other)).toBeNull();
    }
  });

  it("[P5.B.3.e] a foreign removal of alembic.json is quarantined, never deleting the course details", async () => {
    const { store, packageId, raw } = await seeded();
    const reader = new FakeRepoReader("sha-9", [{ path: MANIFEST_PATH, status: "removed" }], new Map());
    const out = await reconcilePublicRepo(store, packageId, { lastSyncedSha: "sha-1", reader });
    expect(out.status).toBe("quarantined");
    expect(await store.readFile(packageId, "public", MANIFEST_PATH)).toBe(raw);
  });
});
