/**
 * Correctness loop r2 (round-2 audit, 2026-10-23) — the registry's identity
 * and write rules. Each describe names the finding; each test is a probe that
 * failed on the r2 security branch (e057bde) unless it says it pins kept
 * behaviour.
 */
import { describe, expect, it } from "vitest";
import {
  formatBlockMarker,
  newDocId,
  type RegistrationRecord,
  type RepoKind,
} from "@alembic/package-contract";
import { embedSource, extractSource } from "@alembic/carriers";
import {
  APPLY_CHUNK,
  MemoryDocumentRegistryStore,
  extractEmbeddedUid,
  keepOwnerSet,
  rebuildPackageRegistry,
  registerChangedFiles,
  type DocumentRegistryStore,
} from "./document-registry";
import { MemoryPackageStore } from "./memory-store";
import { writeThrough } from "./write-through";
import { forkPackage } from "./adaptation";
import type { PackageFile, PackageRecord, PackageStore } from "./store";

const PKG = "pkg-r2c-aaaaaaaa";
const rec = (packageId = PKG): PackageRecord => ({
  packageId,
  ownerId: "u",
  title: "X",
  manifest: {} as PackageRecord["manifest"],
  storage: "sandbox",
});
const carrier = (uid: string, body = "x") =>
  `<html><head><script type="application/orz-meta+json" id="orz-meta">{"title":"T","uid":"${uid}"}</script></head><body>${body}</body></html>`;

async function setup(files: PackageFile[] = []) {
  const registry = new MemoryDocumentRegistryStore();
  const store = new MemoryPackageStore(registry);
  await store.createPackage(rec(), files);
  await rebuildPackageRegistry(registry, store, PKG, "created");
  return { registry, store };
}
const save = (store: PackageStore, path: string, content: string | null) =>
  writeThrough(store, null, PKG, { summary: "s", changes: [{ repo: "public", path, content }] });
const at = async (r: DocumentRegistryStore, path: string) =>
  (await r.listLiveByPackage(PKG)).find((x) => x.path === path) ?? null;

