/**
 * Correctness loop r2 (round-2 audit, 2026-10-23): probes for the database
 * findings, on the Supabase-shaped harness (non-superuser owner, every
 * migration in a fresh session — P5.S.13). Each block failed on the r2
 * security branch (e057bde, migrations through 0028_loop_r2_5) unless it says
 * it pins kept behaviour, and passes with migrations 0029_loop_r2c_*.
 *
 *   H-D1      P5.A.1.o  the projector bounds every text; a rebuild survives a bad package
 *   M-D1      P5.A.1.h  a slow / cancelled projector never fails the write
 *   L-D1      P5.A.1.p  concept-map renames re-project; concept-map saves are course-only
 *   L-D2      P5.A.1.q  one refresh per package at a time (advisory lock)
 *   M-D3      P5.A.1.n  a registered_at change is moot (server-owned) — kept
 *   MEDIUM-1  P5.B.1.t  documents_apply keeps what the owner set
 *   MEDIUM-3  P5.B.1.u  a 3,000-file registration stays within the statement timeout
 *   HIGH-A    P5.B.1.s  a dormant uid never displaces (composes with retired ids)
 *   compose   P5.A.1.r  the live definitions still carry every earlier round's rules
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { MemoryPackageStore, rebuildPackageRegistry, writeThrough } from "@alembic/package-ops";
import { asRole, freshDatabase, seedDoc, seedPackage, seedUser } from "./discovery-pglite";
import { PgRegistry } from "./pglite-registry";

// document-registry-store signals Discover (server-only next/cache); not under test here.
vi.mock("./discovery-cache", () => ({ discoveryChanged: () => {} }));
// Several probes seed 3,000-element courses; the rebuild-equality oracle then
// re-projects everything the file has seeded.
vi.setConfig({ testTimeout: 120_000 });

let db: PGlite;
let owner: string;
let stranger: string;

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "edu");
  stranger = await seedUser(db, "stranger");
}, 120_000);
afterAll(async () => {
  await db?.close();
});

const COURSES = `select to_jsonb(c) - 'projected_at' as r from public.discovery_courses c order by package_id`;
const ELEMENTS = `select to_jsonb(e) - 'projected_at' as r from public.discovery_elements e order by doc_id`;

/** The incremental projection equals a rebuild from empty (P5.A.1.i's oracle). */
async function expectProjectionEqualsRebuild() {
  const c = (await db.query(COURSES)).rows;
  const e = (await db.query(ELEMENTS)).rows;
  await db.exec(`delete from public.discovery_courses; delete from public.discovery_elements;`);
  await db.query(`select public.discovery_rebuild()`);
  expect((await db.query(COURSES)).rows).toEqual(c);
  expect((await db.query(ELEMENTS)).rows).toEqual(e);
}

async function seedShared(packageId: string, prefix: string, n: number) {
  await db.query(
    `insert into public.documents (doc_id, package_id, repo, path, space, kind, source_hash, origin,
       description, tags, discoverable, permalink_class)
     select $2 || lpad(g::text, 8, '0'), $1, 'public', 'assets/' || $2 || g || '.svg', 'assets', 'svg', 'h' || g,
       'created', 'A titration curve number ' || g, '{acid,base}', true, 'object'
     from generate_series(1, $3) g`,
    [packageId, prefix, n],
  );
}

const pending = async (id: string) =>
  (await db.query<{ doc_ids: string[] | null }>(`select doc_ids from public.discovery_pending where package_id = $1`, [id])).rows[0] ?? null;
const own = <T,>(fn: () => Promise<T>, user = owner) => asRole(db, "authenticated", fn, user);

