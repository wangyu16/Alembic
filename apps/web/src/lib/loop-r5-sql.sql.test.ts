/**
 * Closed loop r5 (round-5 audits, 2026-10-24), the two SQL findings:
 *
 *  - P5.A.1.w (MEDIUM, correctness): ids a whole drain set aside (held) that
 *    keep failing no longer block the rest of the pass — the drain records
 *    what is still held and FALLS THROUGH to the pass / scoped work
 *    (0033_loop_r5_1_discovery_held). repro /tmp/p5r5/sql/held.test.ts
 *  - P5.R.5.h (LOW): a course whose last completed accessibility check failed
 *    ranks (and shows) as failed until a newer completed check exists; only
 *    a never-checked course, or a pass/warn that a new head expired, is
 *    "not checked" (neutral) (0033_loop_r5_2_a11y_fail_sticks).
 *
 * On the Supabase-shaped harness (non-superuser owner, every migration in a
 * fresh session — P5.S.13). Each block failed on 4f56f65 + owner decisions
 * (migrations through 0032_decisions_1) unless it says it pins kept
 * behaviour, and passes with the two 0033 migrations.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";

vi.mock("server-only", () => ({}));
vi.mock("./discovery-cache", () => ({ discoveryChanged: () => {} }));
vi.setConfig({ testTimeout: 300_000 });

import { asRole, freshDatabase, seedDoc, seedPackage, seedUser } from "./discovery-pglite";
import { pgliteClient } from "./pglite-postgrest";
import { SupabaseSandboxStore } from "./sandbox-store";
import { packageTrustWriter } from "./package-trust-writes";
import { runPublishedA11yCheck } from "./a11y-auto";
import { A11Y_LABELS } from "./discovery-labels";

let db: PGlite;
let owner: string;

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "edu");
}, 300_000);
afterAll(async () => {
  await db?.close();
});

const own = <T,>(fn: () => Promise<T>) => asRole(db, "authenticated", fn, owner);

// ---------------------------------------------------------------------------
// P5.A.1.w — held ids that keep failing do not block the pass
// ---------------------------------------------------------------------------
const entry = async (pkg: string) =>
  (await db.query<{ doc_ids: string[] | null; cursor: string | null; attempts: number; next: Date | null; held: string[] | null }>(
    `select doc_ids, cursor_doc_id cursor, attempts, next_attempt_at next, held_doc_ids held
     from public.discovery_pending where package_id = $1`, [pkg])).rows[0];
const desc = async (id: string) =>
  (await db.query<{ d: string }>(`select description d from public.discovery_elements where doc_id = $1`, [id])).rows[0]?.d;

/** A projector that raises for any refresh touching `bad` and sleeps `slowMs` per chunk. */
async function wrapProjector(bad: string, slowMs: number): Promise<() => Promise<void>> {
  await db.exec(`
    alter function public.discovery_refresh_package(text, boolean, text[]) rename to discovery_refresh_package_real;
    create function public.discovery_refresh_package(p text, c boolean default false, ids text[] default null) returns void
      language plpgsql security definer set search_path = '' as $$
      begin
        if ids is not null and ids && array['${bad}']::text[] then raise exception 'poisoned element (simulated)'; end if;
        if coalesce(cardinality(ids), 2) > 1 then perform pg_catalog.pg_sleep(${slowMs / 1000}); end if;
        perform public.discovery_refresh_package_real(p, c, ids);
      end $$;`);
  return async () => {
    await db.exec(`
      drop function public.discovery_refresh_package(text, boolean, text[]);
      alter function public.discovery_refresh_package_real(text, boolean, text[]) rename to discovery_refresh_package;`);
  };
}

/** Run `sql` in one transaction whose discovery refreshes are queued, not run. */
async function queuedEdit(sql: string, params: unknown[]): Promise<void> {
  await db.exec("begin");
  await db.query(`select set_config('alembic.discovery_cancelled', 'on', true)`);
  await db.query(sql, params);
  await db.exec("commit");
}

