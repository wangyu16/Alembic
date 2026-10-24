/**
 * Closed loop r3 (round-3 audits, 2026-10-24) — security LOW-3 (P5.S.3.h), LOW-4 (P5.S.3.i), LOW-5 (P5.S.1.h): the listing's
 * accessibility and recency signals are the server's (0030_loop_r3c_4).
 * On the Supabase-shaped harness (non-superuser owner, every migration in a
 * fresh session — P5.S.13). Each block failed on main (edc0d06, migrations
 * through 0029_loop_r2c_3) unless it says it pins kept behaviour, and passes
 * with migrations 0030_loop_r3c_*.
 *
 *   (round-3 security audit)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedDoc, seedPackage, seedUser } from "./discovery-pglite";

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

// ---------------------------------------------------------------------------
// LOW-3 / LOW-4 / LOW-5 (security r3) — the listing's signals are the server's
// ---------------------------------------------------------------------------
describe("LOW-3/4/5 the listing's accessibility and recency are the server's", () => {
  it("[P5.S.3.h] the listing row's accessibility status is the server's check, whatever the writer sends, and follows a new check", async () => {
    const p = await seedPackage(db, { owner, title: "A11y snap", a11y: "fail" });
    await asRole(db, "service_role", () => db.query(
      `insert into public.portal_registrations (package_id, owner_id, title, license, public_repo_url, site_url, accessibility_status)
       values ($1, $2, 't', 'CC-BY-4.0', 'u', 's', 'pass')`, [p, owner]));
    const status = async () => (await db.query<{ s: string }>(`select accessibility_status s from public.portal_registrations where package_id = $1`, [p])).rows[0]!.s;
    expect(await status()).toBe("fail"); // was: "pass" (copied from the owner's manifest)
    await asRole(db, "service_role", () => db.query(`update public.portal_registrations set accessibility_status = 'pass' where package_id = $1`, [p]));
    expect(await status()).toBe("fail");
    await asRole(db, "service_role", () => db.query(`update public.packages set a11y_status = 'pass', a11y_checked_sha = 'c1' where id = $1`, [p]));
    expect(await status()).toBe("pass");
  });

  it("[P5.S.3.i] a check describes the head it audited: when the recorded head moves on, the course shows not checked", async () => {
    const p = await seedPackage(db, { owner, listed: true, title: "A11y expiry" });
    await seedDoc(db, { packageId: p });
    await own(() => db.query(`update public.packages set last_synced_sha = 'c1' where id = $1`, [p]));
    await asRole(db, "service_role", () => db.query(`update public.packages set a11y_status = 'pass', a11y_checked_at = now(), a11y_checked_sha = 'c1' where id = $1`, [p]));
    const shown = async () => (await asRole(db, "anon", () => db.query<{ a: string }>(`select accessibility_status a from public.discovery_courses where package_id = $1`, [p]))).rows[0]!.a;
    expect(await shown()).toBe("pass");
    await own(() => db.query(`update public.packages set title = 'renamed in place' where id = $1`, [p])); // head unchanged
    expect(await shown()).toBe("pass");
    await own(() => db.query(`update public.packages set last_synced_sha = 'c2' where id = $1`, [p])); // a save
    expect(await shown()).toBe("unknown"); // was: "pass" for bytes nobody checked
    await own(() => db.query(`update public.packages set last_synced_sha = 'c1' where id = $1`, [p])); // moving back does not restore it
    expect(await shown()).toBe("unknown");
    expect(await refused(() => own(() => db.query(`update public.packages set a11y_checked_sha = 'c2' where id = $1`, [p])))).not.toBeNull();
  });

  it("[P5.S.1.h] unlisting and listing again keeps the first listing time (recency cannot be refreshed at will)", async () => {
    const p = await seedPackage(db, { owner, listed: true, title: "Relist" });
    const listedAt = async () => (await asRole(db, "anon", () => db.query<{ t: Date }>(`select listed_at t from public.discovery_courses where package_id = $1`, [p]))).rows[0]?.t;
    const first = await listedAt();
    expect(first).toBeDefined();
    await db.query(`update public.portal_registrations set registered_at = now() - interval '30 days' where package_id = $1`, [p]); // (trigger keeps it)
    await new Promise((r) => setTimeout(r, 20));
    await own(() => db.query(`delete from public.portal_registrations where package_id = $1`, [p]));
    await asRole(db, "service_role", () => db.query(
      `insert into public.portal_registrations (package_id, owner_id, title, license, public_repo_url, site_url) values ($1, $2, 't', 'CC-BY-4.0', 'u', 's')`, [p, owner]));
    expect(await listedAt()).toEqual(first); // was: the re-listing time
    expect(await refused(() => own(() => db.query(`select * from public.listing_history`)))).not.toBeNull();
  });
});


describe("composition r3c (listing): no migration silently reverted an earlier fix", () => {
  const src = async (name: string) =>
    (await db.query<{ s: string; definer: boolean }>(
      `select prosrc s, prosecdef definer from pg_proc where pronamespace = 'public'::regnamespace and proname = $1`, [name])).rows;

  it("[P5.A.1.r] every trigger of rounds r1b, r2, r2c and this r3c migration is installed", async () => {
    const { rows } = await db.query<{ t: string }>(`select tgrelid::regclass || '.' || tgname as t from pg_trigger where not tgisinternal`);
    const have = new Set(rows.map((r) => r.t));
    for (const t of [
      "documents.documents_content_changed_at", "packages.packages_listing_changed_at",
      "documents.documents_no_cross_package_move", "documents.documents_registered_at",
      "portal_registrations.portal_registrations_registered_at", "documents.documents_retire_ids",
      "packages.packages_retire_ids", "documents.documents_refuse_retired_id", "packages.packages_refuse_retired_id",
      "documents.discovery_documents_insert", "documents.discovery_documents_update", "documents.discovery_documents_delete",
      "packages.discovery_packages", "portal_registrations.discovery_registrations",
      "sandbox_files.discovery_concept_map_write", "sandbox_files.discovery_concept_map_update", "sandbox_files.discovery_concept_map_delete",
      // r3c
      "portal_registrations.portal_registrations_a11y", "packages.packages_a11y_to_registration",
      "packages.packages_a11y_expires", "portal_registrations.portal_registrations_registered_at_first",
    ]) {
      expect(have.has(t), t).toBe(true);
    }
  });

  it("[P5.A.1.r] the internal functions stay closed to the API roles", async () => {
    for (const fn of [
      "registration_first_listed()", "packages_a11y_expires()", "registration_a11y_from_package()", "packages_a11y_to_registration()",
    ]) {
      for (const role of ["anon", "authenticated"]) {
        const ok = (await db.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') ok`, [role, `public.${fn}`])).rows[0]!.ok;
        expect(ok, `${role} ${fn}`).toBe(false);
      }
    }
  });
});
