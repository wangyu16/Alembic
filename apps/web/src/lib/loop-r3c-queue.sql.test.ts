/**
 * Closed loop r3 (round-3 audits, 2026-10-24) — M3-1 (P5.A.1.s) and M3-2 (P5.A.1.t), security LOW-2: the discovery queue
 * never loses a refresh, is drained on a schedule, has an observable age and
 * backs off (0030_loop_r3c_3); the queue functions keep every earlier rule.
 * On the Supabase-shaped harness (non-superuser owner, every migration in a
 * fresh session — P5.S.13). Each block failed on main (edc0d06, migrations
 * through 0029_loop_r2c_3) unless it says it pins kept behaviour, and passes
 * with migrations 0030_loop_r3c_*.
 *
 *   repro /tmp/p5r3/lostref.mts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, readMigration, seedDoc, seedPackage, seedUser } from "./discovery-pglite";

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
// M3-1 — the queue never loses a refresh
// ---------------------------------------------------------------------------
describe("M3-1 a queued refresh is never lost", () => {
  it("[P5.A.1.s] a doc edit queued while a whole-package drain is half-way is re-projected (lostref)", async () => {
    const pkg = await seedPackage(db, { owner, listed: true, title: "Big lost" });
    await db.query(`insert into public.documents (doc_id, package_id, repo, path, space, kind, source_hash, origin, description, tags, discoverable, permalink_class)
      select 'doc-lr' || lpad(g::text, 10, '0'), $1, 'public', 'assets/f' || g || '.svg', 'assets', 'svg', 'h' || g, 'created',
      'Old description ' || g, '{acid}', true, 'object' from generate_series(1, 2500) g`, [pkg]);
    const X = "doc-lr0000000005";
    await own(() => db.query(`update public.packages set manifest = jsonb_set(manifest, '{license}', '"CC-BY-SA-4.0"') where id = $1`, [pkg]));
    await db.query(`select public.discovery_flush_one($1, interval '0 seconds')`, [pkg]); // one chunk, then out of budget
    expect((await db.query<{ c: string }>(`select cursor_doc_id c from public.discovery_pending where package_id = $1`, [pkg])).rows[0]!.c > X).toBe(true);
    await db.exec("begin");
    await db.query(`select set_config('alembic.discovery_cancelled', 'on', true)`); // the refresh is queued, not run
    await db.query(`update public.documents set description = 'NEW description of five' where doc_id = $1`, [X]);
    await db.exec("commit");
    let n = 0;
    while ((await db.query<{ n: number }>(`select count(*)::int n from public.discovery_pending where package_id = $1`, [pkg])).rows[0]!.n > 0 && n++ < 20) {
      await own(() => db.query(`select public.discovery_flush_package($1)`, [pkg]));
    }
    expect((await db.query<{ d: string; l: string }>(`select description d, license l from public.discovery_elements where doc_id = $1`, [X])).rows[0])
      .toEqual({ d: "NEW description of five", l: "CC-BY-SA-4.0" }); // was: "Old description 5"
  });

  it("[P5.A.1.s] the drain takes the package's lock before it touches the entry; an entry it does not finish keeps its first-queued age", async () => {
    const pkg = await seedPackage(db, { owner, listed: true, title: "Lock first" });
    await seedDoc(db, { packageId: pkg });
    await db.query(`select public.discovery_pend($1, false, null)`, [pkg]);
    const first = (await db.query<{ f: Date }>(`select first_queued_at f from public.discovery_pending where package_id = $1`, [pkg])).rows[0]!.f;
    await db.query(`select public.discovery_pend($1, false, array['doc-x'])`, [pkg]); // a merge keeps the age
    expect((await db.query<{ f: Date }>(`select first_queued_at f from public.discovery_pending where package_id = $1`, [pkg])).rows[0]!.f).toEqual(first);
    const advisory = `select count(*)::int n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()`;
    await db.exec("begin");
    await db.query(`select public.discovery_flush_one($1)`, [pkg]);
    const held = (await db.query<{ n: number }>(advisory)).rows[0]!.n;
    await db.exec("rollback");
    expect(held).toBe(1);
    // (PGlite is one connection, so the losing side — another transaction holding
    // the lock — cannot be staged; the composition test pins that the try-lock
    // precedes every read of the entry.)
  });
});

// ---------------------------------------------------------------------------
// M3-2 — a scheduled drain, an observable age, a back-off
// ---------------------------------------------------------------------------
describe("M3-2 every queued refresh has a scheduled drain and an observable age", () => {
  it("[P5.A.1.t] with pg_cron enabled the migration schedules the drain every 5 minutes; the scheduled command drains overdue entries oldest first", async () => {
    // A stand-in for pg_cron's cron.schedule (PGlite has no pg_cron): the
    // migration's scheduling block, run as it is in the file, must call it.
    await db.exec(`create schema if not exists cron;
      create table if not exists cron.job (jobname text primary key, schedule text, command text);
      create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint
        language sql as $$ insert into cron.job values (job_name, schedule, command)
          on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint $$;`);
    const sql = readMigration("0030_loop_r3c_3_discovery_queue.sql");
    const block = sql.slice(sql.lastIndexOf("do $$"));
    await db.exec(block);
    const job = (await db.query<{ schedule: string; command: string }>(`select schedule, command from cron.job where jobname = 'alembic-discovery-drain'`)).rows[0]!;
    expect(job.schedule).toBe("*/5 * * * *");

    const a = await seedPackage(db, { owner, listed: true, title: "Overdue A" });
    const b = await seedPackage(db, { owner, listed: true, title: "Overdue B" });
    await seedDoc(db, { packageId: a });
    await seedDoc(db, { packageId: b });
    await db.query(`delete from public.discovery_pending`);
    await db.query(`select public.discovery_pend($1, false, null), public.discovery_pend($2, false, null)`, [a, b]);
    await db.query(`update public.discovery_pending set first_queued_at = now() - interval '3 hours' where package_id = $1`, [a]);
    await db.query(`update public.discovery_pending set first_queued_at = now() - interval '2 hours', queued_at = now() - interval '1 minute' where package_id = $1`, [b]);
    const health = async () => (await asRole(db, "service_role", () => db.query<{ pending: number; overdue: number }>(`select pending, overdue from public.discovery_pending_health()`))).rows[0]!;
    expect(await health()).toMatchObject({ pending: 2, overdue: 2 });
    expect((await asRole(db, "service_role", () => db.query(`select package_id from public.discovery_pending_overdue order by first_queued_at`))).rows)
      .toEqual([{ package_id: a }, { package_id: b }]);
    await db.query(job.command); // what pg_cron runs (as the database owner)
    expect(await health()).toMatchObject({ pending: 0, overdue: 0 });
    await db.exec(`drop schema cron cascade`);
  });

  it("[P5.A.1.t] the health view and function are closed to the API roles", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      expect(await refused(() => asRole(db, role, () => db.query(`select * from public.discovery_pending_health()`), owner))).not.toBeNull();
      expect(await refused(() => asRole(db, role, () => db.query(`select * from public.discovery_pending_overdue`), owner))).not.toBeNull();
    }
  });

  it("[P5.A.1.t] an entry that keeps failing backs off: the edit-page flush is not charged again until its time", async () => {
    const pkg = await seedPackage(db, { owner, listed: true, title: "Failing" });
    await seedDoc(db, { packageId: pkg });
    await db.query(`select public.discovery_pend($1, false, null)`, [pkg]);
    await db.exec(`
      alter function public.discovery_refresh_package(text, boolean, text[]) rename to discovery_refresh_package_real;
      create function public.discovery_refresh_package(p text, c boolean default false, ids text[] default null) returns void
        language plpgsql security definer set search_path = '' as $$ begin raise exception 'broken projector (simulated)'; end $$;`);
    try {
      const flush = async () => (await own(() => db.query<{ d: boolean }>(`select public.discovery_flush_package($1) d`, [pkg]))).rows[0]!.d;
      const state = async () => (await db.query<{ attempts: number; due: boolean }>(
        `select attempts, next_attempt_at > now() + interval '30 seconds' as due from public.discovery_pending where package_id = $1`, [pkg])).rows[0]!;
      expect(await flush()).toBe(false);
      expect(await state()).toEqual({ attempts: 1, due: true });
      expect(await flush()).toBe(false);
      expect(await flush()).toBe(false);
      expect((await state()).attempts).toBe(1); // was: 3 — every load re-ran the failing projector
      await db.query(`update public.discovery_pending set next_attempt_at = now() - interval '1 second' where package_id = $1`, [pkg]);
      expect(await flush()).toBe(false);
      expect((await state()).attempts).toBe(2);
    } finally {
      await db.exec(`
        drop function public.discovery_refresh_package(text, boolean, text[]);
        alter function public.discovery_refresh_package_real(text, boolean, text[]) rename to discovery_refresh_package;`);
    }
    await db.query(`update public.discovery_pending set next_attempt_at = null where package_id = $1`, [pkg]);
    expect((await own(() => db.query<{ d: boolean }>(`select public.discovery_flush_package($1) d`, [pkg]))).rows[0]!.d).toBe(true);
  });
});


