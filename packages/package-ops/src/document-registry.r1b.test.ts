/**
 * Closed loop r1b (Phase 5 correctness/scale audit) — probes for the registry
 * findings HIGH-1 (stale source_hash), HIGH-2 (a docId moving between
 * packages) and LOW-6 (one uid shape). Each test failed on ff39af5.
 */
import { describe, expect, it } from "vitest";
import {
  DOC_ID_PATTERN,
  sha256Hex,
  type RegistrationRecord,
} from "@alembic/package-contract";
import { forkPackage } from "./adaptation";
import { createSandboxPackage } from "./create";
import {
  ForeignDocIdError,
  MemoryDocumentRegistryStore,
  computeSourceHash,
  extractEmbeddedUid,
  rebuildPackageRegistry,
  registerChangedFiles,
  registerFile,
  registryDrift,
  remintEmbeddedUid,
  type DocumentRegistryStore,
} from "./document-registry";
import { updateManifest } from "./manifest-ops";
import { MemoryPackageStore } from "./memory-store";
import type { PackageRecord } from "./store";
import { writeThrough } from "./write-through";

const A = "pkg-alpha-aaaaaaaa";
const B = "pkg-beta-bbbbbbbb";
const rec = (packageId: string): PackageRecord => ({
  packageId,
  ownerId: "u1",
  title: packageId,
  manifest: {} as PackageRecord["manifest"],
  storage: "sandbox",
});
const carrier = (uid: string, body = "x") =>
  `<html><head><script type="application/orz-meta+json" id="orz-meta">{"title":"T","uid":"${uid}"}</script></head><body>${body}</body></html>`;

/** Every live row's hashes equal the hashes of the bytes stored at its location. */
async function assertFresh(
  registry: DocumentRegistryStore,
  store: MemoryPackageStore,
  packageId: string,
): Promise<number> {
  const live = await registry.listLiveByPackage(packageId);
  for (const r of live) {
    const bytes = await store.readFile(packageId, r.repo, r.path);
    expect(bytes, `${r.path} has a live row but no file`).not.toBeNull();
    expect(r.sourceHash, r.path).toBe(computeSourceHash(bytes!));
    expect(r.contentSha256, r.path).toBe(await sha256Hex(bytes!));
  }
  return live.length;
}

