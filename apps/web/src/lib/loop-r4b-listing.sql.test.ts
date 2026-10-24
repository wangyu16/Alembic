/**
 * Closed loop r4, part B (round-4 security audit, 2026-10-24) — LOW-1 class a
 * (P5.S.3.h, P5.S.17): the anon-readable listing row follows every change of
 * the server's accessibility record, including a BEFORE trigger's
 * (0031_loop_r4b_3); and the r3c back-fills, unasserted until now (P5.S.3.i,
 * P5.S.1.h), are bound by an upgrade test.
 * On the Supabase-shaped harness (non-superuser owner, every migration in a
 * fresh session — P5.S.13). Each block failed on main (03bcb00, migrations
 * through 0030_loop_r3c_4) unless it says it pins kept behaviour, and passes
 * with 0031_loop_r4b_3.
 *
 *   repro /tmp/alembic-r4/a11y.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { applyMigrationsFrom, asRole, freshDatabase, seedDoc, seedPackage, seedUser } from "./discovery-pglite";

vi.mock("./discovery-cache", () => ({ discoveryChanged: () => {} }));
vi.setConfig({ testTimeout: 180_000 });

let db: PGlite;
let owner: string;

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "edu");
}, 180_000);
afterAll(async () => {
  await db?.close();
});

const own = <T,>(fn: () => Promise<T>, d: PGlite = db, user = owner) => asRole(d, "authenticated", fn, user);
const anonListing = async (d: PGlite, pkg: string) =>
  (await asRole(d, "anon", () => d.query<{ s: string }>(`select accessibility_status s from public.portal_registrations where package_id = $1`, [pkg]))).rows[0]?.s;

// ---------------------------------------------------------------------------
// LOW-1 — the listing row follows the expiry
// ---------------------------------------------------------------------------
describe("LOW-1 the listing row follows every change of the accessibility record", () => {
  it("[P5.S.3.h] a save that expires the check shows not checked on the anon-readable listing row too (a11y)", async () => {
    const p = await seedPackage(db, { owner, listed: true, title: "A11y listing" });
    await seedDoc(db, { packageId: p });
    await own(() => db.query(`update public.packages set last_synced_sha = 'c1' where id = $1`, [p]));
    await asRole(db, "service_role", () => db.query(`update public.packages set a11y_status = 'pass', a11y_checked_at = now(), a11y_checked_sha = 'c1' where id = $1`, [p]));
    expect(await anonListing(db, p)).toBe("pass");
    await own(() => db.query(`update public.packages set last_synced_sha = 'c2' where id = $1`, [p])); // a save moved the head
    expect((await db.query<{ s: string }>(`select a11y_status s from public.packages where id = $1`, [p])).rows[0]!.s).toBe("unknown");
    expect(await anonListing(db, p)).toBe("unknown"); // was: "pass" for bytes nobody checked
  });
});

// ---------------------------------------------------------------------------
// The class: no column-list trigger misses a BEFORE trigger's change
// ---------------------------------------------------------------------------
const columnTriggerMisses = async (d: PGlite): Promise<string[]> => {
  const { rows: listed } = await d.query<{ tbl: string; tgname: string; cols: string[] }>(`
    select c.relname tbl, t.tgname,
           array(select a.attname::text from unnest(t.tgattr::int2[]) k
                 join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = k) cols
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
      and (t.tgtype & 16) <> 0 and cardinality(t.tgattr::int2[]) > 0`);
  const { rows: before } = await d.query<{ tbl: string; tgname: string; src: string }>(`
    select c.relname tbl, t.tgname, p.prosrc src
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
    where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
      and (t.tgtype & 16) <> 0 and (t.tgtype & 2) <> 0 and (t.tgtype & 1) <> 0`);
  const misses: string[] = [];
  for (const l of listed) {
    for (const b of before.filter((x) => x.tbl === l.tbl && x.tgname !== l.tgname)) {
      for (const col of l.cols) {
        const assigns = new RegExp(`\\bnew\\.${col}\\s*:=|^\\s*new\\.${col}\\s*=(?!=)`, "im");
        if (assigns.test(b.src)) misses.push(`${l.tbl}.${l.tgname} (update of ${col}) misses ${b.tgname}`);
      }
    }
  }
  return misses;
};

describe("the class: an `update of <col>` trigger never misses a change a BEFORE trigger makes", () => {
  it("[P5.S.17] no trigger with a column list watches a column that a BEFORE UPDATE trigger of its table assigns", async () => {
    expect(await columnTriggerMisses(db)).toEqual([]);
  });

  it("[P5.S.17] the check is real: the r3c form of the listing trigger is flagged", async () => {
    const live = (await db.query<{ d: string }>(
      `select pg_get_triggerdef(oid) d from pg_trigger where tgname = 'packages_a11y_to_registration'`)).rows[0]!.d;
    await db.exec(`drop trigger packages_a11y_to_registration on public.packages;
      create trigger packages_a11y_to_registration after update of a11y_status on public.packages for each row
        when (new.a11y_status is distinct from old.a11y_status) execute function public.packages_a11y_to_registration();`);
    try {
      expect(await columnTriggerMisses(db)).toEqual([
        "packages.packages_a11y_to_registration (update of a11y_status) misses packages_a11y_expires",
      ]);
    } finally {
      await db.exec(`drop trigger packages_a11y_to_registration on public.packages; ${live};`); // as the migrations left it
    }
  });
});

// ---------------------------------------------------------------------------
// The r3c back-fills, on an upgrade
// ---------------------------------------------------------------------------
describe("upgrade: 0030_loop_r3c_4's back-fills", () => {
  // (The back-fill assertions pin kept behaviour of 0030_loop_r3c_4, unasserted
  // until now; the listing-row assertions after the head moves are LOW-1's.)
  it("[P5.S.3.i] [P5.S.1.h] a check recorded before the migration counts as checked at that head; a course listed before it keeps its first listing time", async () => {
    let old = await freshDatabase({ before: "0030_loop_r3c_4" });
    try {
      const o = await seedUser(old, "o");
      const checked = await seedPackage(old, { owner: o, listed: true, title: "Checked before" });
      await seedDoc(old, { packageId: checked });
      const never = await seedPackage(old, { owner: o, listed: true, title: "Never checked" });
      await old.query(`update public.packages set last_synced_sha = 'c9' where id in ($1, $2)`, [checked, never]);
      await old.query(`update public.packages set a11y_status = 'pass', a11y_checked_at = now() - interval '2 days' where id = $1`, [checked]);
      await old.exec(`alter table public.portal_registrations disable trigger portal_registrations_registered_at`);
      await old.query(`update public.portal_registrations set registered_at = now() - interval '10 days' where package_id = $1`, [checked]);
      await old.exec(`alter table public.portal_registrations enable trigger portal_registrations_registered_at`);
      const firstListed = (await old.query<{ t: Date }>(`select registered_at t from public.portal_registrations where package_id = $1`, [checked])).rows[0]!.t;

      old = await applyMigrationsFrom(old, "0030_loop_r3c_4");

      const pkg = async (id: string) => (await old.query<{ s: string; sha: string | null }>(
        `select a11y_status s, a11y_checked_sha sha from public.packages where id = $1`, [id])).rows[0]!;
      expect(await pkg(checked)).toEqual({ s: "pass", sha: "c9" }); // nothing flipped at deploy
      expect((await pkg(never)).sha).toBeNull();
      expect(await anonListing(old, checked)).toBe("pass");
      await own(() => old.query(`update public.packages set last_synced_sha = 'c10' where id = $1`, [checked]), old, o);
      expect((await pkg(checked)).s).toBe("unknown"); // the head moved past the audited bytes
      expect(await anonListing(old, checked)).toBe("unknown");

      // unlist and list again: the first listing (before the migration) is kept
      await own(() => old.query(`delete from public.portal_registrations where package_id = $1`, [checked]), old, o);
      await asRole(old, "service_role", () => old.query(
        `insert into public.portal_registrations (package_id, owner_id, title, license, public_repo_url, site_url) values ($1, $2, 't', 'CC-BY-4.0', 'u', 's')`, [checked, o]));
      expect((await old.query<{ t: Date }>(`select registered_at t from public.portal_registrations where package_id = $1`, [checked])).rows[0]!.t)
        .toEqual(firstListed);
    } finally {
      await old.close();
    }
  });
});

describe("composition r4b (listing): no migration silently reverted an earlier fix", () => {
  it("[P5.A.1.r] the listing triggers of r3c are installed, the accessibility one without a column list", async () => {
    const { rows } = await db.query<{ t: string; ncols: number; fn: string; when: string }>(
      `select tgrelid::regclass || '.' || tgname as t, cardinality(tgattr::int2[]) ncols, tgfoid::regproc::text fn,
              pg_get_triggerdef(oid) as when
       from pg_trigger where not tgisinternal`);
    const have = new Map(rows.map((r) => [r.t, r]));
    for (const t of ["portal_registrations.portal_registrations_a11y", "packages.packages_a11y_expires",
      "portal_registrations.portal_registrations_registered_at_first", "packages.packages_a11y_to_registration"]) {
      expect(have.has(t), t).toBe(true);
    }
    const listing = have.get("packages.packages_a11y_to_registration")!;
    expect(listing.ncols).toBe(0);
    expect(listing.fn).toBe("packages_a11y_to_registration");
    expect(listing.when).toContain("new.a11y_status IS DISTINCT FROM old.a11y_status");
    expect(listing.when).toMatch(/AFTER UPDATE ON public\.packages/);
  });
});