// ---------------------------------------------------------------------------
// H-D1 — bounded texts, isolated rebuild
// ---------------------------------------------------------------------------
describe("H-D1 the projector bounds every text it indexes; one bad package never aborts a rebuild", () => {
  it("[P5.A.1.o] a 1.3 MB file description (stored before the bound) projects capped, and the rebuild succeeds", async () => {
    const id = await seedPackage(db, { owner, listed: true, title: "Huge description" });
    const doc = await seedDoc(db, { packageId: id });
    // A row stored before 0029_loop_r2c_3 bounded the column.
    await db.exec(`alter table public.documents drop constraint documents_description_bounded`);
    try {
      await db.query(`update public.documents set description = repeat('word ', 260000) where doc_id = $1`, [doc]);
      const n = await db.query<{ n: number }>(`select public.discovery_rebuild() as n`);
      expect(n.rows[0]!.n).toBeGreaterThan(0);
      const el = (await db.query<{ len: number }>(`select char_length(description) as len from public.discovery_elements where doc_id = $1`, [doc])).rows[0]!;
      expect(el.len).toBeLessThanOrEqual(4000);
    } finally {
      await db.query(`update public.documents set description = 'short again' where doc_id = $1`, [doc]);
      await db.exec(`alter table public.documents add constraint documents_description_bounded check (char_length(description) <= 4000)`);
    }
  });

  it("[P5.A.1.o] a course with a 2 MB description and 5,000 chapter titles projects bounded and rebuilds", async () => {
    const id = await seedPackage(db, { owner, listed: true, title: "Huge course" });
    await own(() =>
      db.query(
        `update public.packages set manifest = manifest
           || jsonb_build_object('description', repeat('lorem ipsum ', 180000))
           || jsonb_build_object('chapters', (select jsonb_agg(jsonb_build_object('id', 'c' || g, 'title', 'Chapter about ' || g || repeat(' x', 200))) from generate_series(1, 5000) g))
         where id = $1`,
        [id],
      ),
    );
    const c = (await db.query<{ d: number; ch: number }>(
      `select char_length(description) as d, cardinality(chapter_titles) as ch from public.discovery_courses where package_id = $1`, [id])).rows[0]!;
    expect(c.d).toBeLessThanOrEqual(8000);
    expect(c.ch).toBeLessThanOrEqual(200);
    expect((await db.query<{ n: number }>(`select public.discovery_rebuild() as n`)).rows[0]!.n).toBeGreaterThan(0);
  });

  it("[P5.A.1.o] discovery_rebuild isolates a failing package: it is reported, every other package is rebuilt", async () => {
    const good = await seedPackage(db, { owner, listed: true, title: "Good course" });
    const bad = await seedPackage(db, { owner, listed: true, title: "Bad course" });
    await seedDoc(db, { packageId: good });
    await seedDoc(db, { packageId: bad });
    await db.exec(`
      create function public.test_fail_bad() returns trigger language plpgsql set search_path = '' as $$
      begin raise exception 'simulated projector failure'; end $$;
      create trigger test_fail_bad before insert or update on public.discovery_courses
        for each row when (new.package_id = '${bad}') execute function public.test_fail_bad();`);
    try {
      await db.exec(`delete from public.discovery_courses; delete from public.discovery_elements;`);
      const report = (await db.query<{ package_id: string; ok: boolean; error: string | null }>(
        `select * from public.discovery_rebuild_report()`)).rows;
      expect(report.find((r) => r.package_id === bad)).toMatchObject({ ok: false, error: expect.stringContaining("simulated") });
      expect(report.find((r) => r.package_id === good)).toMatchObject({ ok: true });
      expect((await db.query(`select 1 from public.discovery_courses where package_id = $1`, [good])).rows).toHaveLength(1);
      // the failing package's element writes rolled back with it; nothing half-projected
      expect((await db.query(`select 1 from public.discovery_elements where package_id = $1`, [bad])).rows).toHaveLength(0);
    } finally {
      await db.exec(`drop trigger test_fail_bad on public.discovery_courses; drop function public.test_fail_bad();`);
      await db.query(`select public.discovery_rebuild()`);
    }
  });

  it("[P5.A.1.o] the registry refuses an over-long description, alt text or tag list — from the owner's session and documents_apply", async () => {
    const id = await seedPackage(db, { owner, storage: "sandbox", title: "Bounds" });
    const doc = await seedDoc(db, { packageId: id });
    for (const set of [
      `description = repeat('x', 4001)`,
      `alt_text = repeat('x', 2001)`,
      `tags = array_fill('t'::text, array[65])`,
      `tags = array[repeat('t', 101)]`,
    ]) {
      await expect(own(() => db.query(`update public.documents set ${set} where doc_id = $1`, [doc]))).rejects.toThrow(/bounded/);
    }
    await own(() => db.query(`update public.documents set description = repeat('x', 4000), tags = array_fill('t'::text, array[64]) where doc_id = $1`, [doc]));
    const row = { doc_id: "doc-boundsbound1", package_id: id, repo: "public", path: "assets/b.svg", space: "assets", kind: "svg",
      source_hash: "h", origin: "created", permalink_class: "object", description: "y".repeat(4001) };
    await expect(own(() => db.query(`select public.documents_apply($1, '{}', $2::jsonb)`, [id, JSON.stringify([row])]))).rejects.toThrow(/bounded/);
  });
});

