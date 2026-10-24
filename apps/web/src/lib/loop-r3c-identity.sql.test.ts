/**
 * Closed loop r3 (round-3 audits, 2026-10-24) — security HIGH-1 (P5.S.16, P5.B.1.q): an identity column never changes after
 * insert (0030_loop_r3c_2) — a retired docId cannot be reclaimed by UPDATE.
 * On the Supabase-shaped harness (non-superuser owner, every migration in a
 * fresh session — P5.S.13). Each block failed on main (edc0d06, migrations
 * through 0029_loop_r2c_3) unless it says it pins kept behaviour, and passes
 * with migrations 0030_loop_r3c_*.
 *
 *   repros /tmp/alembic-r3/r3db.test.ts (H1), r3b.test.ts (H1 variant)
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedDoc, seedPackage, seedUser } from "./discovery-pglite";

vi.mock("./discovery-cache", () => ({ discoveryChanged: () => {} }));
vi.setConfig({ testTimeout: 120_000 });

let db: PGlite;
let owner: string;
let other: string;

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "edu");
  other = await seedUser(db, "other");
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
// HIGH-1 (security r3) — identity columns never change
// ---------------------------------------------------------------------------
describe("HIGH-1 an identity never changes after insert — a retired docId cannot be reclaimed by UPDATE", () => {
  it("[P5.S.16] [P5.B.1.q] renaming one's own row onto a retired docId, onto a back-filled lineage target, or to any fresh id is refused (owner and service)", async () => {
    const victim = await seedPackage(db, { owner: other, listed: true, title: "Victim" });
    await seedDoc(db, { packageId: victim, docId: "doc-r3ccited001", path: "fragments/weak-acid.md", space: "fragments", kind: "md", sourceHash: "oldhash", permalinkClass: "document" });
    const w = await seedPackage(db, { owner: other, listed: true, title: "W" });
    await seedDoc(db, { packageId: w, docId: "doc-r3cwcopy001", adaptedFrom: "doc-r3csource01" });
    await seedDoc(db, { packageId: victim, docId: "doc-r3csource01", path: "assets/src.svg" });
    await own(() => db.query(`delete from public.packages where id = $1`, [victim]), other);
    expect((await db.query(`select count(*)::int n from public.retired_ids where id in ('doc-r3ccited001','doc-r3csource01')`)).rows[0]).toEqual({ n: 2 });

    const mine = await seedPackage(db, { owner, listed: true, title: "Attacker" });
    const d = await seedDoc(db, { packageId: mine, docId: "doc-r3cmine0001", discoverable: false });
    for (const target of ["doc-r3ccited001", "doc-r3csource01", "doc-r3cfresh0001"]) {
      const msg = await refused(() => own(() => db.query(`update public.documents set doc_id = $1, source_hash = 'oldhash', discoverable = true where doc_id = $2`, [target, d])));
      expect(msg, target).toMatch(/permanent/);
      expect(await refused(() => asRole(db, "service_role", () => db.query(`update public.documents set doc_id = $1 where doc_id = $2`, [target, d])))).toMatch(/permanent/);
    }
    expect((await db.query(`select doc_id from public.documents where package_id = $1`, [mine])).rows).toEqual([{ doc_id: d }]);
    expect((await asRole(db, "anon", () => db.query(`select doc_id from public.discovery_elements where doc_id in ('doc-r3ccited001','doc-r3csource01')`))).rows).toEqual([]);
  });

  it("[P5.S.16] every other identity column is frozen too: packages.id (service), suggestions' sender/target, the listing's and the stored file's package", async () => {
    const p = await seedPackage(db, { owner, listed: true, title: "Ids" });
    const q = await seedPackage(db, { owner, title: "Ids 2" });
    expect(await refused(() => asRole(db, "service_role", () => db.query(`update public.packages set id = 'pkg-r3c-renamed' where id = $1`, [p])))).toMatch(/permanent/);
    await db.query(`insert into public.sandbox_files (package_id, repo, path, content) values ($1, 'public', 'x.md', 'x')`, [p]);
    expect(await refused(() => own(() => db.query(`update public.sandbox_files set package_id = $2 where package_id = $1`, [p, q])))).toMatch(/permanent/);
    expect(await refused(() => asRole(db, "service_role", () => db.query(`update public.portal_registrations set package_id = $2 where package_id = $1`, [p, q])))).toMatch(/permanent/);
    const from = await seedPackage(db, { owner: other, storage: "sandbox", title: "From" });
    const { rows } = await db.query<{ id: number }>(
      `insert into public.suggestions (target_package_id, from_package_id, from_user_id, chapter_path, source_block_id, suggested_body)
       values ($1, $2, $3, 'c', 'b', 'body') returning id`, [p, from, other]);
    for (const set of [`from_user_id = '${owner}'`, `from_package_id = '${q}'`, `target_package_id = '${q}'`]) {
      expect(await refused(() => asRole(db, "service_role", () => db.query(`update public.suggestions set ${set} where id = $1`, [rows[0]!.id]))), set).toMatch(/permanent/);
    }
    // kept: resolving a suggestion and ordinary edits still work
    await own(() => db.query(`update public.suggestions set status = 'accepted', decided_at = now() where id = $1`, [rows[0]!.id]));
    await own(() => db.query(`update public.sandbox_files set content = 'y' where package_id = $1`, [p]));
  });
});

describe("HIGH-1 improvement: every identity column is sensitive by default", () => {
  it("[P5.S.16] every primary-key / foreign-key column the signed-in role can UPDATE is frozen by an identity trigger, or is a listed role column", async () => {
    // Role columns: who owns / sent something, not what it IS. They may
    // change only under RLS (the row stays the caller's) and are listed here
    // deliberately; anything else new must be frozen or added with a reason.
    const ROLE_COLUMNS: Record<string, string> = {
      "documents.author": "owner-asserted attribution, like documents.adapted_from (accepted open, loop r2 LOW-4)",
      "sandbox_files.repo": "a stored file's location, not an identity (its docId lives in documents)",
      "sandbox_files.path": "a stored file's location, not an identity (its docId lives in documents)",
    };
    const { rows } = await db.query<{ k: string }>(
      `select distinct c.relname || '.' || a.attname as k
       from pg_constraint con
       join pg_class c on c.oid = con.conrelid
       join pg_attribute a on a.attrelid = c.oid and a.attnum = any (con.conkey)
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and con.contype in ('p', 'f')
         and has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE')
         and a.attidentity <> 'a' -- GENERATED ALWAYS: cannot be updated to a value
         -- a table with RLS on and no UPDATE policy cannot be updated by the role at all
         and not (c.relrowsecurity and not exists (
           select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname
             and p.cmd in ('UPDATE', 'ALL')))
       order by 1`);
    const frozen = new Set(
      (await db.query<{ k: string }>(
        `select c.relname || '.' || arg as k
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
         cross join lateral unnest(string_to_array(rtrim(encode(t.tgargs, 'escape'), '\\000'), '\\000')) as arg
         where t.tgfoid = 'public.refuse_identity_change()'::regprocedure`)).rows.map((r) => r.k),
    );
    frozen.add("documents.package_id"); // documents_no_cross_package_move (0027)
    const open = rows.map((r) => r.k).filter((k) => !frozen.has(k) && !(k in ROLE_COLUMNS));
    expect(open).toEqual([]);
    expect([...frozen].sort()).toEqual(expect.arrayContaining(["documents.doc_id", "packages.id", "sandbox_files.package_id",
      "suggestions.from_user_id", "suggestions.from_package_id", "suggestions.target_package_id", "portal_registrations.package_id",
      "package_changes.package_id", "package_changes.user_id"]));
  });
});


describe("composition r3c (identity): no migration silently reverted an earlier fix", () => {
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
      "documents.documents_identity_immutable", "packages.packages_identity_immutable",
      "portal_registrations.portal_registrations_identity_immutable", "suggestions.suggestions_identity_immutable",
      "sandbox_files.sandbox_files_identity_immutable", "package_changes.package_changes_identity_immutable",
    ]) {
      expect(have.has(t), t).toBe(true);
    }
  });

  it("[P5.A.1.r] the internal functions stay closed to the API roles", async () => {
    for (const fn of [
      "refuse_identity_change()",
    ]) {
      for (const role of ["anon", "authenticated"]) {
        const ok = (await db.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') ok`, [role, `public.${fn}`])).rows[0]!.ok;
        expect(ok, `${role} ${fn}`).toBe(false);
      }
    }
  });
});