describe("HIGH-1 every write registers what it touched (the one write path)", () => {
  it("[P5.B.1.m] after writeThrough (save, add, delete) every touched live file's hash equals its stored content's", async () => {
    const registry = new MemoryDocumentRegistryStore();
    const store = new MemoryPackageStore(registry);
    await store.createPackage(rec(A), [
      { repo: "public", path: "study-guide/ch1.md", content: "# Ch1\n\nOld\n" },
      { repo: "public", path: "assets/a.svg", content: "<svg>a</svg>" },
    ]);
    await rebuildPackageRegistry(registry, store, A, "created");
    const before = (await registry.getByLocation(A, "public", "study-guide/ch1.md"))!;

    // The save a hosted editor makes: writeThrough and NOTHING else.
    await writeThrough(store, null, A, {
      summary: "Save",
      changes: [
        { repo: "public", path: "study-guide/ch1.md", content: "# Ch1\n\nNEW\n" },
        { repo: "public", path: "assets/b.svg", content: "<svg>b</svg>" },
        { repo: "public", path: "assets/a.svg", content: null },
      ],
    });

    expect(await assertFresh(registry, store, A)).toBe(2);
    const after = (await registry.getByLocation(A, "public", "study-guide/ch1.md"))!;
    expect(after.docId).toBe(before.docId);
    expect((await registry.listByPackage(A)).find((r) => r.path === "assets/a.svg")?.tombstoned).toBe(true);
  });

  it("[P5.B.1.m] updateManifest registers the manifest it wrote", async () => {
    const registry = new MemoryDocumentRegistryStore();
    const store = new MemoryPackageStore(registry);
    const { packageId } = await createSandboxPackage(store, { ownerId: "u1", title: "Chem", license: "CC-BY-4.0" });
    await updateManifest(store, null, packageId, (m) => ({ ...m, description: "New words" }));
    const row = await registry.getByLocation(packageId, "public", "alembic.json");
    expect(row).not.toBeNull();
    await assertFresh(registry, store, packageId);
  });

  it("[P5.B.1.m] an edit-then-rename in ONE write keeps the docId (explicit movedFrom, no hash guessing)", async () => {
    const registry = new MemoryDocumentRegistryStore();
    const store = new MemoryPackageStore(registry);
    await store.createPackage(rec(A), [{ repo: "public", path: "study-guide/ch1.md", content: "# Ch1\n\nOld\n" }]);
    await rebuildPackageRegistry(registry, store, A, "created");
    const before = (await registry.getByLocation(A, "public", "study-guide/ch1.md"))!;
    await writeThrough(store, null, A, {
      summary: "Rename",
      changes: [
        { repo: "public", path: "study-guide/intro.md", content: "# Intro\n\nEdited too\n", movedFrom: "study-guide/ch1.md" },
        { repo: "public", path: "study-guide/ch1.md", content: null },
      ],
    });
    const moved = (await registry.getByLocation(A, "public", "study-guide/intro.md"))!;
    expect(moved.docId).toBe(before.docId);
    expect((await registry.listByPackage(A)).filter((r) => r.tombstoned)).toEqual([]);
    await assertFresh(registry, store, A);
  });

  it("[P5.B.1.m] a movedFrom the change set does not delete is refused before any write", async () => {
    const store = new MemoryPackageStore(new MemoryDocumentRegistryStore());
    await store.createPackage(rec(A), [{ repo: "public", path: "assets/a.svg", content: "<svg/>" }]);
    await expect(
      writeThrough(store, null, A, {
        summary: "x",
        changes: [{ repo: "public", path: "assets/b.svg", content: "<svg/>", movedFrom: "assets/a.svg" }],
      }),
    ).rejects.toThrow(/does not delete it/);
    expect(await store.readFile(A, "public", "assets/b.svg")).toBeNull();
  });

  it("[P5.B.1.m] the page-load check sees a content change that leaves the path set alone", async () => {
    const registry = new MemoryDocumentRegistryStore();
    const store = new MemoryPackageStore(); // no registry: a write that bypassed registration
    await store.createPackage(rec(A), [
      { repo: "public", path: "study-guide/ch1.md", content: "# Ch1\n\nOld\n" },
      { repo: "public", path: "assets/a.svg", content: "<svg>a</svg>" },
    ]);
    await rebuildPackageRegistry(registry, store, A, "created");
    expect(registryDrift(await store.listPaths(A), await registry.listLiveByPackage(A))).toEqual({
      added: [],
      stale: [],
      removed: [],
    });
    await store.putFiles(A, [{ repo: "public", path: "study-guide/ch1.md", content: "# Ch1\n\nNEW\n" }]);
    const drift = registryDrift(await store.listPaths(A), await registry.listLiveByPackage(A));
    expect(drift.stale).toEqual([{ repo: "public", path: "study-guide/ch1.md" }]);
    await registerChangedFiles(registry, store, A, [...drift.added, ...drift.stale, ...drift.removed]);
    await assertFresh(registry, store, A);
    // A row registered before r1b (no digest) counts as stale: it is re-verified once.
    const legacy = new MemoryDocumentRegistryStore();
    await legacy.upsertMany(
      (await registry.listLiveByPackage(A)).map(({ contentSha256: _drop, ...r }) => r as RegistrationRecord),
    );
    expect(registryDrift(await store.listPaths(A), await legacy.listLiveByPackage(A)).stale).toHaveLength(2);
  });
});