// ---------------------------------------------------------------------------
// M-D1 — the write path stays bounded; a cancelled projector never fails a write
// ---------------------------------------------------------------------------
describe("M-D1 a slow or cancelled projector never fails the educator's write", () => {
  it("[P5.A.1.h] a projector cancelled by the statement timeout (57014) is queued, the write commits, later refreshes queue too", async () => {
    const id = await seedPackage(db, { owner, listed: true, title: "Cancelled" });
    const doc = await seedDoc(db, { packageId: id });
    await db.exec(`
      alter function public.discovery_refresh_package(text, boolean, text[]) rename to discovery_refresh_package_real;
      create function public.discovery_refresh_package(p text, c boolean default false, ids text[] default null) returns void
        language plpgsql security definer set search_path = '' as $$
        begin raise sqlstate '57014' using message = 'canceling statement due to statement timeout (simulated)'; end $$;`);
    try {
      // one statement that triggers two refreshes: the doc's package, then (adaptation) none — use two docs of two packages
      await own(() => db.query(`update public.documents set description = 'saved anyway' where doc_id = $1`, [doc]));
      await own(() => db.query(`update public.packages set manifest = manifest || '{"title":"Renamed anyway"}' where id = $1`, [id]));
      await db.exec(`begin`);
      await db.query(`update public.documents set description = 'first in txn' where doc_id = $1`, [doc]);
      const flag = (await db.query<{ v: string }>(`select current_setting('alembic.discovery_cancelled', true) as v`)).rows[0]!.v;
      await db.exec(`commit`);
      expect(flag).toBe("on"); // every later refresh of that transaction queues instead of running
    } finally {
      await db.exec(`
        drop function public.discovery_refresh_package(text, boolean, text[]);
        alter function public.discovery_refresh_package_real(text, boolean, text[]) rename to discovery_refresh_package;`);
    }
    expect((await db.query<{ d: string }>(`select description d from public.documents where doc_id = $1`, [doc])).rows[0]!.d).toBe("first in txn");
    expect((await db.query<{ t: string }>(`select manifest->>'title' t from public.packages where id = $1`, [id])).rows[0]!.t).toBe("Renamed anyway");
    expect(await pending(id)).not.toBeNull();
    expect(await own(() => db.query<{ d: boolean }>(`select public.discovery_flush_package($1) as d`, [id]))).toMatchObject({ rows: [{ d: true }] });
    expect(await pending(id)).toBeNull();
    expect((await db.query<{ t: string }>(`select title t from public.discovery_courses where package_id = $1`, [id])).rows[0]!.t).toBe("Renamed anyway");
    await expectProjectionEqualsRebuild();
  });

  it("[P5.A.1.h] a course-only edit of a 3,000-element course rewrites no element row", async () => {
    const id = await seedPackage(db, { owner, listed: true, title: "Big" });
    await seedShared(id, "doc-big3k-", 3000);
    const stamp = `select max(projected_at) m, count(*) n from public.discovery_elements where package_id = $1`;
    const before = (await db.query<{ m: Date; n: number }>(stamp, [id])).rows[0]!;
    expect(Number(before.n)).toBe(3000);
    const t = performance.now();
    await own(() => db.query(`update public.packages set manifest = jsonb_set(manifest, '{description}', '"new words"') where id = $1`, [id]));
    console.info(`[r2c M-D1] course description edit on 3,000 elements: ${(performance.now() - t).toFixed(0)} ms`);
    const after = (await db.query<{ m: Date }>(stamp, [id])).rows[0]!;
    expect(after.m).toEqual(before.m);
    expect((await db.query<{ d: string }>(`select description d from public.discovery_courses where package_id = $1`, [id])).rows[0]!.d).toBe("new words");
    expect(await pending(id)).toBeNull();
  });

  it("[P5.A.1.h] a rename of a 3,000-element course updates the course row in the write and queues the elements; the owner's flush drains them in chunks", async () => {
    const id = await seedPackage(db, { owner, listed: true, title: "Big Two" });
    await seedShared(id, "doc-big3r-", 3000);
    let t = performance.now();
    await own(() => db.query(`update public.packages set manifest = jsonb_set(manifest, '{title}', '"Renamed Big"') where id = $1`, [id]));
    console.info(`[r2c M-D1] rename of a 3,000-element course (write): ${(performance.now() - t).toFixed(0)} ms`);
    expect((await db.query<{ t: string }>(`select title t from public.discovery_courses where package_id = $1`, [id])).rows[0]!.t).toBe("Renamed Big");
    expect(await pending(id)).toMatchObject({ doc_ids: null });
    // a stranger's flush is a no-op that says nothing
    expect((await own(() => db.query<{ d: boolean }>(`select public.discovery_flush_package($1) as d`, [id]), stranger)).rows[0]!.d).toBe(true);
    expect(await pending(id)).not.toBeNull();
    let calls = 0;
    for (;;) {
      t = performance.now();
      const done = (await own(() => db.query<{ d: boolean }>(`select public.discovery_flush_package($1) as d`, [id]))).rows[0]!.d;
      calls++;
      console.info(`[r2c M-D1]   flush call ${calls}: ${(performance.now() - t).toFixed(0)} ms`);
      if (done) break;
      expect(calls).toBeLessThan(10);
    }
    expect((await db.query<{ n: number }>(
      `select count(*)::int n from public.discovery_elements where package_id = $1 and package_title = 'Renamed Big'`, [id])).rows[0]!.n).toBe(3000);
    await expectProjectionEqualsRebuild();
  });

  it("[P5.A.1.h] the queue and the service flush are not the API's: anon cannot flush, authenticated cannot read the queue or drain others", async () => {
    await expect(asRole(db, "anon", () => db.query(`select public.discovery_flush_package('x')`))).rejects.toThrow();
    await expect(own(() => db.query(`select * from public.discovery_pending`))).rejects.toThrow();
    await expect(own(() => db.query(`select public.discovery_flush_pending()`))).rejects.toThrow();
    await expect(own(() => db.query(`select public.discovery_refresh_bounded('x')`))).rejects.toThrow();
    await asRole(db, "service_role", () => db.query(`select public.discovery_flush_pending()`));
  });
});

