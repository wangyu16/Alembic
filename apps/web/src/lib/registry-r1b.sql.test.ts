/**
 * Loop r1b — the registry's database side (migration 0027) against a real
 * Postgres (PGlite with every migration applied), driven by the SAME pure
 * registration logic the app runs (`registerChangedFiles`) through a registry
 * store that speaks the same SQL as `SupabaseDocumentRegistryStore`
 * (`documents_apply`, `documents_foreign_doc_ids`, the row mappers).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { sha256Hex, type RegistrationRecord, type RepoKind } from "@alembic/package-contract";
import {
  MemoryPackageStore,
  forkPackage,
  rebuildPackageRegistry,
  registerChangedFiles,
  type DocumentRegistryStore,
} from "@alembic/package-ops";
import { asRole, freshDatabase, manifestFor, seedPackage, seedUser } from "./discovery-pglite";
import { fromRow, toRow, type DocumentRow } from "./document-registry-store";

// document-registry-store signals Discover (server-only next/cache); not under test here.
vi.mock("./discovery-cache", () => ({ discoveryChanged: () => {} }));

let db: PGlite;
let owner: string;
let stranger: string;

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "edu");
  stranger = await seedUser(db, "stranger");
}, 60_000);
afterAll(async () => {
  await db?.close();
});

/** The registry over PGlite, as a given user (RLS applies), via 0027's functions. */
class PgRegistry implements DocumentRegistryStore {
  constructor(private readonly user: string) {}
  private as<T>(fn: () => Promise<T>) {
    return asRole(db, "authenticated", fn, this.user);
  }
  async apply(packageId: string, c: { tombstones: string[]; upserts: RegistrationRecord[] }) {
    await this.as(() =>
      db.query(`select public.documents_apply($1, $2, $3::jsonb)`, [
        packageId,
        c.tombstones,
        JSON.stringify(c.upserts.map(toRow)),
      ]),
    );
  }
  async foreignDocIds(packageId: string, ids: string[]) {
    const { rows } = await this.as(() =>
      db.query<{ id: string }>(`select public.documents_foreign_doc_ids($1, $2) as id`, [packageId, ids]),
    );
    return new Set(rows.map((r) => r.id));
  }
  async listByPackage(packageId: string) {
    const { rows } = await this.as(() =>
      db.query<DocumentRow>(`select * from public.documents where package_id = $1 order by repo, path, doc_id`, [packageId]),
    );
    return rows.map((r) => fromRow({ ...r, registered_at: new Date(r.registered_at).toISOString() }));
  }
  async listLiveByPackage(packageId: string) {
    return (await this.listByPackage(packageId)).filter((r) => !r.tombstoned);
  }
  async upsert(r: RegistrationRecord) { await this.apply(r.packageId, { tombstones: [], upserts: [r] }); }
  async upsertMany(rs: RegistrationRecord[]) { if (rs[0]) await this.apply(rs[0].packageId, { tombstones: [], upserts: rs }); }
  async tombstone(p: string, d: string) { await this.apply(p, { tombstones: [d], upserts: [] }); }
  async tombstoneMany(p: string, ds: string[]) { await this.apply(p, { tombstones: ds, upserts: [] }); }
  async getByLocation(p: string, repo: RepoKind, path: string) {
    return (await this.listLiveByPackage(p)).find((r) => r.repo === repo && r.path === path) ?? null;
  }
  async getByContentHash(p: string, h: string) {
    return (await this.listLiveByPackage(p)).find((r) => r.sourceHash === h) ?? null;
  }
  async getByDocId(p: string, d: string) {
    return (await this.listLiveByPackage(p)).find((r) => r.docId === d) ?? null;
  }
}

const carrier = (uid: string, body = "x") =>
  `<html><head><script type="application/orz-meta+json" id="orz-meta">{"uid":"${uid}"}</script></head><body>${body}</body></html>`;

describe("0027 §1 the database hashes the stored bytes exactly as the app does", () => {
  it("[P5.B.1.m] sandbox_files.content_sha256 equals sha256Hex(content) for text, non-ASCII and base64", async () => {
    const id = await seedPackage(db, { owner, storage: "sandbox" });
    const contents = ["# Ch1\n\nplain", "Ünïcödé — ∑ 🚀", "iVBORw0KGgoAAAANSUhEUg=="];
    for (const [i, content] of contents.entries()) {
      await db.query(`insert into public.sandbox_files (package_id, repo, path, content) values ($1, 'public', $2, $3)`, [
        id,
        `assets/f${i}.txt`,
        content,
      ]);
      const { rows } = await db.query<{ h: string }>(
        `select content_sha256 h from public.sandbox_files where package_id = $1 and path = $2`,
        [id, `assets/f${i}.txt`],
      );
      expect(rows[0]!.h).toBe(await sha256Hex(content));
    }
    // and it follows an update
    await db.query(`update public.sandbox_files set content = 'changed' where package_id = $1 and path = 'assets/f0.txt'`, [id]);
    const { rows } = await db.query<{ h: string }>(`select content_sha256 h from public.sandbox_files where package_id = $1 and path = 'assets/f0.txt'`, [id]);
    expect(rows[0]!.h).toBe(await sha256Hex("changed"));
  });
});