describe("HIGH-A a dormant uid never displaces a live identity", () => {
  it("[P5.B.1.s] a copy keeps its own permalink after the original is deleted and the copy is saved (uidflip)", async () => {
    const U = "doc-aaaaaaaaaaaa";
    const { registry, store } = await setup([{ repo: "public", path: "practice/a.md.html", content: carrier(U, "orig") }]);
    await save(store, "practice/b.md.html", carrier(U, "copy")); // an upload of a copy
    const copyId = (await at(registry, "practice/b.md.html"))!.docId;
    expect(copyId).not.toBe(U);
    await save(store, "practice/a.md.html", null); // the original is deleted
    await save(store, "practice/b.md.html", carrier(U, "copy edited"));
    const all = await registry.listByPackage(PKG);
    expect(all.find((r) => r.docId === copyId)?.tombstoned).toBe(false); // was: 410
    expect((await at(registry, "practice/b.md.html"))!.docId).toBe(copyId);
    expect(all.find((r) => r.docId === U)?.tombstoned).toBe(true); // the original stays deleted
  });

  it("[P5.B.1.s] [P5.B.1.f] an unknown uid at an occupied location keeps the occupant", async () => {
    const { registry, store } = await setup([{ repo: "public", path: "assets/a.svg", content: "<svg>plain</svg>" }]);
    const old = (await at(registry, "assets/a.svg"))!;
    await save(store, "assets/a.svg", `<script type="application/orz-meta+json" id="orz-meta">{"uid":"doc-uidbatch0001"}</script><svg>doc</svg>`);
    expect((await at(registry, "assets/a.svg"))!.docId).toBe(old.docId);
    expect((await registry.listLiveByPackage(PKG))).toHaveLength(1);
  });

  it("[P5.B.1.s] a dormant uid does not override a hash-identified move (rename without a hint)", async () => {
    const U = "doc-bbbbbbbbbbbb";
    const { registry, store } = await setup([{ repo: "public", path: "practice/a.md.html", content: carrier(U, "orig") }]);
    await save(store, "practice/b.md.html", carrier(U, "copy"));
    const copyId = (await at(registry, "practice/b.md.html"))!.docId;
    await save(store, "practice/a.md.html", null);
    // the copy is renamed by a door that gives no movedFrom hint (an upload)
    const bytes = carrier(U, "copy");
    await store.deleteFiles(PKG, [{ repo: "public", path: "practice/b.md.html" }]);
    await store.putFiles(PKG, [{ repo: "public", path: "practice/c.md.html", content: bytes }]);
    await rebuildPackageRegistry(registry, store, PKG, "uploaded");
    expect((await at(registry, "practice/c.md.html"))!.docId).toBe(copyId);
  });

  it("[P5.B.1.s] kept: a deleted document uploaded again to a free location gets its permalink back", async () => {
    const U = "doc-cccccccccccc";
    const { registry, store } = await setup([{ repo: "public", path: "practice/a.md.html", content: carrier(U) }]);
    await save(store, "practice/a.md.html", null);
    await save(store, "practice/z.md.html", carrier(U, "back"));
    expect((await at(registry, "practice/z.md.html"))!.docId).toBe(U);
  });

  it("[P5.B.1.s] forkPackage re-mints the uid AND every block id of a study-guide .md.html carrier", () => {
    const uid = "doc-abcdefabcdef";
    const blk = "blk-aaaaaaaa1234";
    const source = `## Intro${formatBlockMarker(blk)}\n\ntext`;
    const file = embedSource({
      payload: "html",
      kind: "md",
      format: 1,
      source,
      rendered: `<!doctype html><html><head><script type="application/orz-meta+json" id="orz-meta">{"title":"T","uid":"${uid}"}</script></head><body><h2 id="${blk}">Intro</h2><p>see ${blk}1 too</p></body></html>`,
    });
    const forked = forkPackage({
      source: {
        packageId: "pkg-src-aaaaaaaa",
        manifest: { schemaVersion: 2, packageId: "pkg-src-aaaaaaaa", title: "Src", license: "CC-BY-4.0" } as never,
        publicFiles: [{ repo: "public", path: "study-guide/ch1.md.html", content: file }],
      },
      target: { ownerId: "b", license: "CC-BY-4.0" },
      attribution: "x",
    });
    const copy = forked.files.find((f) => f.path === "study-guide/ch1.md.html")!;
    const newUid = extractEmbeddedUid(copy.content);
    expect(newUid).not.toBeNull();
    expect(newUid).not.toBe(uid);
    expect(copy.content).not.toMatch(new RegExp(`${blk}(?![a-z0-9])`)); // gone from source AND rendered HTML
    expect(copy.content).toContain(`${blk}1`); // a longer id is not touched
    const fresh = forked.lineage[0]!.targetBlockId;
    expect(forked.lineage[0]!.sourceBlockId).toBe(blk);
    expect(extractSource(copy.content).source).toContain(formatBlockMarker(fresh));
    expect(copy.content).toContain(`id="${fresh}"`);
  });
});

