/**
 * Batched registration (Track B.1; scale audit 2026-08-28, queued item 1).
 *
 * Two kinds of proof here:
 *  - SEMANTICS: the incremental path and the bulk rebuild keep the identity
 *    ladder (uid → content hash → location), apply the duplicate-content
 *    tiebreaker (contract v2 §2), and tombstone (never delete) removed files;
 *  - COST: round-trips per write on a 333-file package (the owner's real
 *    course size), counted against a store that charges one round-trip per
 *    call and one per 1000-row page — the shape of the Supabase store.
 */
import { describe, expect, it } from "vitest";
import type { RegistrationRecord, RepoKind } from "@alembic/package-contract";
import {
  MemoryDocumentRegistryStore,
  isRegistrableLocation,
  rebuildPackageRegistry,
  registerChangedFiles,
  type DocumentRegistryStore,
} from "./document-registry";
import { MemoryPackageStore } from "./memory-store";
import type { PackageFile, PackageRecord, PackageStore } from "./store";

const PKG = "pkg-batch-abc123";
const PAGE = 1000;
const pages = (n: number) => Math.max(1, Math.ceil(n / PAGE));

/** Registry store that counts round-trips the way PostgREST would bill them. */
class CountingRegistry implements DocumentRegistryStore {
  trips = 0;
  readonly inner = new MemoryDocumentRegistryStore();
  async upsert(r: RegistrationRecord) { this.trips++; return this.inner.upsert(r); }
  async upsertMany(rs: RegistrationRecord[]) { this.trips += Math.ceil(rs.length / 500); return this.inner.upsertMany(rs); }
  async tombstone(p: string, d: string) { this.trips++; return this.inner.tombstone(p, d); }
  async tombstoneMany(p: string, ds: string[]) { this.trips += Math.ceil(ds.length / 200); return this.inner.tombstoneMany(p, ds); }
  async getByLocation(p: string, r: RepoKind, path: string) { this.trips++; return this.inner.getByLocation(p, r, path); }
  async getByContentHash(p: string, h: string) { this.trips++; return this.inner.getByContentHash(p, h); }
  async getByDocId(p: string, d: string) { this.trips++; return this.inner.getByDocId(p, d); }
  async listByPackage(p: string) { const out = await this.inner.listByPackage(p); this.trips += pages(out.length); return out; }
  async listLiveByPackage(p: string) { const out = await this.inner.listLiveByPackage(p); this.trips += pages(out.length); return out; }
  async foreignDocIds(p: string, ids: string[]) { this.trips++; return this.inner.foreignDocIds(p, ids); }
  async apply(p: string, c: { tombstones: string[]; upserts: RegistrationRecord[] }) { this.trips++; return this.inner.apply(p, c); }
}

/** Package store that counts round-trips and bytes read. */
class CountingPackageStore implements PackageStore {
  trips = 0;
  bytesRead = 0;
  readonly inner = new MemoryPackageStore();
  createPackage(r: PackageRecord, f: PackageFile[]) { return this.inner.createPackage(r, f); }
  getPackage(p: string) { this.trips++; return this.inner.getPackage(p); }
  async listFiles(p: string) {
    const out = await this.inner.listFiles(p);
    this.trips += pages(out.length);
    this.bytesRead += out.reduce((n, f) => n + f.content.length, 0);
    return out;
  }
  async listPaths(p: string) { const out = await this.inner.listPaths(p); this.trips += pages(out.length); return out; }
  async readFile(p: string, r: RepoKind, path: string) {
    this.trips++;
    const c = await this.inner.readFile(p, r, path);
    this.bytesRead += c?.length ?? 0;
    return c;
  }
  putFiles(p: string, f: PackageFile[]) { return this.inner.putFiles(p, f); }
  deleteFiles(p: string, f: { repo: RepoKind; path: string }[]) { return this.inner.deleteFiles(p, f); }
  replaceFileIf(p: string, f: PackageFile, e: { content: string } | null) { return this.inner.replaceFileIf(p, f, e); }
}