describe("HIGH-2 a docId belongs to exactly one package", () => {
  async function owned() {
    const registry = new MemoryDocumentRegistryStore();
    const store = new MemoryPackageStore(registry);
    const uid = "doc-abcdefabcdef";
    await store.createPackage(rec(A), [{ repo: "public", path: "practice/ch1.md.html", content: carrier(uid) }]);
    await rebuildPackageRegistry(registry, store, A, "created");
    expect((await registry.getByLocation(A, "public", "practice/ch1.md.html"))!.docId).toBe(uid);
    await store.createPackage(rec(B), []);
    return { registry, store, uid };
  }

  it("[P5.B.1.n] a uid owned by another package mints a fresh identity (write path)", async () => {
    const { registry, store, uid } = await owned();
    await writeThrough(store, null, B, {
      summary: "Upload",
      changes: [{ repo: "public", path: "practice/copy.md.html", content: carrier(uid, "copy") }],
    });
    const copy = (await registry.getByLocation(B, "public", "practice/copy.md.html"))!;
    expect(copy.docId).not.toBe(uid);
    expect(copy.docId).toMatch(DOC_ID_PATTERN);
    const original = (await registry.listByPackage(A)).find((r) => r.docId === uid)!;
    expect(original.packageId).toBe(A);
    expect(original.tombstoned).toBe(false);
    // Stable: a rebuild of B keeps the copy's identity and never takes the uid.
    await rebuildPackageRegistry(registry, store, B);
    expect((await registry.getByLocation(B, "public", "practice/copy.md.html"))!.docId).toBe(copy.docId);
  });

  it("[P5.B.1.n] a rebuild and a single registration never adopt another package's uid either", async () => {
    const { registry, store, uid } = await owned();
    await store.putFiles(B, [{ repo: "public", path: "practice/x.md.html", content: carrier(uid) }]);
    await rebuildPackageRegistry(registry, store, B);
    expect((await registry.getByLocation(B, "public", "practice/x.md.html"))!.docId).not.toBe(uid);
    const single = await registerFile(registry, {
      packageId: B,
      repo: "public",
      path: "practice/y.md.html",
      origin: "created",
      content: carrier(uid, "y"),
      adaptedFrom: uid,
    });
    expect(single.docId).not.toBe(uid);
    expect(single.adaptedFrom).toBe(uid);
    expect((await registry.listByPackage(A)).map((r) => [r.docId, r.tombstoned])).toEqual([[uid, false]]);
  });

  it("[P5.B.1.n] forkPackage re-mints every embedded uid", async () => {
    const store = new MemoryPackageStore();
    const { packageId, manifest } = await createSandboxPackage(store, { ownerId: "a", title: "Src", license: "CC-BY-4.0" });
    const uid = "doc-abcdefabcdef";
    const forked = forkPackage({
      source: { packageId, manifest, publicFiles: [{ repo: "public", path: "practice/ch1.md.html", content: carrier(uid) }] },
      target: { ownerId: "b", license: "CC-BY-4.0" },
      attribution: "x",
    });
    const copy = forked.files.find((f) => f.path === "practice/ch1.md.html")!;
    const minted = extractEmbeddedUid(copy.content);
    expect(minted).not.toBeNull();
    expect(minted).not.toBe(uid);
    expect(copy.content.replace(minted!, uid)).toBe(carrier(uid)); // nothing else changed
  });

  it("[P5.B.1.n] remintEmbeddedUid changes only the uid and leaves non-carriers alone", () => {
    const out = remintEmbeddedUid(carrier("doc-abcdefabcdef"), "doc-zzzzzzzzzzzz");
    expect(out).toBe(carrier("doc-zzzzzzzzzzzz"));
    expect(remintEmbeddedUid("<svg/>")).toBe("<svg/>");
  });

  it("[P5.B.1.n] the in-memory registry keys docIds globally, like documents.doc_id", async () => {
    const registry = new MemoryDocumentRegistryStore();
    const store = new MemoryPackageStore();
    await store.createPackage(rec(A), [{ repo: "public", path: "assets/a.svg", content: "<svg/>" }]);
    const [r] = await rebuildPackageRegistry(registry, store, A);
    await expect(registry.upsert({ ...r!, packageId: B })).rejects.toBeInstanceOf(ForeignDocIdError);
    expect((await registry.listByPackage(A))[0]!.packageId).toBe(A);
    expect(await registry.listByPackage(B)).toEqual([]);
  });

  it("[P5.B.1.n] a refused upsert never leaves its tombstones behind (atomic flush)", async () => {
    const registry = new MemoryDocumentRegistryStore();
    const store = new MemoryPackageStore();
    await store.createPackage(rec(A), [{ repo: "public", path: "practice/ch1.md.html", content: "<p>plain</p>" }]);
    await rebuildPackageRegistry(registry, store, A);
    const old = (await registry.getByLocation(A, "public", "practice/ch1.md.html"))!;
    // The database refuses the incoming identity (e.g. an RLS refusal).
    const refusing: DocumentRegistryStore = Object.assign(Object.create(registry) as DocumentRegistryStore, {
      upsert: async () => { throw new Error("refused"); },
      upsertMany: async () => { throw new Error("refused"); },
      apply: async (p: string, c: { tombstones: string[]; upserts: RegistrationRecord[] }) => {
        if (c.upserts.length > 0) throw new Error("refused");
        return registry.apply(p, c);
      },
    });
    const incoming = carrier("doc-newnewnewnew");
    await store.putFiles(A, [{ repo: "public", path: "practice/ch1.md.html", content: incoming }]);
    await registerChangedFiles(refusing, store, A, [{ repo: "public", path: "practice/ch1.md.html", content: incoming }]);
    const still = (await registry.listByPackage(A)).find((r) => r.docId === old.docId)!;
    expect(still.tombstoned).toBe(false); // the permalink keeps answering, never a 410
  });
});