// ---------------------------------------------------------------------------
// L-D1 — concept map
// ---------------------------------------------------------------------------
describe("L-D1 the concept map: a rename away re-projects; a save touches the course row only", () => {
  it("[P5.A.1.p] renaming concepts/course.md away by UPDATE drops its topics (incremental = rebuild)", async () => {
    const id = await seedPackage(db, { owner, listed: true, title: "Concepts" });
    await seedDoc(db, { packageId: id });
    await db.query(`insert into public.sandbox_files (package_id, repo, path, content) values ($1, 'public', 'concepts/course.md', '# Acids\n## Bases\n')`, [id]);
    expect((await db.query<{ t: string[] }>(`select topics t from public.discovery_courses where package_id = $1`, [id])).rows[0]!.t).toEqual(["Acids", "Bases"]);
    const stamp = (await db.query<{ m: Date }>(`select max(projected_at) m from public.discovery_elements where package_id = $1`, [id])).rows[0]!.m;
    await db.query(`update public.sandbox_files set content = '# Acids\n## Salts\n' where package_id = $1 and path = 'concepts/course.md'`, [id]);
    expect((await db.query<{ t: string[] }>(`select topics t from public.discovery_courses where package_id = $1`, [id])).rows[0]!.t).toEqual(["Acids", "Salts"]);
    expect((await db.query<{ m: Date }>(`select max(projected_at) m from public.discovery_elements where package_id = $1`, [id])).rows[0]!.m).toEqual(stamp);
    await db.query(`update public.sandbox_files set path = 'concepts/old-course.md' where package_id = $1 and path = 'concepts/course.md'`, [id]);
    expect((await db.query<{ t: string[] }>(`select topics t from public.discovery_courses where package_id = $1`, [id])).rows[0]!.t).toEqual([]);
    await expectProjectionEqualsRebuild();
  });
});

