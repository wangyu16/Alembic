/**
 * Correctness loop r3 (round-3 audit, 2026-10-24) — H3-1: every uid's
 * permalink follows its bytes under any shift, swap or cycle in one run
 * (P5.B.1.x). Each test failed on main (edc0d06) unless it says it pins kept
 * behaviour (repros /tmp/p5r3/shift.mts, swap.mts).
 */
import { describe, expect, it } from "vitest";
import type { RegistrationRecord } from "@alembic/package-contract";
import {
  APPLY_CHUNK,
  MemoryDocumentRegistryStore,
  extractEmbeddedUid,
  rebuildPackageRegistry,
  registerChangedFiles,
  registryDrift,
  type DocumentRegistryStore,
} from "./document-registry";
import { MemoryPackageStore } from "./memory-store";
import { writeThrough } from "./write-through";
import type { PackageFile, PackageRecord, PackageStore } from "./store";

const PKG = "pkg-r3c-aaaaaaaa";
const rec = (): PackageRecord => ({
  packageId: PKG,
  ownerId: "u",
  title: "X",
  manifest: {} as PackageRecord["manifest"],
  storage: "sandbox",
});
const carrier = (uid: string | null, body: string) =>
  `<html><head><script type="application/orz-meta+json" id="orz-meta">{"title":"T"${uid ? `,"uid":"${uid}"` : ""}}</script></head><body>${body}</body></html>`;
const uidN = (n: number) => `doc-${String(n).padStart(12, "u")}`;

/**
 * A registry that refuses an apply the way documents_apply's location index
 * does when a row lands on a location still held by a live row that is
 * neither tombstoned nor moved in the SAME call. (The in-memory store checks
 * only the final state, so it cannot see a chain split across calls.)
 */
class StrictLocationRegistry extends MemoryDocumentRegistryStore {
  calls: Array<{ upserts: number; tombstones: number }> = [];
  override async apply(packageId: string, change: { tombstones: string[]; upserts: RegistrationRecord[] }) {
    this.calls.push({ upserts: change.upserts.length, tombstones: change.tombstones.length });
    const live = await this.listLiveByPackage(packageId);
    const moving = new Set([...change.tombstones, ...change.upserts.map((u) => u.docId)]);
    for (const u of change.upserts) {
      const occupant = live.find((r) => r.repo === u.repo && r.path === u.path && r.docId !== u.docId);
      if (occupant && !moving.has(occupant.docId)) {
        throw new Error(`duplicate key value violates unique constraint "documents_location_idx" (${u.path})`);
      }
    }
    return super.apply(packageId, change);
  }
}

async function setup(files: PackageFile[], registry: MemoryDocumentRegistryStore = new MemoryDocumentRegistryStore()) {
  const store = new MemoryPackageStore(registry);
  await store.createPackage(rec(), files);
  await rebuildPackageRegistry(registry, store, PKG, "created");
  return { registry, store };
}