describe("P5.A.1.w a held id that keeps failing is a sink no longer", () => {
  it("[P5.A.1.w] an id set aside at a slice deadline that keeps failing does not block the rest of the pass or later refreshes", async () => {
    const pkg = await seedPackage(db, { owner, listed: true, title: "Held" });
    await db.query(`insert into public.documents (doc_id, package_id, repo, path, space, kind, source_hash, origin, permalink_class, discoverable, description, tags)
      select 'doc-hd' || lpad(g::text, 8, '0'), $1, 'public', 'fragments/f' || g || '.md', 'fragments', 'md', 'h' || g, 'created', 'document', true,
        'weak acid ' || g, '{acid}' from generate_series(1, 3500) g`, [pkg]);
    const BAD = "doc-hd00000500"; // chunk 1
    const X4 = "doc-hd00003400"; // chunk 4
    const X1 = "doc-hd00000499"; // chunk 1, beside the bad id
    await db.query(`delete from public.discovery_pending`);
    const restore = await wrapProjector(BAD, 400);
    try {
      await queuedEdit(`update public.documents set description = 'NEW ' || doc_id where doc_id in ($1, $2)`, [X4, X1]);
      await db.query(`delete from public.discovery_pending`);
      await db.query(`select public.discovery_pend($1, true, null)`, [pkg]);

      // slice 1 (0.7 s): chunk 1 fails and is set aside; the deadline stops the pass before chunk 4
      await db.query(`select public.discovery_flush_one($1, interval '700 milliseconds')`, [pkg]);
      let e = (await entry(pkg))!;
      expect(e.held).toContain(BAD);
      expect(e.cursor).not.toBeNull();
      expect(e.cursor! < X4).toBe(true);
      expect(e.attempts).toBe(1);
      const cursor1 = e.cursor!;

      // a slice whose budget the held retry spends: the pass still advances (one chunk), nothing held is lost
      await db.query(`update public.discovery_pending set next_attempt_at = null where package_id = $1`, [pkg]);
      await db.query(`select public.discovery_flush_one($1, interval '1 millisecond')`, [pkg]);
      e = (await entry(pkg))!;
      expect(e.cursor! > cursor1).toBe(true); // was: the cursor never moved again
      expect(e.held).toContain(BAD);
      expect(e.attempts).toBe(2); // one failure per drain, not one per step
      expect(e.next!.getTime()).toBeGreaterThan(Date.now()); // and it backs off

      // the next drain: the held ids are retried (all but BAD land) and the pass runs to the end
      await db.query(`update public.discovery_pending set next_attempt_at = null where package_id = $1`, [pkg]);
      await db.query(`select public.discovery_flush_one($1, interval '1 hour')`, [pkg]);
      expect(await desc(X4)).toBe(`NEW ${X4}`); // was: never — every drain stopped at the held ids
      expect(await desc(X1)).toBe(`NEW ${X1}`); // the held retry landed it
      e = (await entry(pkg))!;
      expect(e.doc_ids).toEqual([BAD]); // what is left: exactly the failing id, as a scoped entry
      expect(e.held).toBeNull();
      expect(e.cursor).toBeNull();
      expect(e.attempts).toBe(3);
      expect(e.next!.getTime()).toBeGreaterThan(Date.now());

      // a later edit merged in: due at once, and it lands (the owner's own flush)
      await queuedEdit(`update public.documents set description = 'LATER' where doc_id = $1`, [X4]);
      expect((await entry(pkg))!.next).toBeNull();
      await own(() => db.query(`select public.discovery_flush_package($1)`, [pkg]));
      expect(await desc(X4)).toBe("LATER");
      expect((await entry(pkg))!.doc_ids).toEqual([BAD]);
    } finally {
      await restore();
    }
    await db.query(`delete from public.discovery_pending`);
  });

  it("[P5.A.1.w] a scoped entry with held ids still refreshes its own ids, and keeps the held ones owed", async () => {
    const pkg = await seedPackage(db, { owner, listed: true, title: "Held scoped" });
    const A = await seedDoc(db, { packageId: pkg, docId: "doc-hs00000001" });
    const B = await seedDoc(db, { packageId: pkg, docId: "doc-hs00000002" });
    const restore = await wrapProjector(B, 0);
    try {
      await queuedEdit(`update public.documents set description = 'NEW A' where doc_id = $1`, [A]);
      await db.query(`update public.discovery_pending set held_doc_ids = array[$2], next_attempt_at = null where package_id = $1`, [pkg, B]);
      expect((await entry(pkg))!.doc_ids).toEqual([A]);
      await db.query(`select public.discovery_flush_one($1, interval '1 hour')`, [pkg]);
      expect(await desc(A)).toBe("NEW A"); // was: the held failure returned first
      const e = (await entry(pkg))!;
      expect(e.doc_ids).toEqual([B]);
      expect(e.held).toBeNull();
      expect(e.attempts).toBe(1);
    } finally {
      await restore();
    }
    // once B can refresh, the entry is done
    await db.query(`update public.discovery_pending set next_attempt_at = null where package_id = $1`, [pkg]);
    await db.query(`select public.discovery_flush_one($1, interval '1 hour')`, [pkg]);
    expect(await entry(pkg)).toBeUndefined();
    await db.query(`delete from public.discovery_pending`);
  });
});