// ---------------------------------------------------------------------------
// L-D2 — one refresh per package at a time
// ---------------------------------------------------------------------------
describe("L-D2 a package is refreshed by one transaction at a time", () => {
  it("[P5.A.1.q] a refresh holds the package's advisory lock to the end of its transaction; a rebuild holds none", async () => {
    const id = await seedPackage(db, { owner, listed: true, title: "Locked" });
    await seedDoc(db, { packageId: id });
    const advisory = `select count(*)::int n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()`;
    await db.exec(`begin`);
    await db.query(`select public.discovery_refresh_package($1)`, [id]);
    const held = (await db.query<{ n: number }>(advisory)).rows[0]!.n;
    await db.exec(`rollback`);
    expect(held).toBe(1);
    await db.exec(`begin`);
    await db.query(`select public.discovery_rebuild()`);
    const duringRebuild = (await db.query<{ n: number }>(advisory)).rows[0]!.n;
    await db.exec(`rollback`);
    expect(duringRebuild).toBe(0); // thousands of packages must not fill the lock table
    // (PGlite is one connection: a second transaction contending for the lock
    // cannot be staged here; the losing path is discovery_pend, exercised above.)
  });
});

// ---------------------------------------------------------------------------
// M-D3 — registered_at changes (moot since 0028_loop_r2_1)
// ---------------------------------------------------------------------------
describe("M-D3 a registered_at change cannot desynchronise the projection", () => {
  it("[P5.A.1.n] kept: an UPDATE of documents.registered_at (owner or service) changes nothing, so the update trigger needs no such filter", async () => {
    const id = await seedPackage(db, { owner, listed: true, title: "Recency" });
    const doc = await seedDoc(db, { packageId: id });
    const before = (await db.query<{ r: Date }>(`select registered_at r from public.documents where doc_id = $1`, [doc])).rows[0]!.r;
    await own(() => db.query(`update public.documents set registered_at = '2020-01-01' where doc_id = $1`, [doc]));
    await asRole(db, "service_role", () => db.query(`update public.documents set registered_at = '2020-01-01' where doc_id = $1`, [doc]));
    await db.query(`update public.documents set registered_at = '2020-01-01' where doc_id = $1`, [doc]);
    expect((await db.query<{ r: Date }>(`select registered_at r from public.documents where doc_id = $1`, [doc])).rows[0]!.r).toEqual(before);
    await expectProjectionEqualsRebuild();
  });
});

