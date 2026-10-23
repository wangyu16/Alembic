/**
 * Security loop r1, finding L4a — the discovery RPCs are callable with the
 * public anon key directly through PostgREST, past the app's search rate
 * limit. Their per-call work is bounded in SQL (query text ≤ 200 chars, ≤ 51
 * rows a page, keyset paging); the TIME a call may take is bounded by the
 * calling role's `statement_timeout`.
 *
 * Why the role and not the function: Postgres arms `statement_timeout` when a
 * statement STARTS, so `create function … set statement_timeout` does not
 * bound the PostgREST call that runs it (one statement). PostgREST applies the
 * impersonated role's settings at the start of every request, so
 * `alter role anon set statement_timeout` does. Migration 0025_loop_r1_4 pins
 * Supabase's defaults (anon 3 s, authenticated 8 s) so they are part of the
 * schema, not a dashboard setting nobody sees.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase } from "./discovery-pglite";

let db: PGlite;
beforeAll(async () => {
  db = await freshDatabase();
}, 60_000);
afterAll(async () => {
  await db?.close();
});

function ms(setting: string): number {
  const m = setting.match(/^(\d+)(ms|s|min)?$/);
  if (!m) throw new Error(`unparsed timeout ${setting}`);
  const n = Number(m[1]);
  return m[2] === "s" ? n * 1000 : m[2] === "min" ? n * 60_000 : n;
}

describe("L4a the anonymously callable discovery functions run under a statement timeout", () => {
  it("[P5.S.9] every role that can execute a discovery function has a statement_timeout of at most 8 s", async () => {
    const { rows: fns } = await db.query<{ fn: string; role: string }>(
      `select p.proname as fn, r.rolname as role
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
         cross join (values ('anon'), ('authenticated')) as r(rolname)
        where p.proname like 'discovery\\_%'
          and has_function_privilege(r.rolname, p.oid, 'execute')
        order by 1, 2`,
    );
    // The inventory: the four search entry points and the two listability
    // predicates the public read policies call, plus 0026's deferral pair
    // (authenticated only — the registry flush documents_apply calls them;
    // begin sets a transaction-local flag, end drains only the calling
    // transaction's own queued refreshes). A new one needs review.
    expect([...new Set(fns.map((f) => f.fn))].sort()).toEqual([
      "discovery_course_facets",
      "discovery_course_listable",
      "discovery_defer_begin",
      "discovery_defer_end",
      "discovery_element_facets",
      "discovery_element_listable",
      "discovery_search_courses",
      "discovery_search_elements",
    ]);
    const { rows: settings } = await db.query<{ role: string; config: string[] | null }>(
      `select r.rolname as role, s.setconfig as config
         from pg_roles r
         left join pg_db_role_setting s on s.setrole = r.oid and s.setdatabase = 0
        where r.rolname in ('anon', 'authenticated')`,
    );
    for (const role of new Set(fns.map((f) => f.role))) {
      const config = settings.find((s) => s.role === role)?.config ?? [];
      const st = config.find((c) => c.startsWith("statement_timeout="));
      expect(st, `${role} has no statement_timeout`).toBeDefined();
      const v = ms(st!.split("=")[1]!);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(8000);
    }
  });
});