describe("MEDIUM-1 a registration run keeps what the owner set meanwhile", () => {
  it("[P5.B.1.t] an owner's share committed between the run's read and its write survives (sharerace)", async () => {
    class Racy extends MemoryDocumentRegistryStore {
      hook: null | (() => Promise<void>) = null;
      override async apply(p: string, c: { tombstones: string[]; upserts: RegistrationRecord[] }) {
        if (this.hook) {
          const h = this.hook;
          this.hook = null;
          await h();
        }
        return super.apply(p, c);
      }
    }
    const registry = new Racy();
    const store = new MemoryPackageStore(registry);
    await store.createPackage(rec(), [{ repo: "public", path: "assets/fig.svg", content: "<svg>1</svg>" }]);
    await rebuildPackageRegistry(registry, store, PKG, "created");
    const r0 = (await registry.listLiveByPackage(PKG))[0]!;
    registry.hook = () =>
      registry.upsert({ ...r0, discoverable: true, description: "Titration curve", tags: ["acid"], altText: "a curve", license: "CC0-1.0" });
    await save(store, "assets/fig.svg", "<svg>2</svg>");
    const r1 = (await registry.listLiveByPackage(PKG))[0]!;
    expect(r1).toMatchObject({ docId: r0.docId, discoverable: true, description: "Titration curve", tags: ["acid"], altText: "a curve", license: "CC0-1.0" });
    expect(r1.sourceHash).not.toBe(r0.sourceHash); // the save itself landed
  });

  it("[P5.B.1.t] a resurrected (tombstoned) row takes the run's values; lineage fills only a missing value", () => {
    const base: RegistrationRecord = {
      docId: "doc-dddddddddddd", packageId: PKG, repo: "public", path: "assets/a.svg", space: "assets",
      kind: "svg", formatVersion: 0, origin: "created", registeredAt: "2026-01-01T00:00:00.000Z",
      tags: ["old"], discoverable: true, description: "old", permalinkClass: "object", tombstoned: false,
      adaptedFrom: "doc-srcsrcsrcsrc",
    };
    const incoming: RegistrationRecord = { ...base, tags: [], discoverable: false, description: undefined, adaptedFrom: "doc-otherotherot", registeredAt: "2026-10-23T00:00:00.000Z" };
    delete (incoming as Partial<RegistrationRecord>).description;
    expect(keepOwnerSet(base, incoming)).toMatchObject({ tags: ["old"], discoverable: true, description: "old", adaptedFrom: "doc-srcsrcsrcsrc", registeredAt: base.registeredAt });
    const revived = keepOwnerSet({ ...base, tombstoned: true }, incoming);
    expect(revived).toEqual(incoming);
  });
});

/** Registry that bills round-trips the way the Supabase store does (one per
 *  call; a live-row read is one per 1,000-row page) and records apply sizes. */
class Billing implements DocumentRegistryStore {
  trips = 0;
  applies: Array<{ tombstones: number; upserts: number }> = [];
  failIf: ((c: { tombstones: string[]; upserts: RegistrationRecord[] }) => boolean) | null = null;
  readonly inner = new MemoryDocumentRegistryStore();
  async upsert(r: RegistrationRecord) { this.trips++; return this.inner.upsert(r); }
  async upsertMany(rs: RegistrationRecord[]) { this.trips++; return this.inner.upsertMany(rs); }
  async tombstone(p: string, d: string) { this.trips++; return this.inner.tombstone(p, d); }
  async tombstoneMany(p: string, ds: string[]) { this.trips++; return this.inner.tombstoneMany(p, ds); }
  async getByLocation(p: string, r: RepoKind, path: string) { this.trips++; return this.inner.getByLocation(p, r, path); }
  async getByContentHash(p: string, h: string) { this.trips++; return this.inner.getByContentHash(p, h); }
  async getByDocId(p: string, d: string) { this.trips++; return this.inner.getByDocId(p, d); }
  async listByPackage(p: string) { const o = await this.inner.listByPackage(p); this.trips += Math.max(1, Math.ceil(o.length / 1000)); return o; }
  async listLiveByPackage(p: string) { const o = await this.inner.listLiveByPackage(p); this.trips += Math.max(1, Math.ceil(o.length / 1000)); return o; }
  async foreignDocIds(p: string, ids: string[]) { this.trips += Math.ceil(ids.length / 500); return this.inner.foreignDocIds(p, ids); }
  async apply(p: string, c: { tombstones: string[]; upserts: RegistrationRecord[] }) {
    this.trips++;
    this.applies.push({ tombstones: c.tombstones.length, upserts: c.upserts.length });
    if (this.failIf?.(c)) throw new Error("canceling statement due to statement timeout");
    return this.inner.apply(p, c);
  }
}