// ---------------------------------------------------------------------------
// MEDIUM-1 — documents_apply keeps what the owner set
// ---------------------------------------------------------------------------
describe("MEDIUM-1 a registration run never overwrites what the owner set meanwhile", () => {
  it("[P5.B.1.t] a share + description committed between the run's read and its documents_apply survive (sharerace, database side)", async () => {
    const id = await seedPackage(db, { owner, storage: "sandbox", title: "Race" });
    const registry = new PgRegistry(db, owner);
    const store = new MemoryPackageStore(registry);
    await store.createPackage({ packageId: id, ownerId: owner, title: "Race", manifest: {} as never, storage: "sandbox" },
      [{ repo: "public", path: "assets/fig.svg", content: "<svg>1</svg>" }]);
    await rebuildPackageRegistry(registry, store, id, "created");
    const r0 = (await registry.listLiveByPackage(id))[0]!;
    // the owner's "Share this" lands between the save's read and its write
    registry.beforeNextApply = async () => {
      await own(() => db.query(`update public.documents set discoverable = true, description = 'Titration curve', tags = '{acid}', alt_text = 'a curve', license = 'CC0-1.0' where doc_id = $1`, [r0.docId]));
    };
    await writeThrough(store, null, id, { summary: "s", changes: [{ repo: "public", path: "assets/fig.svg", content: "<svg>2</svg>" }] });
    const r1 = (await db.query(`select discoverable, description, tags, alt_text, license, source_hash from public.documents where doc_id = $1`, [r0.docId])).rows[0];
    expect(r1).toMatchObject({ discoverable: true, description: "Titration curve", tags: ["acid"], alt_text: "a curve", license: "CC0-1.0" });
    expect((r1 as { source_hash: string }).source_hash).not.toBe(r0.sourceHash);
  });

  it("[P5.B.1.t] a resurrected (tombstoned) row takes the run's values", async () => {
    const id = await seedPackage(db, { owner, storage: "sandbox", title: "Resurrect" });
    const doc = await seedDoc(db, { packageId: id, discoverable: true, description: "old words", tombstoned: true });
    const row = { doc_id: doc, package_id: id, repo: "public", path: "assets/again.svg", space: "assets", kind: "svg",
      source_hash: "h2", origin: "uploaded", permalink_class: "object", discoverable: false, description: null };
    await own(() => db.query(`select public.documents_apply($1, '{}', $2::jsonb)`, [id, JSON.stringify([row])]));
    expect((await db.query(`select tombstoned, discoverable, description from public.documents where doc_id = $1`, [doc])).rows[0])
      .toEqual({ tombstoned: false, discoverable: false, description: null });
  });
});

// ---------------------------------------------------------------------------
// MEDIUM-3 — a 3,000-file registration, statement by statement
// ---------------------------------------------------------------------------
describe("MEDIUM-3 a 3,000-file registration stays within the signed-in statement timeout", () => {
  it("[P5.B.1.u] the first registration of 3,000 shared files: ≤ 500 rows and well under 8 s per statement", async () => {
    const id = await seedPackage(db, { owner, listed: true, title: "Upload 3k" });
    const registry = new PgRegistry(db, owner);
    const store = new MemoryPackageStore(registry);
    await store.createPackage({ packageId: id, ownerId: owner, title: "Upload 3k", manifest: {} as never, storage: "github" },
      Array.from({ length: 3000 }, (_, i) => ({ repo: "public" as const, path: `assets/u${i}.svg`, content: `<svg>${i}</svg>` })));
    await rebuildPackageRegistry(registry, store, id, "uploaded");
    expect(registry.applyRows.length).toBe(6);
    expect(Math.max(...registry.applyRows)).toBeLessThanOrEqual(500);
    // then every file shared and re-registered with new bytes (the projector runs in each statement)
    await db.query(`update public.documents set discoverable = true, description = 'shared figure' where package_id = $1`, [id]);
    registry.applyMs.length = 0;
    for (const f of await store.listFiles(id)) await store.putFiles(id, [{ ...f, content: f.content + " " }]);
    await rebuildPackageRegistry(registry, store, id, "external-commit");
    const worst = Math.max(...registry.applyMs);
    console.info(`[r2c MEDIUM-3] 3,000 changed shared files: ${registry.applyMs.length} statements, worst ${worst.toFixed(0)} ms`);
    expect(worst).toBeLessThan(8000);
    expect((await db.query<{ n: number }>(`select count(*)::int n from public.discovery_elements where package_id = $1`, [id])).rows[0]!.n).toBe(3000);
  }, 180_000);
});

