/**
 * Track A.1 — the cost of keeping the discovery projection fresh, against a
 * real Postgres (PGlite with every migration applied). Claim P5.A.1.m: a
 * one-file save rewrites at most the changed element rows, and one registry
 * flush (tombstones + one upsert, inside discovery_defer_begin/end) refreshes
 * each touched package exactly once.
 *
 * Refreshes are counted with `pg_stat_xact_user_functions` (calls of
 * `discovery_refresh_package` inside the flush's own transaction); rewrites
 * with `pg_stat_xact_user_tables.n_tup_upd` and `projected_at` bumps.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let owner: string;
let pkg: string;
const N = 333;

async function seedShared(packageId: string, prefix: string, n: number) {
  await db.query(
    `insert into public.documents (doc_id, package_id, repo, path, space, kind, source_hash, origin,
       description, tags, discoverable, permalink_class)
     select $2 || g, $1, 'public', 'assets/' || $2 || g || '.svg', 'assets', 'svg', 'h' || g, 'created',
       'A titration curve number ' || g, '{acid,base}', true, 'object'
     from generate_series(1, $3) g`,
    [packageId, prefix, n],
  );
}

async function elementUpdates(tx: Transaction | PGlite): Promise<number> {
  const { rows } = await tx.query<{ n: string | number | null }>(
    `select n_tup_upd as n from pg_stat_xact_user_tables where relname = 'discovery_elements'`,
  );
  return Number(rows[0]?.n ?? 0);
}

async function refreshCalls(tx: Transaction | PGlite): Promise<number> {
  const { rows } = await tx.query<{ c: string | number }>(
    `select coalesce(sum(calls), 0) as c from pg_stat_xact_user_functions
     where funcname = 'discovery_refresh_package'`,
  );
  return Number(rows[0]!.c);
}

beforeAll(async () => {
  db = await freshDatabase();
  await db.exec(`set track_functions = 'all'`);
  owner = await seedUser(db);
  pkg = await seedPackage(db, { owner, listed: true, title: "Big Course" });
  await seedShared(pkg, "doc-big-", N);
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("A.1 cost: a save touches only what changed", () => {
  it(`[P5.A.1.m] a one-file save on a ${N}-element course rewrites only the changed element row`, async () => {
    const { rows } = await db.query<{ m: Date }>(
      `select max(projected_at) as m from public.discovery_elements where package_id = $1`,
      [pkg],
    );
    const before = rows[0]!.m;
    const updated = await db.transaction(async (tx) => {
      const u0 = await elementUpdates(tx);
      await tx.query(`update public.documents set source_hash = source_hash || 'x' where doc_id = 'doc-big-5'`);
      return (await elementUpdates(tx)) - u0;
    });
    expect(updated).toBe(1);
    const rewritten = await db.query<{ doc_id: string }>(
      `select doc_id from public.discovery_elements where package_id = $1 and projected_at > $2`,
      [pkg, before],
    );
    expect(rewritten.rows.map((r) => r.doc_id)).toEqual(["doc-big-5"]);
    expect(
      (await db.query(`select count(*)::int as n from public.discovery_elements where package_id = $1`, [pkg])).rows,
    ).toEqual([{ n: N }]);
  });

  it(`[P5.A.1.m] an unchanged ${N}-row re-registration (bulk upsert) rewrites no projection row`, async () => {
    const updated = await db.transaction(async (tx) => {
      const u0 = await elementUpdates(tx);
      // A description re-written to the same value: the trigger refreshes, the
      // projector finds nothing changed.
      await tx.query(
        `insert into public.documents select * from public.documents where package_id = $1
         on conflict (doc_id) do update set description = excluded.description || ''`,
        [pkg],
      );
      await tx.query(`update public.documents set tags = tags where package_id = $1`, [pkg]);
      await tx.query(`select public.discovery_refresh_package($1)`, [pkg]);
      return (await elementUpdates(tx)) - u0;
    });
    expect(updated).toBe(0);
  });

  it("[P5.A.1.m] a description edit rewrites that element row only", async () => {
    const updated = await db.transaction(async (tx) => {
      const u0 = await elementUpdates(tx);
      await tx.query(`update public.documents set description = 'A new caption for the curve' where doc_id = 'doc-big-9'`);
      return (await elementUpdates(tx)) - u0;
    });
    expect(updated).toBe(1);
    const { rows } = await db.query<{ title: string }>(
      `select title from public.discovery_elements where doc_id = 'doc-big-9'`,
    );
    expect(rows[0]!.title).toBe("A new caption for the curve");
  });
});

describe("A.1 cost: one registry flush, one refresh per package", () => {
  async function flush(tx: Transaction, tag: string, tombstone: string) {
    await tx.query(`update public.documents set tombstoned = true where package_id = $1 and doc_id = $2`, [
      pkg,
      tombstone,
    ]);
    await tx.query(
      `insert into public.documents (doc_id, package_id, repo, path, space, kind, source_hash, origin,
         tags, discoverable, permalink_class)
       values ('doc-new-' || $2, $1, 'public', 'assets/new-' || $2 || '.svg', 'assets', 'svg', 'hn', 'created',
               '{}', true, 'object'),
              ('doc-big-2', $1, 'public', 'assets/renamed-' || $2 || '.svg', 'assets', 'svg', 'h2', 'created',
               '{}', true, 'object')
       on conflict (doc_id) do update set path = excluded.path`,
      [pkg, tag],
    );
  }

  it("[P5.A.1.m] one registry flush (tombstone + upsert inside discovery_defer_begin/end) refreshes the package once", async () => {
    const calls = await db.transaction(async (tx) => {
      const c0 = await refreshCalls(tx);
      await tx.query(`select public.discovery_defer_begin()`);
      await flush(tx, "a", "doc-big-11");
      // Nothing projected yet: the refresh is queued.
      expect((await refreshCalls(tx)) - c0).toBe(0);
      await tx.query(`select public.discovery_defer_end()`);
      return (await refreshCalls(tx)) - c0;
    });
    expect(calls).toBe(1);
    const ids = (
      await db.query<{ doc_id: string; path: string }>(
        `select doc_id, path from public.discovery_elements where doc_id in ('doc-new-a', 'doc-big-2', 'doc-big-11') order by doc_id`,
      )
    ).rows;
    expect(ids).toEqual([
      { doc_id: "doc-big-2", path: "assets/renamed-a.svg" },
      { doc_id: "doc-new-a", path: "assets/new-a.svg" },
    ]);
    const { rows } = await db.query<{ element_count: number }>(
      `select element_count from public.discovery_courses where package_id = $1`,
      [pkg],
    );
    expect(rows[0]!.element_count).toBe(N); // +1 new, -1 tombstoned
  });

  it("[P5.A.1.m] a deferral left open is still flushed at commit (begin without end)", async () => {
    await db.transaction(async (tx) => {
      await tx.query(`select public.discovery_defer_begin()`);
      await flush(tx, "b", "doc-big-12");
    });
    const ids = (
      await db.query<{ doc_id: string }>(
        `select doc_id from public.discovery_elements where doc_id in ('doc-new-b', 'doc-big-12') order by doc_id`,
      )
    ).rows.map((r) => r.doc_id);
    expect(ids).toEqual(["doc-new-b"]);
    const q = await db.query(`select count(*)::int as n from public.discovery_refresh_queue`);
    expect(q.rows).toEqual([{ n: 0 }]);
  });

  it("[P5.A.1.m] without deferral each statement still refreshes (no lost update)", async () => {
    await db.query(`update public.documents set tombstoned = true where doc_id = 'doc-big-13'`);
    expect(
      (await db.query(`select 1 from public.discovery_elements where doc_id = 'doc-big-13'`)).rows,
    ).toHaveLength(0);
  });

  it("[P5.A.1.m] deferral control: authenticated and service_role may call begin/end, anon may not; the queue is private", async () => {
    for (const role of ["authenticated", "service_role"] as const) {
      await asRole(
        db,
        role,
        async () => {
          await db.query(`select public.discovery_defer_begin()`);
          await db.query(`select public.discovery_defer_end()`);
        },
        role === "authenticated" ? owner : undefined,
      );
    }
    await expect(asRole(db, "anon", () => db.query(`select public.discovery_defer_begin()`))).rejects.toThrow(
      /permission denied/i,
    );
    await expect(asRole(db, "anon", () => db.query(`select public.discovery_defer_end()`))).rejects.toThrow(
      /permission denied/i,
    );
    for (const role of ["anon", "authenticated"] as const) {
      for (const sql of [
        `select * from public.discovery_refresh_queue`,
        `insert into public.discovery_refresh_queue (txid, package_id) values (txid_current(), '${pkg}')`,
        `select public.discovery_refresh_safe('${pkg}')`,
        `select public.discovery_refresh_package('${pkg}')`,
      ]) {
        await expect(
          asRole(db, role, () => db.query(sql), role === "authenticated" ? owner : undefined),
        ).rejects.toThrow(/permission denied/i);
      }
    }
  });
});
