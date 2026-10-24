/**
 * Closed loop r3 (round-3 audits, 2026-10-24) — H3-1 (P5.B.1.x): shifts, swaps and cycles of paths land in ONE documents_apply
 * (0030_loop_r3c_1), and documents_apply keeps every earlier rule (P5.A.1.r).
 * On the Supabase-shaped harness (non-superuser owner, every migration in a
 * fresh session — P5.S.13). Each block failed on main (edc0d06, migrations
 * through 0029_loop_r2c_3) unless it says it pins kept behaviour, and passes
 * with migrations 0030_loop_r3c_*.
 *
 *   repros /tmp/p5r3/shift.mts, swap.mts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { MemoryPackageStore, rebuildPackageRegistry, writeThrough } from "@alembic/package-ops";
import { asRole, freshDatabase, seedDoc, seedPackage, seedUser } from "./discovery-pglite";
import { PgRegistry } from "./pglite-registry";

vi.mock("./discovery-cache", () => ({ discoveryChanged: () => {} }));
vi.setConfig({ testTimeout: 120_000 });

let db: PGlite;
let owner: string;

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "edu");
}, 120_000);
afterAll(async () => {
  await db?.close();
});

const own = <T,>(fn: () => Promise<T>, user = owner) => asRole(db, "authenticated", fn, user);
const refused = async (fn: () => Promise<unknown>): Promise<string | null> => {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};
const carrier = (uid: string | null, body: string) =>
  `<!doctype html><html><head><script type="application/orz-meta+json" id="orz-meta">{"title":"T"${uid ? `,"uid":"${uid}"` : ""}}</script></head><body>${body}</body></html>`;

// ---------------------------------------------------------------------------
// H3-1 — moves along a chain land in one call
// ---------------------------------------------------------------------------
describe("H3-1 every uid's permalink follows its bytes under any shift, swap or cycle (database side)", () => {
  async function course(title: string, files: Array<{ path: string; uid: string | null; body: string }>) {
    const id = await seedPackage(db, { owner, storage: "sandbox", title });
    const registry = new PgRegistry(db, owner);
    const store = new MemoryPackageStore(registry);
    await store.createPackage({ packageId: id, ownerId: owner, title, manifest: {} as never, storage: "sandbox" },
      files.map((f) => ({ repo: "public" as const, path: f.path, content: carrier(f.uid, f.body) })));
    await rebuildPackageRegistry(registry, store, id, "created");
    const where = async () =>
      Object.fromEntries((await db.query<{ doc_id: string; path: string }>(
        `select doc_id, path from public.documents where package_id = $1 and not tombstoned`, [id])).rows.map((r) => [r.doc_id, r.path]));
    return { id, registry, store, where };
  }

  it("[P5.B.1.x] inserting a chapter: X moves ch2→ch3 and Y ch3→ch4 in one write (shift)", async () => {
    const [W, X, Y] = ["doc-r3cshiftw01", "doc-r3cshiftx01", "doc-r3cshifty01"];
    const c = await course("Shift", [
      { path: "study-guide/ch1.md.html", uid: W, body: "ONE" },
      { path: "study-guide/ch2.md.html", uid: X, body: "TWO-acids" },
      { path: "study-guide/ch3.md.html", uid: Y, body: "THREE-bases" },
    ]);
    await writeThrough(c.store, null, c.id, { summary: "insert a chapter", changes: [
      { repo: "public", path: "study-guide/ch2.md.html", content: carrier(null, "NEW-buffers") },
      { repo: "public", path: "study-guide/ch3.md.html", content: carrier(X, "TWO-acids") },
      { repo: "public", path: "study-guide/ch4.md.html", content: carrier(Y, "THREE-bases") },
    ] });
    const at = await c.where();
    expect(at[X]).toBe("study-guide/ch3.md.html");
    expect(at[Y]).toBe("study-guide/ch4.md.html");
    expect(at[W]).toBe("study-guide/ch1.md.html");
    expect(Object.keys(at)).toHaveLength(4);
    expect((await db.query(`select count(*)::int n from public.documents where package_id = $1 and tombstoned`, [c.id])).rows[0]).toEqual({ n: 0 });
  });

  it("[P5.B.1.x] two carriers swap paths in one write, and a three-way rotation, each in ONE documents_apply (swap, cycle)", async () => {
    const [A, B] = ["doc-r3cswapa001", "doc-r3cswapb001"];
    const c = await course("Swap", [
      { path: "practice/a.md.html", uid: A, body: "ALPHA" },
      { path: "practice/b.md.html", uid: B, body: "BETA" },
    ]);
    c.registry.applyRows.length = 0;
    await writeThrough(c.store, null, c.id, { summary: "swap", changes: [
      { repo: "public", path: "practice/a.md.html", content: carrier(B, "BETA") },
      { repo: "public", path: "practice/b.md.html", content: carrier(A, "ALPHA") },
    ] });
    expect(await c.where()).toEqual({ [A]: "practice/b.md.html", [B]: "practice/a.md.html" });
    expect(c.registry.applyRows).toEqual([2]); // one call, no split, no retry

    const ids = ["doc-r3ccycle001", "doc-r3ccycle002", "doc-r3ccycle003"];
    const r = await course("Cycle", ids.map((u, i) => ({ path: `practice/q${i}.md.html`, uid: u, body: `Q${i}` })));
    await writeThrough(r.store, null, r.id, { summary: "rotate", changes:
      ids.map((u, i) => ({ repo: "public" as const, path: `practice/q${(i + 1) % 3}.md.html`, content: carrier(u, `Q${i}`) })) });
    expect(await r.where()).toEqual({ [ids[0]!]: "practice/q1.md.html", [ids[1]!]: "practice/q2.md.html", [ids[2]!]: "practice/q0.md.html" });
  });

  it("[P5.B.1.x] documents_apply parks moving rows: a swap in one call lands; a move onto a location still held by an unmoved row is refused, nothing changes", async () => {
    const id = await seedPackage(db, { owner, storage: "sandbox", title: "Park" });
    const a = await seedDoc(db, { packageId: id, docId: "doc-r3cparka001", path: "assets/a.svg" });
    const b = await seedDoc(db, { packageId: id, docId: "doc-r3cparkb001", path: "assets/b.svg" });
    await seedDoc(db, { packageId: id, docId: "doc-r3cparkc001", path: "assets/c.svg" });
    const row = (doc: string, path: string) => ({ doc_id: doc, package_id: id, repo: "public", path, space: "assets", kind: "svg",
      source_hash: "h1", origin: "created", permalink_class: "object" });
    await own(() => db.query(`select public.documents_apply($1, '{}', $2::jsonb)`, [id, JSON.stringify([row(a, "assets/b.svg"), row(b, "assets/a.svg")])]));
    const paths = async () => (await db.query<{ doc_id: string; path: string }>(`select doc_id, path from public.documents where package_id = $1 order by doc_id`, [id])).rows;
    expect(await paths()).toEqual([
      { doc_id: a, path: "assets/b.svg" }, { doc_id: b, path: "assets/a.svg" }, { doc_id: "doc-r3cparkc001", path: "assets/c.svg" }]);
    const msg = await refused(() => own(() => db.query(`select public.documents_apply($1, '{}', $2::jsonb)`, [id, JSON.stringify([row(a, "assets/c.svg")])])));
    expect(msg).toMatch(/documents_location_idx/);
    expect(await paths()).toEqual([
      { doc_id: a, path: "assets/b.svg" }, { doc_id: b, path: "assets/a.svg" }, { doc_id: "doc-r3cparkc001", path: "assets/c.svg" }]);
    expect((await db.query(`select count(*)::int n from public.documents where path like '.alembic-moving/%'`)).rows[0]).toEqual({ n: 0 });
  });
});


describe("composition r3c (registry): no migration silently reverted an earlier fix", () => {
  const src = async (name: string) =>
    (await db.query<{ s: string; definer: boolean }>(
      `select prosrc s, prosecdef definer from pg_proc where pronamespace = 'public'::regnamespace and proname = $1`, [name])).rows;

  it("[P5.A.1.r] documents_apply keeps r1b atomicity/scope, r2c owner-set rules, and parks moving rows (r3c)", async () => {
    const [apply] = await src("documents_apply");
    expect(apply!.definer).toBe(false);
    for (const marker of ["discovery_defer_begin", "discovery_defer_end", "package_id = excluded.package_id",
      "every row must belong to package", "when d.tombstoned then excluded.discoverable else d.discoverable",
      "coalesce(d.adapted_from, excluded.adapted_from)", "registered_at = d.registered_at",
      "'.alembic-moving/' || d.doc_id"]) {
      expect(apply!.s, marker).toContain(marker);
    }
    // the parking step comes after the tombstones and before the upsert
    expect(apply!.s.indexOf("set tombstoned = true")).toBeLessThan(apply!.s.indexOf(".alembic-moving/"));
    expect(apply!.s.indexOf(".alembic-moving/")).toBeLessThan(apply!.s.indexOf("on conflict (doc_id)"));
  });
});