/** Every live row whose file carries a uid that is a live identity serves its own bytes. */
async function expectUidsFollowBytes(registry: DocumentRegistryStore, store: PackageStore, uids: Set<string>) {
  const live = await registry.listLiveByPackage(PKG);
  const byId = new Map(live.map((r) => [r.docId, r] as const));
  const files = await store.listFiles(PKG);
  for (const f of files) {
    const uid = extractEmbeddedUid(f.content);
    if (!uid || !uids.has(uid)) continue;
    const row = byId.get(uid);
    expect(row, `${uid} is live`).toBeDefined();
    expect(`${row!.repo} ${row!.path}`, `${uid} follows its bytes`).toBe(`${f.repo} ${f.path}`);
  }
  // one live identity per location, and every live row has its file
  const locs = new Set(files.map((f) => `${f.repo} ${f.path}`));
  for (const r of live) expect(locs.has(`${r.repo} ${r.path}`), `${r.docId} @ ${r.path} has a file`).toBe(true);
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("H3-1 every uid's permalink follows its bytes under any shift, swap or cycle in one run", () => {
  it("[P5.B.1.x] inserting a chapter renumbers the rest: each carrier keeps its uid at its new path (shift)", async () => {
    const [W, X, Y] = [uidN(1), uidN(2), uidN(3)];
    const { registry, store } = await setup([
      { repo: "public", path: "study-guide/ch1.md.html", content: carrier(W, "ONE") },
      { repo: "public", path: "study-guide/ch2.md.html", content: carrier(X, "TWO-acids") },
      { repo: "public", path: "study-guide/ch3.md.html", content: carrier(Y, "THREE-bases") },
    ]);
    await writeThrough(store, null, PKG, {
      summary: "insert a chapter",
      changes: [
        { repo: "public", path: "study-guide/ch2.md.html", content: carrier(null, "NEW-buffers") },
        { repo: "public", path: "study-guide/ch3.md.html", content: carrier(X, "TWO-acids") },
        { repo: "public", path: "study-guide/ch4.md.html", content: carrier(Y, "THREE-bases") },
      ],
    });
    const live = await registry.listLiveByPackage(PKG);
    const at = (p: string) => live.find((r) => r.path === p)?.docId;
    expect(at("study-guide/ch3.md.html")).toBe(X); // was: Y (ch3 served X's bytes under Y's permalink)
    expect(at("study-guide/ch4.md.html")).toBe(Y); // was: a fresh id
    expect([W, X, Y]).not.toContain(at("study-guide/ch2.md.html"));
    expect((await registry.listByPackage(PKG)).filter((r) => r.tombstoned)).toEqual([]); // nobody's permalink 410s
    await rebuildPackageRegistry(registry, store, PKG, "created");
    expect((await registry.listLiveByPackage(PKG)).find((r) => r.path === "study-guide/ch3.md.html")?.docId).toBe(X);
  });

  it("[P5.B.1.x] two carriers swap paths in one write; the swap lands even where the store refuses a location still held (swap)", async () => {
    const [A, B] = [uidN(4), uidN(5)];
    const registry = new StrictLocationRegistry();
    const { store } = await setup(
      [
        { repo: "public", path: "practice/a.md.html", content: carrier(A, "ALPHA") },
        { repo: "public", path: "practice/b.md.html", content: carrier(B, "BETA") },
      ],
      registry,
    );
    await writeThrough(store, null, PKG, {
      summary: "swap",
      changes: [
        { repo: "public", path: "practice/a.md.html", content: carrier(B, "BETA") },
        { repo: "public", path: "practice/b.md.html", content: carrier(A, "ALPHA") },
      ],
    });
    await expectUidsFollowBytes(registry, store, new Set([A, B]));
    expect((await registry.listLiveByPackage(PKG)).find((r) => r.docId === A)?.path).toBe("practice/b.md.html"); // was: a.md.html
  });

  it("[P5.B.1.x] an outside rotation healed on page load (content read from the store) follows the bytes (cycle)", async () => {
    const ids = [uidN(6), uidN(7), uidN(8)];
    const { registry, store } = await setup(
      ids.map((u, i) => ({ repo: "public" as const, path: `practice/q${i}.md.html`, content: carrier(u, `Q${i}`) })),
    );
    // an outside commit rotated q0→q1→q2→q0; the mirror got the bytes, the registry did not
    await store.putFiles(PKG, ids.map((u, i) => ({ repo: "public" as const, path: `practice/q${(i + 1) % 3}.md.html`, content: carrier(u, `Q${i}`) })));
    const drift = registryDrift(await store.listPaths(PKG), await registry.listLiveByPackage(PKG));
    await registerChangedFiles(registry, store, PKG, [...drift.added, ...drift.stale, ...drift.removed], "external-commit");
    await expectUidsFollowBytes(registry, store, new Set(ids));
  });

  it("[P5.B.1.x] property: random permutations and shifts of N carriers (write path, then a full rebuild) — each uid serves its own bytes", async () => {
    const next = rng(20261024);
    for (let round = 0; round < 150; round++) {
      const n = 2 + Math.floor(next() * 9);
      const uids = Array.from({ length: n }, (_, i) => uidN(1000 + round * 20 + i));
      const registry = new StrictLocationRegistry();
      const { store } = await setup(
        uids.map((u, i) => ({ repo: "public" as const, path: `practice/p${i}.md.html`, content: carrier(u, `B${u}`) })),
        registry,
      );
      // new layout: a permutation over n + extra slots, some carriers dropped, some new uid-less files
      const slots = n + Math.floor(next() * 3);
      const order = Array.from({ length: slots }, (_, i) => i).sort(() => next() - 0.5);
      const changes: Array<{ repo: "public"; path: string; content: string | null }> = [];
      const used = new Set<number>();
      uids.forEach((u, i) => {
        if (next() < 0.1) return; // deleted in this write
        const slot = order[i]!;
        used.add(slot);
        changes.push({ repo: "public", path: `practice/p${slot}.md.html`, content: carrier(u, `B${u}`) });
      });
      for (let s = 0; s < slots; s++) {
        if (used.has(s)) continue;
        changes.push({
          repo: "public",
          path: `practice/p${s}.md.html`,
          content: s < n && next() < 0.5 ? null : carrier(null, `new ${round}.${s}`),
        });
      }
      const live = new Set(uids);
      await writeThrough(store, null, PKG, { summary: "re-upload", changes });
      await expectUidsFollowBytes(registry, store, live);
      await rebuildPackageRegistry(registry, store, PKG, "created");
      await expectUidsFollowBytes(registry, store, live);
    }
  });

  it("[P5.B.1.x] a 600-file rotation is one move chain: it lands whole, never split into chunks that collide", async () => {
    const N = APPLY_CHUNK + 100;
    const uids = Array.from({ length: N }, (_, i) => uidN(50_000 + i));
    const registry = new StrictLocationRegistry();
    const { store } = await setup(
      uids.map((u, i) => ({ repo: "public" as const, path: `practice/r${String(i).padStart(4, "0")}.md.html`, content: carrier(u, `R${i}`) })),
      registry,
    );
    registry.calls = [];
    await writeThrough(store, null, PKG, {
      summary: "rotate",
      changes: uids.map((u, i) => ({ repo: "public" as const, path: `practice/r${String((i + 1) % N).padStart(4, "0")}.md.html`, content: carrier(u, `R${i}`) })),
    });
    await expectUidsFollowBytes(registry, store, new Set(uids));
    expect((await registry.listByPackage(PKG)).filter((r) => r.tombstoned)).toEqual([]);
  });

  it("[P5.B.1.x] kept: a byte-copy next to its untouched original still gets its own id (HIGH-A / copy rule)", async () => {
    const U = uidN(9);
    const { registry, store } = await setup([{ repo: "public", path: "practice/a.md.html", content: carrier(U, "orig") }]);
    await writeThrough(store, null, PKG, { summary: "copy", changes: [{ repo: "public", path: "practice/b.md.html", content: carrier(U, "copy") }] });
    const live = await registry.listLiveByPackage(PKG);
    expect(live.find((r) => r.path === "practice/a.md.html")?.docId).toBe(U);
    expect(live.find((r) => r.path === "practice/b.md.html")?.docId).not.toBe(U);
  });

  it("[P5.B.1.x] two new files carry one live uid whose file was deleted: the one with the registered bytes takes it, the other is a copy", async () => {
    const U = uidN(10);
    const { registry, store } = await setup([{ repo: "public", path: "practice/a.md.html", content: carrier(U, "orig") }]);
    await writeThrough(store, null, PKG, {
      summary: "split",
      changes: [
        { repo: "public", path: "practice/a.md.html", content: null },
        { repo: "public", path: "practice/c.md.html", content: carrier(U, "edited copy") },
        { repo: "public", path: "practice/b.md.html", content: carrier(U, "orig") },
      ],
    });
    const live = await registry.listLiveByPackage(PKG);
    expect(live.find((r) => r.path === "practice/b.md.html")?.docId).toBe(U); // the unchanged bytes keep it
    expect(live.find((r) => r.path === "practice/c.md.html")?.docId).not.toBe(U);
  });
});