describe("0027 §3–§5 a docId belongs to exactly one package", () => {
  it("[P5.B.1.n] a same-owner fork carrying the source's uid registers a fresh identity; the source row never moves", async () => {
    const src = await seedPackage(db, { owner, id: "pkg-src-r1b00001", listed: true });
    const uid = "doc-abcdefabc001";
    const reg = new PgRegistry(owner);
    const srcStore = new MemoryPackageStore();
    await srcStore.createPackage({ packageId: src, ownerId: owner, title: "S", manifest: manifestFor(src, "S") as never, storage: "github" }, [
      { repo: "public", path: "practice/ch1.md.html", content: carrier(uid) },
    ]);
    await rebuildPackageRegistry(reg, srcStore, src, "created");
    expect((await reg.getByLocation(src, "public", "practice/ch1.md.html"))!.docId).toBe(uid);

    // A fork made BEFORE r1b still carries the source's uid verbatim.
    const fork = await seedPackage(db, { owner, id: "pkg-fork-r1b00001", storage: "sandbox" });
    const forkStore = new MemoryPackageStore();
    await forkStore.createPackage({ packageId: fork, ownerId: owner, title: "F", manifest: {} as never, storage: "sandbox" }, [
      { repo: "public", path: "practice/ch1.md.html", content: carrier(uid) },
    ]);
    await rebuildPackageRegistry(reg, forkStore, fork, "created");

    const copy = (await reg.getByLocation(fork, "public", "practice/ch1.md.html"))!;
    expect(copy.docId).not.toBe(uid);
    const { rows } = await db.query<{ package_id: string; tombstoned: boolean }>(
      `select package_id, tombstoned from public.documents where doc_id = $1`,
      [uid],
    );
    expect(rows).toEqual([{ package_id: src, tombstoned: false }]);
    // And forkPackage itself no longer copies the uid (r1b).
    const forked = forkPackage({
      source: { packageId: src, manifest: manifestFor(src, "S") as never, publicFiles: [{ repo: "public", path: "practice/ch1.md.html", content: carrier(uid) }] },
      target: { ownerId: owner, license: "CC-BY-4.0" },
      attribution: "x",
    });
    expect(forked.files.find((f) => f.path === "practice/ch1.md.html")!.content).not.toContain(uid);
  });

  it("[P5.B.1.n] a stranger's upload carrying someone else's uid registers a fresh identity (not refused, not moved)", async () => {
    const src = await seedPackage(db, { owner, id: "pkg-src-r1b00002" });
    const uid = "doc-abcdefabc002";
    const reg = new PgRegistry(owner);
    const s1 = new MemoryPackageStore();
    await s1.createPackage({ packageId: src, ownerId: owner, title: "S", manifest: {} as never, storage: "github" }, [
      { repo: "public", path: "practice/a.md.html", content: carrier(uid) },
    ]);
    await rebuildPackageRegistry(reg, s1, src);

    const theirs = await seedPackage(db, { owner: stranger, id: "pkg-strange-r1b0002", storage: "sandbox" });
    const s2 = new MemoryPackageStore();
    await s2.createPackage({ packageId: theirs, ownerId: stranger, title: "T", manifest: {} as never, storage: "sandbox" }, []);
    const content = carrier(uid, "downloaded");
    await s2.putFiles(theirs, [{ repo: "public", path: "practice/a.md.html", content }]);
    const [r] = await registerChangedFiles(new PgRegistry(stranger), s2, theirs, [{ repo: "public", path: "practice/a.md.html", content }]);
    expect(r!.docId).not.toBe(uid);
    expect((await new PgRegistry(stranger).getByLocation(theirs, "public", "practice/a.md.html"))!.docId).toBe(r!.docId);
    const { rows } = await db.query(`select package_id from public.documents where doc_id = $1`, [uid]);
    expect(rows).toEqual([{ package_id: src }]);
  });

  it("[P5.B.1.n] the database refuses to move a docId into another package, even for its owner", async () => {
    const a = await seedPackage(db, { owner, storage: "sandbox" });
    const b = await seedPackage(db, { owner, storage: "sandbox" });
    await db.query(`insert into public.documents (doc_id, package_id, repo, path, space, kind, origin, permalink_class)
      values ('doc-movemove0001', $1, 'public', 'assets/m.svg', 'assets', 'svg', 'created', 'object')`, [a]);
    await expect(
      asRole(db, "authenticated", () => db.query(`update public.documents set package_id = $1 where doc_id = 'doc-movemove0001'`, [b]), owner),
    ).rejects.toThrow(/belongs to another package/);
  });

  it("[P5.B.1.n] documents_apply is all-or-nothing: a refused row leaves its tombstones undone", async () => {
    const a = await seedPackage(db, { owner, storage: "sandbox" });
    const b = await seedPackage(db, { owner, storage: "sandbox" });
    const reg = new PgRegistry(owner);
    const store = new MemoryPackageStore();
    await store.createPackage({ packageId: a, ownerId: owner, title: "A", manifest: {} as never, storage: "sandbox" }, [
      { repo: "public", path: "assets/keep.svg", content: "<svg>keep</svg>" },
    ]);
    const [keep] = await rebuildPackageRegistry(reg, store, a);
    await db.query(`insert into public.documents (doc_id, package_id, repo, path, space, kind, origin, permalink_class)
      values ('doc-elsewhere0001', $1, 'public', 'assets/x.svg', 'assets', 'svg', 'created', 'object')`, [b]);
    // A run that tombstones `keep` and (wrongly) claims b's docId at keep's location.
    const claim = { ...keep!, docId: "doc-elsewhere0001" };
    await expect(reg.apply(a, { tombstones: [keep!.docId], upserts: [claim] })).rejects.toThrow();
    const { rows } = await db.query(`select tombstoned from public.documents where doc_id = $1`, [keep!.docId]);
    expect(rows).toEqual([{ tombstoned: false }]);
  });

  it("[P5.B.1.n] documents_foreign_doc_ids sees across owners and says only 'taken elsewhere'", async () => {
    const mine = await seedPackage(db, { owner: stranger, storage: "sandbox" });
    const theirs = await seedPackage(db, { owner, storage: "sandbox" });
    await db.query(`insert into public.documents (doc_id, package_id, repo, path, space, kind, origin, permalink_class)
      values ('doc-theirs000001', $1, 'public', 'assets/t.svg', 'assets', 'svg', 'created', 'object'),
             ('doc-mine00000001', $2, 'public', 'assets/m.svg', 'assets', 'svg', 'created', 'object')`, [theirs, mine]);
    const got = await new PgRegistry(stranger).foreignDocIds(mine, ["doc-theirs000001", "doc-mine00000001", "doc-free00000001"]);
    expect([...got]).toEqual(["doc-theirs000001"]);
    await expect(
      asRole(db, "anon", () => db.query(`select public.documents_foreign_doc_ids('x', array['doc-theirs000001'])`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("[P5.B.1.n] another owner cannot write rows into my package through documents_apply (RLS applies)", async () => {
    const mine = await seedPackage(db, { owner, storage: "sandbox" });
    const row = {
      docId: "doc-intruder00001", packageId: mine, repo: "public", path: "assets/i.svg", space: "assets",
      kind: "svg", formatVersion: 0, origin: "created", registeredAt: new Date().toISOString(), tags: [],
      discoverable: false, permalinkClass: "object", tombstoned: false,
    } as RegistrationRecord;
    await expect(new PgRegistry(stranger).apply(mine, { tombstones: [], upserts: [row] })).rejects.toThrow(/row-level security/);
  });
});

describe("0027 §4 one registration run = one discovery refresh", () => {
  it("[P5.A.1.m] a flush (tombstone + new row + changed row) through documents_apply refreshes the package once", async () => {
    const id = await seedPackage(db, { owner, listed: true });
    const reg = new PgRegistry(owner);
    const store = new MemoryPackageStore();
    await store.createPackage({ packageId: id, ownerId: owner, title: "C", manifest: {} as never, storage: "github" }, [
      { repo: "public", path: "assets/a.svg", content: "<svg>a</svg>" },
      { repo: "public", path: "assets/b.svg", content: "<svg>b</svg>" },
    ]);
    const [a, b] = await rebuildPackageRegistry(reg, store, id);
    await db.exec(`update public.documents set discoverable = true where package_id = '${id}'`);
    const fresh = { ...b!, docId: "doc-freshfresh001", path: "assets/c.svg", sourceHash: "hc", discoverable: true };
    const changed = { ...b!, sourceHash: "hb2", discoverable: true };
    await db.exec(`set track_functions = 'all'`);
    const calls = await db.transaction(async (tx) => {
      await tx.query(`set local role authenticated`);
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [owner]);
      await tx.query(`select public.documents_apply($1, $2, $3::jsonb)`, [
        id,
        [a!.docId],
        JSON.stringify([fresh, changed].map(toRow)),
      ]);
      const { rows } = await tx.query<{ c: string | number }>(
        `select coalesce(sum(calls), 0) as c from pg_stat_xact_user_functions where funcname = 'discovery_refresh_package'`,
      );
      return Number(rows[0]!.c);
    });
    expect(calls).toBe(1);
    const els = await db.query<{ doc_id: string }>(`select doc_id from public.discovery_elements where package_id = $1 order by doc_id`, [id]);
    expect(els.rows.map((r) => r.doc_id).sort()).toEqual([b!.docId, "doc-freshfresh001"].sort());
  });
});
