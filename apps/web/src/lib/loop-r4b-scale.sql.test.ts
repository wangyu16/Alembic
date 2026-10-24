/**
 * Closed loop r4, part B (round-4 correctness audit, 2026-10-24) — MEDIUM-4
 * (P5.A.1.v): a documents_apply that updates every row of a 3,000-file course
 * stays well inside the signed-in 8 s statement timeout (0031_loop_r4b_2).
 * On the Supabase-shaped harness (non-superuser owner, every migration in a
 * fresh session — P5.S.13). Failed on main (03bcb00): the no-change statement
 * took 16–23 s (a nested-loop join of the trigger's transition tables).
 *
 *   repro /tmp/p5r4/sql/scale.mts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

vi.mock("./discovery-cache", () => ({ discoveryChanged: () => {} }));
vi.setConfig({ testTimeout: 240_000 });

let db: PGlite;
let owner: string;

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "edu");
}, 180_000);
afterAll(async () => {
  await db?.close();
});

const row = (pid: string, id: string, path: string) => ({
  doc_id: id, package_id: pid, repo: "public", path, space: "assets", kind: "svg", format_version: 2,
  source_hash: "h-" + id, origin: "created", author: owner, registered_at: new Date().toISOString(), license: null,
  description: "d " + id, tags: ["acid"], alt_text: null, discoverable: true, permalink_class: "object",
  tombstoned: false, adapted_from: null, content_sha256: null,
});
const apply = async (pid: string, rows: unknown[]) => {
  const t = performance.now();
  await asRole(db, "authenticated", () => db.query(`select public.documents_apply($1, $2, $3::jsonb)`, [pid, [], JSON.stringify(rows)]), owner);
  return performance.now() - t;
};

describe("MEDIUM-4 a registration statement stays linear in the rows it updates", () => {
  it("[P5.A.1.v] 3,000 rows unchanged, a 500-row chunk, and a 3,000-row path cycle each stay well under 8 s", async () => {
    const N = 3000;
    const pid = await seedPackage(db, { owner, listed: true, title: "Scale" });
    const ids = Array.from({ length: N }, (_, i) => `doc-sc${String(i).padStart(8, "0")}`);
    for (let i = 0; i < N; i += 500) await apply(pid, ids.slice(i, i + 500).map((id, k) => row(pid, id, `assets/f${i + k}.svg`)));
    await db.query(`select public.discovery_flush_pending(1000, interval '10 minutes')`);
    await db.exec(`vacuum analyze public.documents`);
    const noop = await apply(pid, ids.map((id, i) => row(pid, id, `assets/f${i}.svg`)));
    const chunk = await apply(pid, ids.slice(0, 500).map((id, i) => row(pid, id, `assets/f${i}.svg`)));
    const cycle = await apply(pid, ids.map((id, i) => row(pid, id, `assets/f${(i + 1) % N}.svg`)));
    console.info(`[r4b MEDIUM-4] documents_apply: 3,000 unchanged ${noop.toFixed(0)} ms, 500-row chunk ${chunk.toFixed(0)} ms, 3,000-row cycle ${cycle.toFixed(0)} ms`);
    expect(noop).toBeLessThan(8000); // was: 16–23 s
    expect(chunk).toBeLessThan(8000);
    expect(cycle).toBeLessThan(8000);
    // the cycle landed: every row at its new path
    expect((await db.query<{ p: string }>(`select path p from public.documents where doc_id = $1`, [ids[0]])).rows[0]!.p).toBe("assets/f1.svg");
  });
});

describe("composition r4b (scale): no migration silently reverted an earlier fix", () => {
  it("[P5.A.1.r] discovery_on_documents_update plans without nested loops and keeps its body (r1b move rule, adaptation counts)", async () => {
    const { rows } = await db.query<{ s: string; definer: boolean; cfg: string[] }>(
      `select prosrc s, prosecdef definer, proconfig cfg from pg_proc
       where pronamespace = 'public'::regnamespace and proname = 'discovery_on_documents_update'`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cfg).toEqual(expect.arrayContaining([`search_path=""`, "enable_nestloop=off"]));
    expect(rows[0]!.definer).toBe(true);
    for (const m of ["join old_rows o on o.doc_id = n.doc_id", "where n.package_id is distinct from o.package_id",
      "discovery_refresh_safe(s.package_id, false, s.doc_ids)"]) expect(rows[0]!.s, m).toContain(m);
  });
});