// ---------------------------------------------------------------------------
// P5.R.5.h — a failed check is not escaped by moving the head
// ---------------------------------------------------------------------------
const MANIFEST = (id: string) =>
  JSON.stringify({ schemaVersion: 2, packageId: id, title: "T", license: "CC-BY-4.0", createdAt: "2026-08-28T00:00:00.000Z" });
const CLEAN = "## Intro {#b-aaaaaaaa}\n\nPlain prose with nothing to flag.\n";
const FAILING = "## Intro {#b-aaaaaaaa}\n\n![ ](figure.png)\n";
const repo = (pkg: string, head: string, chapter: string) => ({
  getBranchHead: async () => ({ commitSha: head }),
  getFileAtRef: async (_c: unknown, path: string) => (path === "alembic.json" ? MANIFEST(pkg) : chapter),
});
const check = (pkg: string, connect: () => Promise<unknown>) =>
  runPublishedA11yCheck(pkg, {
    store: new SupabaseSandboxStore(pgliteClient(db, "service_role")),
    userId: owner,
    connect: connect as never,
    record: (v) => packageTrustWriter(() => pgliteClient(db, "service_role")).recordA11yCheck(pkg, owner, v),
  });
const save = (pkg: string, head: string) =>
  own(() => db.query(`update public.packages set last_synced_sha = $2 where id = $1`, [pkg, head]));
async function discover(pkg: string) {
  const search = await asRole(db, "anon", () =>
    db.query<{ accessibility_status: string }>(
      `select accessibility_status from public.discovery_search_courses(p_limit => 51) where package_id = $1`, [pkg]));
  const listing = await asRole(db, "anon", () =>
    db.query<{ s: string }>(`select accessibility_status s from public.portal_registrations where package_id = $1`, [pkg]));
  const record = (await db.query<{ s: string }>(`select a11y_status s from public.packages where id = $1`, [pkg])).rows[0]!.s;
  const status = search.rows[0]!.accessibility_status;
  return { record, status, listing: listing.rows[0]!.s, badge: A11Y_LABELS[status]?.label ?? null };
}
async function publishedCourse(title: string) {
  const p = await seedPackage(db, { owner, listed: true, title });
  await seedDoc(db, { packageId: p });
  await save(p, "c1");
  return p;
}
const FAILED = { record: "fail", status: "fail", listing: "fail", badge: "Accessibility: needs work" };
const UNKNOWN = { record: "unknown", status: "unknown", listing: "unknown", badge: null };