function bigPackage(n: number): PackageFile[] {
  return Array.from({ length: n }, (_, i) => ({ repo: "public" as const, path: `assets/f${i}.svg`, content: `<svg>${i}</svg>` }));
}

describe("MEDIUM-3 a large registration is chunked; a refused chunk is split, not replayed row by row", () => {
  it("[P5.B.1.u] the first registration of 3,000 files writes ≤ 500 rows per call (6 calls)", async () => {
    const registry = new Billing();
    const store = new MemoryPackageStore();
    await store.createPackage(rec(), bigPackage(3000));
    await rebuildPackageRegistry(registry, store, PKG, "uploaded");
    expect(registry.applies.length).toBe(Math.ceil(3000 / APPLY_CHUNK));
    expect(Math.max(...registry.applies.map((a) => a.upserts + a.tombstones))).toBeLessThanOrEqual(APPLY_CHUNK);
    expect(await registry.inner.listLiveByPackage(PKG)).toHaveLength(3000);
  });

  it("[P5.B.1.u] one refused row among 3,000 costs a binary split (≤ 6 + 2·⌈log2 500⌉ calls), everything else lands (fallback)", async () => {
    const registry = new Billing();
    const store = new MemoryPackageStore();
    await store.createPackage(rec(), bigPackage(3000));
    registry.failIf = (c) => c.upserts.some((r) => r.path === "assets/f1234.svg");
    await rebuildPackageRegistry(registry, store, PKG, "uploaded");
    const live = await registry.inner.listLiveByPackage(PKG);
    expect(live).toHaveLength(2999);
    // first pass: 6 chunks + 2 per level of the split (9 levels), then one retry round of the bad row
    expect(registry.applies.length).toBeLessThanOrEqual(6 + 2 * Math.ceil(Math.log2(APPLY_CHUNK)) + 1);
    console.info(`[r2c] 3,000-file registration with one refused row: ${registry.applies.length} apply calls (was 3,000+ serial)`);
  });

  it("[P5.B.1.u] a chunk carries exactly the tombstones its rows displaced (no identity retired without its replacement)", async () => {
    const registry = new Billing();
    const store = new MemoryPackageStore(registry);
    const N = 600;
    const uid = (i: number) => `doc-u${String(i).padStart(11, "0")}`;
    await store.createPackage(rec(), [
      ...Array.from({ length: N }, (_, i) => ({ repo: "public" as const, path: `practice/a${i}.md.html`, content: carrier(uid(i), `a${i}`) })),
      ...Array.from({ length: N }, (_, i) => ({ repo: "public" as const, path: `assets/b${i}.svg`, content: `<svg>${i}</svg>` })),
    ]);
    await rebuildPackageRegistry(registry, store, PKG, "uploaded");
    const plainId = new Map((await registry.inner.listLiveByPackage(PKG)).filter((r) => r.path.startsWith("assets/")).map((r) => [r.path, r.docId]));
    registry.applies = [];
    registry.failIf = (c) => c.upserts.some((r) => r.path === "assets/b300.svg");
    // every document moves onto a plain file's location (its uid travels, the plain identity is displaced)
    const changes = Array.from({ length: N }, (_, i) => [
      { repo: "public" as const, path: `practice/a${i}.md.html`, content: null },
      { repo: "public" as const, path: `assets/b${i}.svg`, content: carrier(uid(i), `a${i}`) },
    ]).flat();
    await writeThrough(store, null, PKG, { summary: "s", changes });
    for (const a of registry.applies) expect(a.tombstones).toBe(a.upserts); // each chunk: its own displaced identities
    expect(Math.max(...registry.applies.map((a) => a.upserts))).toBeLessThanOrEqual(APPLY_CHUNK);
    const all = await registry.inner.listByPackage(PKG);
    const byId = new Map(all.map((r) => [r.docId, r]));
    expect(byId.get(uid(5))).toMatchObject({ path: "assets/b5.svg", tombstoned: false });
    expect(byId.get(plainId.get("assets/b5.svg")!)!.tombstoned).toBe(true);
    // the refused row: its location's identity was NOT retired
    expect(byId.get(plainId.get("assets/b300.svg")!)!.tombstoned).toBe(false);
  });
});