describe("composition r3c (queue): no migration silently reverted an earlier fix", () => {
  const src = async (name: string) =>
    (await db.query<{ s: string; definer: boolean }>(
      `select prosrc s, prosecdef definer from pg_proc where pronamespace = 'public'::regnamespace and proname = $1`, [name])).rows;

  it("[P5.A.1.r] the queue functions keep r2c rules and carry r3c's (cursor restart, lock first, back-off, age)", async () => {
    const [pend] = await src("discovery_pend");
    for (const m of ["when q.doc_ids is null or excluded.doc_ids is null then null", "q.content or excluded.content",
      "u <= q.cursor_doc_id"]) expect(pend!.s, m).toContain(m);
    expect(pend!.s).not.toMatch(/first_queued_at\s*=/);
    const [one] = await src("discovery_flush_one");
    for (const m of ["pg_try_advisory_xact_lock", "for update skip locked", "limit 1000", "cursor_doc_id = v_last",
      "attempts = attempts + 1", "next_attempt_at", "discovery_refresh_package(p_package_id, v_q.content, '{}')"]) {
      expect(one!.s, m).toContain(m);
    }
    expect(one!.s.indexOf("pg_try_advisory_xact_lock")).toBeLessThan(one!.s.indexOf("from public.discovery_pending"));
    const [pkg] = await src("discovery_flush_package");
    expect(pkg!.s).toContain("caller_owns_package");
    const [all] = await src("discovery_flush_pending");
    expect(all!.s).toContain("order by first_queued_at");
    // r2c's projector lock and r2 rules are untouched (the projector was not redefined)
    const [proj] = await src("discovery_refresh_package");
    for (const m of ["pg_try_advisory_xact_lock", "v_pkg.a11y_status", "least(x.registered_at, now())"]) expect(proj!.s, m).toContain(m);
  });

  it("[P5.A.1.r] the internal functions stay closed to the API roles", async () => {
    for (const fn of [
      "discovery_pend(text, boolean, text[])", "discovery_flush_one(text, interval)", "discovery_flush_pending(integer, interval)",
      "discovery_pending_health()",
    ]) {
      for (const role of ["anon", "authenticated"]) {
        const ok = (await db.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') ok`, [role, `public.${fn}`])).rows[0]!.ok;
        expect(ok, `${role} ${fn}`).toBe(false);
      }
    }
  });
});