describe("LOW-6 one uid shape", () => {
  it("[P5.B.1.o] an embedded uid /d could never serve is not an identity", async () => {
    expect(extractEmbeddedUid(carrier("doc-Ch1_Intro.v2"))).toBeNull();
    expect(extractEmbeddedUid(carrier("doc-abcdefabcdef"))).toBe("doc-abcdefabcdef");
    const registry = new MemoryDocumentRegistryStore();
    const store = new MemoryPackageStore();
    await store.createPackage(rec(A), [{ repo: "public", path: "practice/ch1.md.html", content: carrier("doc-Ch1_Intro.v2") }]);
    const [r] = await rebuildPackageRegistry(registry, store, A);
    expect(r!.docId).toMatch(DOC_ID_PATTERN);
  });
});

describe("LOW-6 one uid shape across the doors", () => {
  it("[P5.B.1.o] the permalink builder, the classifier and the registry agree on the id shape", async () => {
    const { livePermalink, classifyReference } = await import("@alembic/package-contract");
    expect(() => livePermalink("doc-Ch1_Intro.v2" as never)).toThrow();
    // A malformed id is not a platform permalink (a pin on it is not a pin).
    expect(classifyReference("/d/doc-Ch1_Intro@abc123")).not.toBe("pinned");
    expect(classifyReference("/d/doc-abcdefabcdef@abc123")).toBe("pinned");
  });
});

describe("round-trip budget with the r1b checks", () => {
  /** Counts registry calls the way PostgREST bills them (one per call). */
  function counting(inner: MemoryDocumentRegistryStore) {
    const calls: string[] = [];
    const wrap = new Proxy(inner, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        return typeof v === "function"
          ? (...args: unknown[]) => (calls.push(String(prop)), (v as (...a: unknown[]) => unknown).apply(target, args))
          : v;
      },
    });
    return { registry: wrap as MemoryDocumentRegistryStore, calls };
  }

  it("[P5.B.1.n] a save of a registered uid'd document asks nothing extra; a new uid costs one cross-package lookup", async () => {
    const { registry, calls } = counting(new MemoryDocumentRegistryStore());
    const store = new MemoryPackageStore(registry);
    await store.createPackage(rec(A), []);
    const write = (content: string) =>
      writeThrough(store, null, A, { summary: "s", changes: [{ repo: "public", path: "practice/ch1.md.html", content }] });
    await write(carrier("doc-abcdefabc777", "v1"));
    expect(calls).toEqual(["listLiveByPackage", "foreignDocIds", "apply"]);
    calls.length = 0;
    await write(carrier("doc-abcdefabc777", "v2"));
    expect(calls).toEqual(["listLiveByPackage", "apply"]); // 2 round-trips, as before r1b
    console.info(`[r1b] uid'd save: ${calls.length} registry round-trips; first registration: 3`);
  });
});