const RECORD: PackageRecord = {
  packageId: PKG,
  ownerId: "owner-1",
  title: "General Chemistry",
  manifest: {} as PackageRecord["manifest"],
  storage: "sandbox",
};

/** A 333-file course: 19 chapters of study guides + slides, the rest figures. */
function course(): PackageFile[] {
  const files: PackageFile[] = [];
  for (let c = 1; c <= 19; c++) {
    files.push({ repo: "public", path: `study-guide/ch${c}.md`, content: `# Chapter ${c}\n\n${"text ".repeat(400)}` });
    files.push({ repo: "public", path: `slides/ch${c}.md`, content: `# Slides ${c}` });
  }
  files.push({ repo: "private", path: "private/notes/answers.md", content: "secret answers" });
  for (let i = files.length; i < 333; i++) {
    files.push({ repo: "public", path: `assets/fig${i}.svg`, content: `<svg id="${i}">${"x".repeat(2000)}</svg>` });
  }
  return files;
}

async function seeded(files = course()) {
  const registry = new CountingRegistry();
  const packageStore = new CountingPackageStore();
  await packageStore.createPackage(RECORD, files);
  await rebuildPackageRegistry(registry, packageStore, PKG);
  registry.trips = 0;
  packageStore.trips = 0;
  packageStore.bytesRead = 0;
  return { registry, packageStore };
}

const live = async (r: DocumentRegistryStore) =>
  (await r.listByPackage(PKG)).filter((x) => !x.tombstoned);

describe("cost — round-trips per write on a 333-file package", () => {
  it("[P5.B.1.a] one-file save: ≤ 3 round-trips and no whole-package read (was ~668)", async () => {
    const { registry, packageStore } = await seeded();
    const path = "study-guide/ch3.md";
    const content = "# Chapter 3\n\nEdited.";
    await packageStore.putFiles(PKG, [{ repo: "public", path, content }]);
    const before = (await registry.inner.getByLocation(PKG, "public", path))!;

    await registerChangedFiles(registry, packageStore, PKG, [{ repo: "public", path, content }]);

    const trips = registry.trips + packageStore.trips;
    expect(trips).toBeLessThanOrEqual(3);
    expect(packageStore.bytesRead).toBe(0);
    const after = (await registry.inner.getByLocation(PKG, "public", path))!;
    expect(after.docId).toBe(before.docId);
    // The measured numbers, for the Status/DecisionLog record.
    console.info(`[B.1] one-file save on 333 files: ${trips} round-trips (registry ${registry.trips}, files ${packageStore.trips})`);
  });

  it("[P5.B.1.b] rename: ≤ 4 round-trips, identity carried, old location retired", async () => {
    const { registry, packageStore } = await seeded();
    const from = "assets/fig100.svg";
    const to = "assets/renamed/fig100.svg";
    const content = (await packageStore.inner.readFile(PKG, "public", from))!;
    const before = (await registry.inner.getByLocation(PKG, "public", from))!;
    await packageStore.putFiles(PKG, [{ repo: "public", path: to, content }]);
    await packageStore.deleteFiles(PKG, [{ repo: "public", path: from }]);

    await registerChangedFiles(registry, packageStore, PKG, [
      { repo: "public", path: to, content },
      { repo: "public", path: from, content: null },
    ]);

    expect(registry.trips + packageStore.trips).toBeLessThanOrEqual(4);
    const moved = (await registry.inner.getByLocation(PKG, "public", to))!;
    expect(moved.docId).toBe(before.docId);
    expect(await registry.inner.getByLocation(PKG, "public", from)).toBeNull();
    // Not tombstoned: the identity moved, it did not die.
    expect((await registry.inner.getByDocId(PKG, before.docId))?.tombstoned).toBe(false);
  });

  it("[P5.B.1.c] rebuild of an unchanged package writes nothing (one read of files + one of rows)", async () => {
    const { registry, packageStore } = await seeded();
    await rebuildPackageRegistry(registry, packageStore, PKG);
    expect(registry.trips).toBe(1); // listLiveByPackage; zero writes
    expect(packageStore.trips).toBe(1); // listFiles — the read stays full
    console.info(`[B.1] steady-state rebuild on 333 files: ${registry.trips + packageStore.trips} round-trips`);
  });

  it("[P5.B.1.d] first registration of 333 files is one bulk write, not one per file", async () => {
    const registry = new CountingRegistry();
    const packageStore = new CountingPackageStore();
    await packageStore.createPackage(RECORD, course());
    const records = await rebuildPackageRegistry(registry, packageStore, PKG);
    expect(records).toHaveLength(333);
    expect(registry.trips).toBe(2); // listLiveByPackage + one upsertMany (≤500 rows)
    console.info(`[B.1] first registration of 333 files: ${registry.trips + packageStore.trips} round-trips`);
  });

  it("[P5.B.1.e] tombstones do not ride along on the write path", async () => {
    const { registry, packageStore } = await seeded();
    // Churn: 1500 historical tombstones (beyond one PostgREST page).
    for (let i = 0; i < 1500; i++) {
      await registry.inner.upsert({
        ...(await live(registry.inner))[0]!,
        docId: `doc-tomb${String(i).padStart(8, "0")}`,
        path: `assets/old/${i}.svg`,
        tombstoned: true,
      });
    }
    registry.trips = 0;
    await registerChangedFiles(registry, packageStore, PKG, [
      { repo: "public", path: "assets/fig50.svg", content: "<svg>new</svg>" },
    ]);
    expect(registry.trips).toBe(2); // one page of live rows + one write
  });
});