describe("P5.R.5.h a failed check stays failed until a newer check completes", () => {
  it("[P5.R.5.h] a save after a failed check keeps the course failed (rank, facet, listing, badge) — saving cannot escape a fail", async () => {
    const p = await publishedCourse("Quokka xylography");
    expect(await check(p, async () => repo(p, "c1", FAILING))).toMatchObject({ kind: "recorded", status: "fail" });
    expect(await discover(p)).toEqual(FAILED);
    // many saves, none of them checked (the a11yAuto bucket is spent)
    for (let i = 2; i <= 40; i++) await save(p, `c${i}`);
    expect(await discover(p)).toEqual(FAILED); // was: "unknown" — neutral in Discover
    const facets = await asRole(db, "anon", () =>
      db.query<{ value: string }>(`select value from public.discovery_course_facets(p_q => 'quokka xylography') where facet = 'a11y'`));
    expect(facets.rows.map((r) => r.value)).toEqual(["fail"]);
  });

  it("[P5.R.5.h] a re-check that cannot run or throws leaves the fail; a newer completed check replaces it", async () => {
    const p = await publishedCourse("Failed then broken");
    expect((await check(p, async () => repo(p, "c1", FAILING))).kind).toBe("recorded");
    await save(p, "c2");
    expect((await check(p, async () => null)).kind).toBe("unavailable");
    const broken = { getBranchHead: async () => ({ commitSha: "c2" }), getFileAtRef: async () => { throw new Error("502"); } };
    expect((await check(p, async () => broken)).kind).toBe("failed");
    expect(await discover(p)).toEqual(FAILED); // was: "unknown"
    // the owner fixes the course: the next completed check records the new result
    expect(await check(p, async () => repo(p, "c2", CLEAN))).toMatchObject({ kind: "recorded", status: "pass" });
    expect(await discover(p)).toMatchObject({ record: "pass", status: "pass", listing: "pass" });
  });

  it("[P5.R.5.h] (kept) a pass or warn that a new head expired, and a never-checked course, are not checked (neutral)", async () => {
    for (const status of ["pass", "warn"] as const) {
      const p = await publishedCourse(`Expired ${status}`);
      await asRole(db, "service_role", () => db.query(
        `update public.packages set a11y_status = $2, a11y_checked_at = now(), a11y_checked_sha = 'c1' where id = $1`, [p, status]));
      expect((await discover(p)).status).toBe(status);
      await save(p, "c2");
      expect(await discover(p)).toEqual(UNKNOWN);
    }
    const never = await publishedCourse("Never checked");
    await save(never, "c2");
    expect(await discover(never)).toEqual(UNKNOWN);
  });
});