// ---------------------------------------------------------------------------
// HIGH-A — composes with the retired-id ledger (0028_loop_r2_2)
// ---------------------------------------------------------------------------
describe("HIGH-A a dormant uid never displaces — with the retired-id ledger", () => {
  const carrier = (uid: string, body: string) =>
    `<!doctype html><html><head><script type="application/orz-meta+json" id="orz-meta">{"title":"T","uid":"${uid}"}</script></head><body>${body}</body></html>`;

  it("[P5.B.1.s] a fork's copy keeps its id after the source course is deleted (its uid is retired → taken) (crossflip)", async () => {
    const S = await seedPackage(db, { owner, storage: "sandbox", title: "Source" });
    const F = await seedPackage(db, { owner, storage: "sandbox", title: "Fork" });
    const u = "doc-xflipxflip01";
    const reg = new PgRegistry(db, owner);
    const sStore = new MemoryPackageStore(reg);
    const fStore = new MemoryPackageStore(reg);
    await sStore.createPackage({ packageId: S, ownerId: owner, title: "S", manifest: {} as never, storage: "sandbox" },
      [{ repo: "public", path: "practice/a.md.html", content: carrier(u, "src") }]);
    await rebuildPackageRegistry(reg, sStore, S, "created");
    await fStore.createPackage({ packageId: F, ownerId: owner, title: "F", manifest: {} as never, storage: "sandbox" },
      [{ repo: "public", path: "practice/a.md.html", content: carrier(u, "fork") }]);
    await rebuildPackageRegistry(reg, fStore, F, "created");
    const forkId = (await reg.listLiveByPackage(F))[0]!.docId;
    expect(forkId).not.toBe(u);
    await db.query(`delete from public.packages where id = $1`, [S]); // documents cascade; u is retired
    await writeThrough(fStore, null, F, { summary: "s", changes: [{ repo: "public", path: "practice/a.md.html", content: carrier(u, "fork edited") }] });
    const rows = (await db.query<{ doc_id: string; tombstoned: boolean }>(`select doc_id, tombstoned from public.documents where package_id = $1`, [F])).rows;
    expect(rows).toEqual([{ doc_id: forkId, tombstoned: false }]);
  });

  it("[P5.B.1.s] a copy keeps its permalink after the original (same package) is deleted and the copy saved (uidflip, database side)", async () => {
    const P = await seedPackage(db, { owner, storage: "sandbox", title: "Flip" });
    const U = "doc-uidflipuid01";
    const reg = new PgRegistry(db, owner);
    const store = new MemoryPackageStore(reg);
    await store.createPackage({ packageId: P, ownerId: owner, title: "P", manifest: {} as never, storage: "sandbox" },
      [{ repo: "public", path: "practice/a.md.html", content: carrier(U, "orig") }]);
    await rebuildPackageRegistry(reg, store, P, "created");
    const w = (path: string, content: string | null) =>
      writeThrough(store, null, P, { summary: "s", changes: [{ repo: "public", path, content }] });
    await w("practice/b.md.html", carrier(U, "copy"));
    const copyId = (await reg.getByLocation(P, "public", "practice/b.md.html"))!.docId;
    await w("practice/a.md.html", null);
    await w("practice/b.md.html", carrier(U, "copy edited"));
    expect((await reg.getByLocation(P, "public", "practice/b.md.html"))!.docId).toBe(copyId);
    expect((await db.query<{ t: boolean }>(`select tombstoned t from public.documents where doc_id = $1`, [copyId])).rows[0]!.t).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Composition — the live definitions keep every earlier round's rules
// ---------------------------------------------------------------------------
describe("composition: no migration silently reverted an earlier fix", () => {
  const src = async (name: string) =>
    (await db.query<{ s: string; definer: boolean }>(
      `select prosrc s, prosecdef definer from pg_proc where pronamespace = 'public'::regnamespace and proname = $1`, [name])).rows;

  it("[P5.A.1.r] discovery_refresh_package carries r1 trust, r1b guards/scope/recency, r2 clamps and r2c bounds/lock", async () => {
    const [def] = await src("discovery_refresh_package");
    expect(def).toBeDefined();
    for (const marker of [
      "v_pkg.a11y_status", // r1 M2: server-recorded a11y
      "v_pkg.public_repo ->> 'owner'", // r1 M2: recorded repo
      "ap.owner_id <> v_pkg.owner_id", // r1 M2: other educators only
      "ap.storage = 'github' and ap.archived_at is null", // r1 M2: published adapters
      "is distinct from", // r1b: skip-unchanged guard
      "p_doc_ids", // r1b: doc scope
      "x.content_changed_at", // r1b: base-table recency
      "v_pkg.listing_changed_at",
      "least(x.registered_at, now())", // r2 NEW-2 clamps
      "least(greatest(v_reg.registered_at", // r2 NEW-2
      "least(v_reg.registered_at, now())",
      "left(nullif(btrim(d.description), ''), 4000)", // r2c H-D1
      "pg_try_advisory_xact_lock", // r2c L-D2
    ]) {
      expect(def!.s, marker).toContain(marker);
    }
  });

  it("[P5.A.1.r] the registry functions keep r1b atomicity/scope, r2 ownership/retired ids, r2c owner-set rules", async () => {
    const [apply] = await src("documents_apply");
    expect(apply!.definer).toBe(false); // SECURITY INVOKER: the caller's RLS
    for (const marker of ["discovery_defer_begin", "discovery_defer_end", "package_id = excluded.package_id",
      "when d.tombstoned then excluded.discoverable else d.discoverable"]) {
      expect(apply!.s, marker).toContain(marker);
    }
    const [foreign] = await src("documents_foreign_doc_ids");
    for (const marker of ["caller_owns_package", "retired_ids", "[1:500]"]) expect(foreign!.s, marker).toContain(marker);
    const [adapt] = await src("discovery_course_adaptations");
    expect(adapt!.s).toContain("ad.repo = 'public' and not ad.tombstoned"); // r2 LOW-4
    const [pk] = await src("discovery_on_packages");
    for (const marker of ["new.a11y_status", "new.public_repo", "new.owner_id is distinct from old.owner_id", "discovery_element_key"]) {
      expect(pk!.s, marker).toContain(marker);
    }
    for (const fn of ["discovery_refresh_safe", "discovery_drain_queue"]) {
      const [d] = await src(fn);
      expect(d!.s, fn).toContain("when query_canceled");
      expect(d!.s, fn).toContain("discovery_refresh_bounded");
    }
  });

  it("[P5.A.1.r] every trigger of rounds r1b, r2 and r2c is installed", async () => {
    const { rows } = await db.query<{ t: string }>(
      `select tgrelid::regclass || '.' || tgname as t from pg_trigger where not tgisinternal`);
    const have = new Set(rows.map((r) => r.t));
    for (const t of [
      "documents.documents_content_changed_at", "packages.packages_listing_changed_at", // r1b
      "documents.documents_no_cross_package_move", "discovery_refresh_queue.discovery_refresh_queue_drain",
      "documents.documents_registered_at", "portal_registrations.portal_registrations_registered_at", // r2
      "documents.documents_retire_ids", "packages.packages_retire_ids",
      "documents.documents_refuse_retired_id", "packages.packages_refuse_retired_id",
      "documents.discovery_documents_insert", "documents.discovery_documents_update", "documents.discovery_documents_delete",
      "packages.discovery_packages", "portal_registrations.discovery_registrations",
      "sandbox_files.discovery_concept_map_write", "sandbox_files.discovery_concept_map_update", // r2c
      "sandbox_files.discovery_concept_map_delete",
    ]) {
      expect(have.has(t), t).toBe(true);
    }
  });

  it("[P5.A.1.r] the internal projector functions stay closed to the API roles", async () => {
    for (const fn of [
      "discovery_refresh_package(text, boolean, text[])", "discovery_refresh_bounded(text, boolean, text[])",
      "discovery_refresh_safe(text, boolean, text[])", "discovery_pend(text, boolean, text[])",
      "discovery_flush_one(text, interval)", "discovery_flush_pending(integer, interval)",
      "discovery_rebuild()", "discovery_rebuild_report()",
    ]) {
      for (const role of ["anon", "authenticated"]) {
        const ok = (await db.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') ok`, [role, `public.${fn}`])).rows[0]!.ok;
        expect(ok, `${role} ${fn}`).toBe(false);
      }
    }
  });
});