describe("semantics — identity ladder and tiebreaker", () => {
  it("[P5.B.1.g] byte-identical duplicates get distinct docIds and stay stable across rebuilds", async () => {
    const registry = new MemoryDocumentRegistryStore();
    const packageStore = new MemoryPackageStore();
    await packageStore.createPackage(RECORD, [
      { repo: "public", path: "assets/a.svg", content: "<svg>same</svg>" },
      { repo: "public", path: "assets/b.svg", content: "<svg>same</svg>" },
    ]);
    await rebuildPackageRegistry(registry, packageStore, PKG);
    const a1 = (await registry.getByLocation(PKG, "public", "assets/a.svg"))!;
    const b1 = (await registry.getByLocation(PKG, "public", "assets/b.svg"))!;
    expect(a1.docId).not.toBe(b1.docId);

    await rebuildPackageRegistry(registry, packageStore, PKG);
    expect((await registry.getByLocation(PKG, "public", "assets/a.svg"))!.docId).toBe(a1.docId);
    expect((await registry.getByLocation(PKG, "public", "assets/b.svg"))!.docId).toBe(b1.docId);
    expect(await live(registry)).toHaveLength(2);
  });

  it("[P5.B.1.g] uploading a duplicate of an existing file mints a new identity (incremental)", async () => {
    const registry = new MemoryDocumentRegistryStore();
    const packageStore = new MemoryPackageStore();
    await packageStore.createPackage(RECORD, [
      { repo: "public", path: "assets/a.svg", content: "<svg>same</svg>" },
    ]);
    await rebuildPackageRegistry(registry, packageStore, PKG);
    const a = (await registry.getByLocation(PKG, "public", "assets/a.svg"))!;
    await packageStore.putFiles(PKG, [{ repo: "public", path: "assets/copy.svg", content: "<svg>same</svg>" }]);
    await registerChangedFiles(registry, packageStore, PKG, [
      { repo: "public", path: "assets/copy.svg", content: "<svg>same</svg>" },
    ]);
    const copy = (await registry.getByLocation(PKG, "public", "assets/copy.svg"))!;
    expect(copy.docId).not.toBe(a.docId);
    // The original keeps its identity AND its location.
    expect((await registry.getByLocation(PKG, "public", "assets/a.svg"))!.docId).toBe(a.docId);
  });

  it("[P5.B.1.g] an edit that makes a file identical to another keeps its own identity", async () => {
    const registry = new MemoryDocumentRegistryStore();
    const packageStore = new MemoryPackageStore();
    await packageStore.createPackage(RECORD, [
      { repo: "public", path: "assets/a.svg", content: "<svg>A</svg>" },
      { repo: "public", path: "assets/b.svg", content: "<svg>B</svg>" },
    ]);
    await rebuildPackageRegistry(registry, packageStore, PKG);
    const a = (await registry.getByLocation(PKG, "public", "assets/a.svg"))!;
    const b = (await registry.getByLocation(PKG, "public", "assets/b.svg"))!;
    await packageStore.putFiles(PKG, [{ repo: "public", path: "assets/b.svg", content: "<svg>A</svg>" }]);
    await registerChangedFiles(registry, packageStore, PKG, [
      { repo: "public", path: "assets/b.svg", content: "<svg>A</svg>" },
    ]);
    expect((await registry.getByLocation(PKG, "public", "assets/b.svg"))!.docId).toBe(b.docId);
    expect((await registry.getByLocation(PKG, "public", "assets/a.svg"))!.docId).toBe(a.docId);
  });

  it("[P5.B.1.h] a deleted file is tombstoned (410), not removed, and its docId is never reused", async () => {
    const { registry, packageStore } = await seeded();
    const path = "assets/fig200.svg";
    const gone = (await registry.inner.getByLocation(PKG, "public", path))!;
    await packageStore.deleteFiles(PKG, [{ repo: "public", path }]);
    await registerChangedFiles(registry, packageStore, PKG, [{ repo: "public", path, content: null }]);
    const all = await registry.inner.listByPackage(PKG);
    expect(all.find((r) => r.docId === gone.docId)?.tombstoned).toBe(true);
    // A new file at the same path is a new identity.
    await packageStore.putFiles(PKG, [{ repo: "public", path, content: "<svg>other</svg>" }]);
    await registerChangedFiles(registry, packageStore, PKG, [{ repo: "public", path }]);
    const fresh = (await registry.inner.getByLocation(PKG, "public", path))!;
    expect(fresh.docId).not.toBe(gone.docId);
  });

  it("[P5.B.1.f] a live embedded uid outranks hash and location, and displaces the location's old identity", async () => {
    const withUid = (uid: string, body: string) =>
      `<script type="application/orz-meta+json" id="orz-meta">${JSON.stringify({ uid })}</script>${body}`;
    const registry = new MemoryDocumentRegistryStore();
    const packageStore = new MemoryPackageStore();
    // loop r2c (P5.B.1.s): only one of THIS package's live identities may
    // displace; an unknown (dormant) uid keeps the occupant — see
    // document-registry.r2c.test.ts.
    const doc = withUid("doc-uidbatch0001", "<svg>doc</svg>");
    await packageStore.createPackage(RECORD, [
      { repo: "public", path: "assets/a.svg", content: "<svg>plain</svg>" },
      { repo: "public", path: "assets/doc.svg", content: doc },
    ]);
    await rebuildPackageRegistry(registry, packageStore, PKG);
    const old = (await registry.getByLocation(PKG, "public", "assets/a.svg"))!;
    expect((await registry.getByLocation(PKG, "public", "assets/doc.svg"))!.docId).toBe("doc-uidbatch0001");
    // the document is moved onto a.svg (no hint): its uid travels and wins
    await packageStore.deleteFiles(PKG, [{ repo: "public", path: "assets/doc.svg" }]);
    await packageStore.putFiles(PKG, [{ repo: "public", path: "assets/a.svg", content: doc + " " }]);
    await registerChangedFiles(registry, packageStore, PKG, [
      { repo: "public", path: "assets/a.svg", content: doc + " " },
      { repo: "public", path: "assets/doc.svg", content: null },
    ]);
    const now = (await registry.getByLocation(PKG, "public", "assets/a.svg"))!;
    expect(now.docId).toBe("doc-uidbatch0001");
    const all = await registry.listByPackage(PKG);
    expect(all.find((r) => r.docId === old.docId)?.tombstoned).toBe(true);
    expect(await live(registry)).toHaveLength(1);
  });

  it("[P5.B.1.j] owner-set fields survive an incremental re-registration", async () => {
    const { registry, packageStore } = await seeded();
    const path = "assets/fig120.svg";
    const rec = (await registry.inner.getByLocation(PKG, "public", path))!;
    await registry.inner.upsert({ ...rec, discoverable: true, description: "A figure", tags: ["acid"] });
    await registerChangedFiles(registry, packageStore, PKG, [{ repo: "public", path, content: "<svg>v2</svg>" }]);
    const after = (await registry.inner.getByLocation(PKG, "public", path))!;
    expect(after).toMatchObject({ docId: rec.docId, discoverable: true, description: "A figure", tags: ["acid"] });
  });

  it("[P5.B.1.j] private files register in the private space and never become discoverable", async () => {
    const { registry, packageStore } = await seeded();
    await registerChangedFiles(registry, packageStore, PKG, [
      { repo: "private", path: "private/notes/answers.md", content: "updated secret" },
    ]);
    const rec = (await registry.inner.getByLocation(PKG, "private", "private/notes/answers.md"))!;
    expect(rec.space).toBe("private");
    expect(rec.discoverable).toBe(false);
  });

  it("[P5.B.1.j] a public-space path claimed for the private repo is refused (two-repo, fail-closed)", async () => {
    const { registry, packageStore } = await seeded();
    const out = await registerChangedFiles(registry, packageStore, PKG, [
      { repo: "private", path: "study-guide/leak.md", content: "x" },
    ]);
    expect(out).toHaveLength(0);
    expect(await registry.inner.getByLocation(PKG, "private", "study-guide/leak.md")).toBeNull();
    expect(isRegistrableLocation("private", "study-guide/leak.md")).toBe(false);
    expect(isRegistrableLocation("public", "private/notes/x.md")).toBe(false);
    expect(isRegistrableLocation("private", "private/notes/x.md")).toBe(true);
  });

  it("[P5.B.1.i] incremental and full rebuild agree on the resulting registry", async () => {
    const files = course();
    const a = await seeded(files);
    const b = await seeded(files);
    const edits: PackageFile[] = [
      { repo: "public", path: "assets/fig40.svg", content: "<svg>edited</svg>" },
      { repo: "public", path: "assets/new.svg", content: "<svg>new</svg>" },
    ];
    for (const s of [a, b]) {
      await s.packageStore.putFiles(PKG, edits);
      await s.packageStore.deleteFiles(PKG, [{ repo: "public", path: "assets/fig41.svg" }]);
    }
    await registerChangedFiles(a.registry, a.packageStore, PKG, [
      ...edits,
      { repo: "public", path: "assets/fig41.svg", content: null },
    ]);
    await rebuildPackageRegistry(b.registry, b.packageStore, PKG);
    const shape = async (r: CountingRegistry) =>
      (await r.inner.listByPackage(PKG))
        .map((x) => `${x.repo} ${x.path} ${x.sourceHash} ${x.tombstoned}`)
        .sort();
    // docIds of new files differ by construction; everything else must match.
    expect(await shape(a.registry)).toEqual(await shape(b.registry));
  });
});

describe("flush resilience", () => {
  it("[P5.B.1.k] falls back to per-row writes when the bulk write is refused", async () => {
    const registry = new MemoryDocumentRegistryStore();
    const apply = registry.apply.bind(registry);
    registry.apply = async (p, c) => {
      if (c.upserts.length > 1) throw new Error("location index tripped mid-statement");
      return apply(p, c);
    };
    const packageStore = new MemoryPackageStore();
    await packageStore.createPackage(RECORD, [
      { repo: "public", path: "assets/a.svg", content: "<svg>a</svg>" },
      { repo: "public", path: "assets/b.svg", content: "<svg>b</svg>" },
    ]);
    const records = await rebuildPackageRegistry(registry, packageStore, PKG);
    expect(records).toHaveLength(2);
    expect(await live(registry)).toHaveLength(2);
  });
});