// ---------------------------------------------------------------------------
// Composition (P5.A.1.r): 0033 keeps every earlier rule
// ---------------------------------------------------------------------------
describe("composition r5: no migration silently reverted an earlier fix", () => {
  const src = async (name: string) =>
    (await db.query<{ s: string; definer: boolean; cfg: string | null }>(
      `select prosrc s, prosecdef definer, array_to_string(proconfig, ',') cfg from pg_proc
       where pronamespace = 'public'::regnamespace and proname = $1`, [name])).rows;

  it("[P5.A.1.r] discovery_flush_one (0033_loop_r5_1) keeps r2c/r3c/r4b rules and falls through after a held failure", async () => {
    const rows = await src("discovery_flush_one");
    expect(rows).toHaveLength(1);
    const one = rows[0]!;
    expect(one.definer).toBe(true);
    expect(one.cfg).toBe(`search_path=""`);
    for (const m of [
      // r3c: lock first, never wait; skip-locked row; back-off 1, 2, 4 … ≤ 1 h; budget default
      "discovery_try_lock(p_package_id)", "alembic.discovery_nolock", "for update skip locked",
      "v_q.next_attempt_at > now()", "least(interval '1 minute' * power(2, least(attempts, 10)), interval '1 hour')",
      "coalesce(p_budget, interval '2 seconds')",
      // r2c/r3c: whole drain = 1,000-element chunks in doc-id order over documents ∪ projection, after the cursor
      "limit 1000", "from public.documents d where d.package_id = p_package_id",
      "from public.discovery_elements e where e.package_id = p_package_id", "i > v_last", "cursor_doc_id = v_last",
      // the course row last
      "discovery_refresh_package(p_package_id, v_q.content, '{}')",
      // r4b: split what fails, chunks in their own sub-transaction, drained_at
      "discovery_refresh_ids(p_package_id, v_q.content, v_q.held_doc_ids, v_deadline)",
      "discovery_refresh_ids(p_package_id, v_q.content, v_q.doc_ids, v_deadline)",
      "v_failed := v_failed || v_chunk", "drained_at = clock_timestamp()", "held_doc_ids = null",
      "raise warning 'discovery: pending refresh of % failed: %'",
      // r5: one failure per drain, and the held failure falls through
      "v_bumped := true", "when v_bumped then",
    ]) expect(one.s, m).toContain(m);
    expect(one.s.indexOf("discovery_try_lock")).toBeLessThan(one.s.indexOf("from public.discovery_pending"));
    // r5: the held step no longer returns — nothing between it and the scoped / whole work exits the function
    const held = one.s.slice(one.s.indexOf("v_q.held_doc_ids is not null"), one.s.indexOf("if v_q.doc_ids is not null"));
    expect(held.length).toBeGreaterThan(0);
    expect(held).not.toMatch(/\breturn\b/);
    // the queue's other functions are untouched by r5 (their r4b rules)
    const [next] = await src("discovery_drain_next");
    expect(next!.s).toContain("order by q.drained_at nulls first, q.first_queued_at, q.package_id");
    const [drain] = await src("discovery_drain");
    for (const m of ["discovery_drain_next(v_seen)", "v_budget / 5, interval '2 seconds'", "commit;"]) expect(drain!.s, m).toContain(m);
    const [pend] = await src("discovery_pend");
    expect(pend!.s).toContain("excluded.doc_ids <@ q.doc_ids");
  });

  it("[P5.A.1.r] packages_a11y_expires (0033_loop_r5_2) keeps r3c's expiry rules and keeps a fail; its trigger and the listing trigger stay", async () => {
    const [f] = await src("packages_a11y_expires");
    expect(f!.cfg).toBe(`search_path=""`);
    for (const m of [
      "new.last_synced_sha is distinct from old.last_synced_sha",
      "new.a11y_checked_sha is not distinct from old.a11y_checked_sha",
      "new.a11y_status is not distinct from old.a11y_status",
      "new.last_synced_sha is distinct from new.a11y_checked_sha",
      "new.a11y_status := 'unknown'",
      "new.a11y_status in ('pass', 'warn')", // r5: only a pass or warn expires; a fail stays
    ]) expect(f!.s, m).toContain(m);
    const { rows } = await db.query<{ t: string; def: string }>(
      `select tgname t, pg_get_triggerdef(oid) def from pg_trigger
       where tgrelid = 'public.packages'::regclass and tgname in ('packages_a11y_expires', 'packages_a11y_to_registration')`);
    const def = new Map(rows.map((r) => [r.t, r.def]));
    expect(def.get("packages_a11y_expires")).toMatch(/BEFORE UPDATE ON public\.packages FOR EACH ROW/);
    expect(def.get("packages_a11y_to_registration")).toMatch(/AFTER UPDATE ON public\.packages FOR EACH ROW WHEN/);
  });

  it("[P5.A.1.r] the functions 0033 redefines stay closed to the API roles", async () => {
    for (const fn of ["discovery_flush_one(text, interval)", "packages_a11y_expires()"]) {
      for (const role of ["anon", "authenticated"]) {
        const ok = (await db.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') ok`, [role, `public.${fn}`])).rows[0]!.ok;
        expect(ok, `${role} ${fn}`).toBe(false);
      }
    }
  });
});