describe("L-1 the page-load heal reads its files with bounded parallelism", () => {
  it("[P5.B.1.v] 50 stale files are read with at most 8 reads in flight, not one after another", async () => {
    const { registry, store } = await setup(bigPackage(60));
    let inFlight = 0;
    let peak = 0;
    const slow: PackageStore = Object.create(store);
    slow.readFile = async (p, r, path) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((res) => setTimeout(res, 5));
      inFlight--;
      return store.readFile(p, r, path);
    };
    const changes = bigPackage(50).map((f) => ({ repo: f.repo, path: f.path }));
    const out = await registerChangedFiles(registry, slow, PKG, changes);
    expect(out).toHaveLength(50);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
  });
});

describe("L-2 round-trips are 1 + ⌈live/1000⌉ (+1 for a new uid)", () => {
  it("[P5.B.1.a] [P5.B.1.e] a one-file save on a 3,000-file package costs 1 + ⌈3000/1000⌉ registry round-trips; a new uid one more", async () => {
    const registry = new Billing();
    const store = new MemoryPackageStore(registry);
    await store.createPackage(rec(), bigPackage(3000));
    await rebuildPackageRegistry(registry, store, PKG, "uploaded");
    registry.trips = 0;
    await save(store, "assets/f17.svg", "<svg>edited</svg>");
    expect(registry.trips).toBe(1 + Math.ceil(3000 / 1000));
    registry.trips = 0;
    await save(store, "practice/new.md.html", carrier(newDocId(), "new"));
    expect(registry.trips).toBe(1 + Math.ceil(3000 / 1000) + 1); // live rows before the save: 3,000
  });
});

describe("HIGH-A sibling: every forked study guide is its own document", () => {
  it("[P5.B.1.s] a study guide the carrier reader does not recognise still gets a fresh uid, and cross-chapter block references follow the new ids (forksg)", () => {
    const uid = "doc-abcdefabcdef";
    const b1 = "blk-chapterone01";
    const ch1 = `<!doctype html><html><head><script type="application/orz-meta+json" id="orz-meta">{"title":"T","uid":"${uid}"}</script></head><body><script type="text/markdown" id="orz-source">\n## Intro${formatBlockMarker(b1)}\n\ntext</script></body></html>`;
    const ch2 = `## See also${formatBlockMarker("blk-chaptertwo02")}\n\nCompare [the intro](#${b1}).`;
    const forked = forkPackage({
      source: {
        packageId: "pkg-src-aaaaaaaa",
        manifest: { schemaVersion: 2, packageId: "pkg-src-aaaaaaaa", title: "Src", license: "CC-BY-4.0" } as never,
        publicFiles: [
          { repo: "public", path: "study-guide/ch1.md.html", content: ch1 },
          { repo: "public", path: "study-guide/ch2.md", content: ch2 },
        ],
      },
      target: { ownerId: "b", license: "CC-BY-4.0" },
      attribution: "x",
    });
    const c1 = forked.files.find((f) => f.path === "study-guide/ch1.md.html")!.content;
    const c2 = forked.files.find((f) => f.path === "study-guide/ch2.md")!.content;
    expect(extractEmbeddedUid(c1)).not.toBe(uid);
    expect(extractEmbeddedUid(c1)).not.toBeNull();
    const fresh = forked.lineage.find((l) => l.sourceBlockId === b1)!.targetBlockId;
    expect(c1).toContain(fresh);
    expect(c2).toContain(`(#${fresh})`);
    expect(c1 + c2).not.toMatch(new RegExp(`${b1}(?![a-z0-9])`));
  });
});
