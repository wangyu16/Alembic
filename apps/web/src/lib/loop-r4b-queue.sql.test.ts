/**
 * Closed loop r4, part B (round-4 audits, 2026-10-24) — security MEDIUM-1 and
 * correctness LOW (P5.A.1.u), with the unasserted clauses of P5.A.1.t and
 * P5.A.1.s: the discovery drain is fair, splits what fails, resets the
 * back-off on new work and commits per entry (0031_loop_r4b_1).
 * On the Supabase-shaped harness (non-superuser owner, every migration in a
 * fresh session — P5.S.13). Each block failed on main (03bcb00, migrations
 * through 0030_loop_r3c_4) unless it says it pins kept behaviour, and passes
 * with 0031_loop_r4b_1.
 *
 *   repro /tmp/alembic-r4/r4q.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, readMigration, seedDoc, seedPackage, seedUser } from "./discovery-pglite";

vi.mock("./discovery-cache", () => ({ discoveryChanged: () => {} }));
vi.setConfig({ testTimeout: 180_000 });

let db: PGlite;
let owner: string;
let attacker: string;

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "edu");
  attacker = await seedUser(db, "attacker");
}, 180_000);
afterAll(async () => {
  await db?.close();
});

const own = <T,>(fn: () => Promise<T>, user = owner) => asRole(db, "authenticated", fn, user);
const entry = async (pkg: string) =>
  (await db.query<{ doc_ids: string[] | null; cursor: string | null; attempts: number; next: Date | null; drained: Date | null; held: string[] | null }>(
    `select doc_ids, cursor_doc_id cursor, attempts, next_attempt_at next, drained_at drained, held_doc_ids held
     from public.discovery_pending where package_id = $1`, [pkg])).rows[0];
const bigPackage = async (user: string, n: number, prefix: string, title: string) => {
  const pkg = await seedPackage(db, { owner: user, listed: true, title });
  await db.query(`insert into public.documents (doc_id, package_id, repo, path, space, kind, source_hash, origin, permalink_class, discoverable, description, tags)
    select $2 || lpad(g::text, 8, '0'), $1, 'public', 'fragments/f' || g || '.md', 'fragments', 'md', 'h' || g, 'created', 'document', true,
      'weak acid titration ' || g, '{acid}' from generate_series(1, $3::int) g`, [pkg, prefix, n]);
  return pkg;
};

/**
 * Swap in a projector that raises for any refresh touching one of `bad` (or
 * for every refresh when `bad` is "all"), and sleeps `slowMs` per multi-element
 * refresh (a chunk) so budget tests do not depend on machine speed.
 */
async function wrapProjector(bad: string[] | "all" | null, slowMs = 0): Promise<() => Promise<void>> {
  const cond = bad === null ? "false" : bad === "all" ? "true" : `ids is not null and ids && array[${bad.map((b) => `'${b}'`).join(",")}]::text[]`;
  await db.exec(`
    alter function public.discovery_refresh_package(text, boolean, text[]) rename to discovery_refresh_package_real;
    create function public.discovery_refresh_package(p text, c boolean default false, ids text[] default null) returns void
      language plpgsql security definer set search_path = '' as $$
      begin
        if ${cond} then raise exception 'poisoned element (simulated)'; end if;
        if ${slowMs} > 0 and coalesce(cardinality(ids), 2) > 1 then perform pg_catalog.pg_sleep(${slowMs / 1000}); end if;
        perform public.discovery_refresh_package_real(p, c, ids);
      end $$;`);
  return async () => {
    await db.exec(`
      drop function public.discovery_refresh_package(text, boolean, text[]);
      alter function public.discovery_refresh_package_real(text, boolean, text[]) rename to discovery_refresh_package;`);
  };
}
const poisonProjector = (bad: string[] | "all") => wrapProjector(bad);

/** Run `sql` in one transaction whose discovery refreshes are queued, not run (as after a cancelled projector). */
async function queuedEdit(sql: string, params: unknown[]): Promise<void> {
  await db.exec("begin");
  await db.query(`select set_config('alembic.discovery_cancelled', 'on', true)`);
  await db.query(sql, params);
  await db.exec("commit");
}

// ---------------------------------------------------------------------------
// MEDIUM-1 — a never-finishing entry cannot starve the queue
// ---------------------------------------------------------------------------
describe("MEDIUM-1 the drain is fair", () => {
  it("[P5.A.1.u] a course whose owner keeps restarting its drain cannot starve another course's refresh, run after run (r4q)", async () => {
    const big = await bigPackage(attacker, 6000, "doc-big", "Big restarter");
    const victim = await seedPackage(db, { owner, listed: true, title: "Victim" });
    const vdoc = await seedDoc(db, { packageId: victim, docId: "doc-vq00000001" });
    await db.query(`delete from public.discovery_pending`);
    await asRole(db, "authenticated", () => db.query(`update public.packages set manifest = manifest || '{"title":"R1"}'::jsonb where id = $1`, [big]), attacker);
    expect((await entry(big))?.doc_ids).toBeNull(); // a whole entry (> 1,000 elements)
    // every chunk costs 0.5 s: the 6 chunks of the big course outlast a 2 s run
    const restore = await wrapProjector(null, 500);
    try {
      for (let run = 1; run <= 3; run++) {
        // the victim has fresh queued work every run (e.g. its refresh found the lock held)
        await db.query(`select public.discovery_pend($1, true, array[$2])`, [victim, vdoc]);
        const n = (await db.query<{ n: number }>(`select public.discovery_flush_pending(25, interval '2 seconds') n`)).rows[0]!.n;
        expect(await entry(victim), `run ${run}`).toBeUndefined(); // was: still queued, "drained 0" every run
        expect(n).toBeGreaterThanOrEqual(1);
        expect(await entry(big)).toBeDefined(); // the big course is not done, and was not let to take the run
        // the attacker edits its title again before the next run (restarts its drain)
        await asRole(db, "authenticated", () => db.query(
          `update public.packages set manifest = jsonb_set(manifest, '{title}', to_jsonb('R' || $2::text)) where id = $1`, [big, String(run + 1)]), attacker);
        expect((await entry(big))?.cursor).toBeNull();
        expect((await entry(big))?.drained).not.toBeNull(); // a restart keeps its place behind untouched entries
      }
      // the scheduled procedure is as fair
      await db.query(`select public.discovery_pend($1, true, array[$2])`, [victim, vdoc]);
      await db.exec(`call public.discovery_drain(25, interval '2 seconds')`);
      expect(await entry(victim)).toBeUndefined();
    } finally {
      await restore();
    }
    await db.query(`delete from public.discovery_pending`);
  });

  it("[P5.A.1.u] an entry a drain already worked on sorts behind every untouched entry, however old it is", async () => {
    const old = await bigPackage(attacker, 2500, "doc-old", "Old partial");
    const young = await seedPackage(db, { owner, listed: true, title: "Young" });
    await seedDoc(db, { packageId: young });
    await db.query(`delete from public.discovery_pending`);
    await db.query(`select public.discovery_pend($1, false, null)`, [old]);
    await db.query(`update public.discovery_pending set first_queued_at = now() - interval '5 hours' where package_id = $1`, [old]);
    await db.query(`select public.discovery_flush_one($1, interval '0 seconds')`, [old]); // one chunk, then out of budget
    expect((await entry(old))?.drained).not.toBeNull();
    await db.query(`select public.discovery_pend($1, false, null)`, [young]);
    const next = async () => (await db.query<{ id: string }>(`select public.discovery_drain_next('{}') id`)).rows[0]!.id;
    expect(await next()).toBe(young); // was: the oldest entry first, always
    await db.query(`select public.discovery_pend($1, false, null)`, [old]); // a restart does not buy its place back
    expect(await next()).toBe(young);
    await db.query(`delete from public.discovery_pending`);
  });
});

// ---------------------------------------------------------------------------
// A failing entry does not absorb later work; new work resets the back-off
// ---------------------------------------------------------------------------
describe("a failing entry is split, never a sink", () => {
  it("[P5.A.1.u] a whole drain with one bad element lands everything else, and a later single-doc edit still lands", async () => {
    const pkg = await bigPackage(owner, 2500, "doc-sp", "Split");
    const BAD = "doc-sp00001500";
    const X = "doc-sp00002200"; // in a chunk that does not fail (the third)
    const Y = "doc-sp00001200"; // in the SAME chunk as the bad element (the second)
    await db.query(`delete from public.discovery_pending`);
    const restore = await poisonProjector([BAD]);
    try {
      await queuedEdit(`update public.documents set description = 'NEW ' || doc_id where package_id = $1 and doc_id in ($2, $3)`, [pkg, X, Y]);
      await db.query(`delete from public.discovery_pending`);
      await db.query(`select public.discovery_pend($1, true, null)`, [pkg]);
      expect((await db.query<{ d: boolean }>(`select public.discovery_flush_one($1, interval '1 hour') d`, [pkg])).rows[0]!.d).toBe(false);
      const desc = async (id: string) => (await db.query<{ d: string }>(`select description d from public.discovery_elements where doc_id = $1`, [id])).rows[0]?.d;
      expect(await desc(X)).toBe(`NEW ${X}`); // was: every chunk rolled back with the bad one
      let e = (await entry(pkg))!;
      expect(e.doc_ids).toHaveLength(1000); // exactly the failed chunk is left, as a scoped entry
      expect(e.doc_ids).toContain(BAD);
      expect(e.attempts).toBe(1);
      // the next drain splits the chunk: everything but the bad id lands
      await db.query(`update public.discovery_pending set next_attempt_at = null where package_id = $1`, [pkg]);
      await db.query(`select public.discovery_flush_one($1, interval '1 hour')`, [pkg]);
      expect(await desc(Y)).toBe(`NEW ${Y}`);
      e = (await entry(pkg))!;
      expect(e.doc_ids).toEqual([BAD]);
      expect(e.attempts).toBe(2);
      expect(e.next!.getTime()).toBeGreaterThan(Date.now());
      // a later single-doc edit merged into the failing entry: due at once, and it lands
      await queuedEdit(`update public.documents set description = 'LATER' where doc_id = $1`, [X]); // queues [X]
      expect((await entry(pkg))!.next).toBeNull(); // new work resets the back-off
      await own(() => db.query(`select public.discovery_flush_package($1)`, [pkg]));
      expect(await desc(X)).toBe("LATER"); // was: absorbed into an entry that never finished
      expect((await entry(pkg))!.doc_ids).toEqual([BAD]);
    } finally {
      await restore();
    }
    await db.query(`delete from public.discovery_pending`);
  });

  it("[P5.A.1.u] only new work resets the back-off: the same ids, or a whole pend into a whole entry, do not", async () => {
    const pkg = await seedPackage(db, { owner, listed: true, title: "Reset" });
    await seedDoc(db, { packageId: pkg, docId: "doc-rs00000001" });
    await db.query(`select public.discovery_pend($1, false, array['doc-rs00000001'])`, [pkg]);
    await db.query(`update public.discovery_pending set attempts = 3, next_attempt_at = now() + interval '8 minutes' where package_id = $1`, [pkg]);
    await db.query(`select public.discovery_pend($1, false, array['doc-rs00000001'])`, [pkg]);
    expect((await entry(pkg))!.next).not.toBeNull(); // nothing new
    await db.query(`select public.discovery_pend($1, false, array['doc-rs00000002'])`, [pkg]);
    expect((await entry(pkg))!.next).toBeNull(); // a new id
    expect((await entry(pkg))!.attempts).toBe(3); // kept: the next failure backs off longer
    await db.query(`update public.discovery_pending set next_attempt_at = now() + interval '8 minutes' where package_id = $1`, [pkg]);
    await db.query(`select public.discovery_pend($1, false, null)`, [pkg]);
    expect((await entry(pkg))!.next).toBeNull(); // a list became the whole package
    await db.query(`update public.discovery_pending set next_attempt_at = now() + interval '8 minutes' where package_id = $1`, [pkg]);
    await db.query(`select public.discovery_pend($1, false, null)`, [pkg]);
    expect((await entry(pkg))!.next).not.toBeNull(); // whole into whole, nothing restarted
    await db.query(`select public.discovery_pend($1, true, null)`, [pkg]);
    expect((await entry(pkg))!.next).toBeNull(); // content newly changed
    await db.query(`delete from public.discovery_pending`);
  });
});

// ---------------------------------------------------------------------------
// The scheduled drain commits per entry; P5.A.1.t's clauses bound
// ---------------------------------------------------------------------------
describe("the scheduled drain", () => {
  it("[P5.A.1.u] [P5.A.1.t] the job runs discovery_drain(25, 25 s), which commits after every entry and leaves no lock behind", async () => {
    await db.exec(`create schema if not exists cron;
      create table if not exists cron.job (jobname text primary key, schedule text, command text);
      create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint
        language sql as $$ insert into cron.job values (job_name, schedule, command)
          on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint $$;`);
    const sql = readMigration("0031_loop_r4b_1_discovery_drain.sql");
    await db.exec(sql.slice(sql.lastIndexOf("do $$")));
    const job = (await db.query<{ schedule: string; command: string }>(`select schedule, command from cron.job where jobname = 'alembic-discovery-drain'`)).rows[0]!;
    expect(job).toEqual({ schedule: "*/5 * * * *", command: "call public.discovery_drain(25, interval '25 seconds')" });
    await db.exec(`drop schema cron cascade`);

    const pkgs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const p = await seedPackage(db, { owner, listed: true, title: `Commit ${i}` });
      await seedDoc(db, { packageId: p });
      pkgs.push(p);
    }
    await db.query(`delete from public.discovery_pending`);
    for (const p of pkgs) await db.query(`select public.discovery_pend($1, false, null)`, [p]);
    await db.exec(`create table public.r4b_drain_log (package_id text, xid text);
      create function public.r4b_log() returns trigger language plpgsql as $$
        begin insert into public.r4b_drain_log values (old.package_id, pg_current_xact_id()::text); return old; end $$;
      create trigger r4b_log after delete on public.discovery_pending for each row execute function public.r4b_log();`);
    try {
      await db.exec(job.command); // what pg_cron runs (top level, as the owner)
      const log = (await db.query<{ package_id: string; xid: string }>(`select * from public.r4b_drain_log`)).rows;
      expect(log.map((r) => r.package_id).sort()).toEqual([...pkgs].sort());
      expect(new Set(log.map((r) => r.xid)).size).toBe(3); // one transaction per entry (was: one for the whole run)
      expect((await db.query<{ n: number }>(`select count(*)::int n from pg_locks where locktype = 'advisory'`)).rows[0]!.n).toBe(0);
    } finally {
      await db.exec(`drop trigger r4b_log on public.discovery_pending; drop function public.r4b_log(); drop table public.r4b_drain_log;`);
    }
  });

  it("[P5.A.1.t] every drain — owner, operator and scheduled — skips an entry that is backing off, and drains the others oldest first", async () => {
    const [a, b, c] = await Promise.all([0, 1, 2].map(async (i) => {
      const p = await seedPackage(db, { owner, listed: true, title: `Order ${i}` });
      await seedDoc(db, { packageId: p });
      return p;
    }));
    await db.query(`delete from public.discovery_pending`);
    for (const p of [a!, b!, c!]) await db.query(`select public.discovery_pend($1, false, null)`, [p]);
    await db.query(`update public.discovery_pending set first_queued_at = now() - interval '3 hours' where package_id = $1`, [c]);
    await db.query(`update public.discovery_pending set first_queued_at = now() - interval '2 hours' where package_id = $1`, [a]);
    await db.query(`update public.discovery_pending set first_queued_at = now() - interval '1 hour',
      attempts = 1, next_attempt_at = now() + interval '2 minutes' where package_id = $1`, [b]);
    const left = async () => (await db.query<{ id: string }>(`select package_id id from public.discovery_pending order by 1`)).rows.map((r) => r.id);
    await db.exec(`call public.discovery_drain(1, interval '25 seconds')`);
    expect(await left()).toEqual([a!, b!].sort()); // the oldest (c) went first
    await db.query(`select public.discovery_flush_pending(1, interval '25 seconds')`);
    expect(await left()).toEqual([b!]); // then a; b is backing off
    await db.exec(`call public.discovery_drain(25, interval '25 seconds')`);
    await db.query(`select public.discovery_flush_pending(25, interval '25 seconds')`);
    expect((await own(() => db.query<{ d: boolean }>(`select public.discovery_flush_package($1) d`, [b]))).rows[0]!.d).toBe(false);
    expect((await entry(b!))!.attempts).toBe(1); // no drain touched it
    await db.query(`delete from public.discovery_pending`);
  });

  // (pins kept behaviour: r3c's back-off steps, unasserted until now)
  it("[P5.A.1.t] a failing entry backs off 1, 2, 4, 8, 16, 32 minutes, then at most an hour", async () => {
    const pkg = await seedPackage(db, { owner, listed: true, title: "Steps" });
    await seedDoc(db, { packageId: pkg, docId: "doc-st00000001" });
    await db.query(`delete from public.discovery_pending`);
    await db.query(`select public.discovery_pend($1, false, array['doc-st00000001'])`, [pkg]);
    const restore = await poisonProjector("all");
    const steps: number[] = [];
    try {
      for (let i = 0; i < 9; i++) {
        await db.query(`update public.discovery_pending set next_attempt_at = null where package_id = $1`, [pkg]);
        await db.query(`select public.discovery_flush_one($1)`, [pkg]);
        steps.push((await db.query<{ m: number }>(
          `select round(extract(epoch from next_attempt_at - now()) / 60)::int m from public.discovery_pending where package_id = $1`, [pkg])).rows[0]!.m);
      }
    } finally {
      await restore();
    }
    expect(steps).toEqual([1, 2, 4, 8, 16, 32, 60, 60, 60]);
    await db.query(`delete from public.discovery_pending`);
  });

  it("[P5.A.1.s] when the package's lock is not available the entry is left exactly as it was", async () => {
    const pkg = await bigPackage(owner, 1500, "doc-lk", "Locked");
    await db.query(`delete from public.discovery_pending`);
    await db.query(`select public.discovery_pend($1, true, null)`, [pkg]);
    await db.query(`update public.discovery_pending set cursor_doc_id = 'doc-lk00000700', attempts = 2, last_error = 'x' where package_id = $1`, [pkg]);
    const row = async () => (await db.query(`select * from public.discovery_pending where package_id = $1`, [pkg])).rows[0];
    const before = await row();
    // (PGlite is one connection, so "another transaction holds the lock" is
    // staged by making the try-lock answer no.)
    await db.exec(`alter function public.discovery_try_lock(text) rename to discovery_try_lock_real;
      create function public.discovery_try_lock(p text) returns boolean language sql security definer set search_path = '' as $$ select false $$;`);
    try {
      expect((await db.query<{ d: boolean }>(`select public.discovery_flush_one($1, interval '1 hour') d`, [pkg])).rows[0]!.d).toBe(false);
      await db.query(`select public.discovery_flush_pending(25, interval '25 seconds')`);
      await db.exec(`call public.discovery_drain(25, interval '25 seconds')`);
      expect(await row()).toEqual(before);
    } finally {
      await db.exec(`drop function public.discovery_try_lock(text);
        alter function public.discovery_try_lock_real(text) rename to discovery_try_lock;`);
    }
    await db.query(`delete from public.discovery_pending`);
  });
});

describe("composition r4b (queue): no migration silently reverted an earlier fix", () => {
  const src = async (name: string) =>
    (await db.query<{ s: string; definer: boolean; cfg: string | null }>(
      `select prosrc s, prosecdef definer, array_to_string(proconfig, ',') cfg from pg_proc
       where pronamespace = 'public'::regnamespace and proname = $1`, [name])).rows;

  it("[P5.A.1.r] the queue functions keep r2c/r3c rules and carry r4b's (slice, fair order, split, reset, commit per entry)", async () => {
    const [pend] = await src("discovery_pend");
    for (const m of ["when q.doc_ids is null or excluded.doc_ids is null then null", "q.content or excluded.content",
      "u <= q.cursor_doc_id", "next_attempt_at = case", "excluded.doc_ids <@ q.doc_ids"]) expect(pend!.s, m).toContain(m);
    expect(pend!.s).not.toMatch(/first_queued_at\s*=/);
    expect(pend!.s).not.toMatch(/drained_at\s*=/);
    const [one] = await src("discovery_flush_one");
    for (const m of ["discovery_try_lock(p_package_id)", "for update skip locked", "limit 1000", "cursor_doc_id = v_last",
      "attempts = attempts + 1", "least(interval '1 minute' * power(2, least(attempts, 10)), interval '1 hour')",
      "discovery_refresh_package(p_package_id, v_q.content, '{}')", "discovery_refresh_ids", "v_failed := v_failed || v_chunk",
      "drained_at = clock_timestamp()"]) {
      expect(one!.s, m).toContain(m);
    }
    expect(one!.s.indexOf("discovery_try_lock")).toBeLessThan(one!.s.indexOf("from public.discovery_pending"));
    const [lock] = await src("discovery_try_lock");
    const [proj] = await src("discovery_refresh_package");
    expect(lock!.s).toContain("pg_try_advisory_xact_lock");
    const key = "hashtextextended('alembic.discovery:' || p_package_id, 0)";
    expect(lock!.s).toContain(key);
    expect(proj!.s).toContain(key); // the same lock as the projector's
    const [next] = await src("discovery_drain_next");
    expect(next!.s).toContain("order by q.drained_at nulls first, q.first_queued_at, q.package_id");
    expect(next!.s).toContain("next_attempt_at <= now()");
    const [all] = await src("discovery_flush_pending");
    for (const m of ["discovery_drain_next(v_seen)", "v_budget / 5, interval '2 seconds'"]) expect(all!.s, m).toContain(m);
    const [drain] = await src("discovery_drain");
    for (const m of ["discovery_drain_next(v_seen)", "v_budget / 5, interval '2 seconds'", "commit;"]) expect(drain!.s, m).toContain(m);
    expect(drain!.definer).toBe(false); // a committing procedure: invoker, no SET clause
    expect(drain!.cfg).toBeNull();
    const [pkgFlush] = await src("discovery_flush_package");
    expect(pkgFlush!.s).toContain("caller_owns_package");
    for (const m of ["pg_try_advisory_xact_lock", "v_pkg.a11y_status", "least(x.registered_at, now())"]) expect(proj!.s, m).toContain(m);
  });

  it("[P5.A.1.r] the internal functions and the drain procedure stay closed to the API roles", async () => {
    for (const fn of [
      "discovery_try_lock(text)", "discovery_pend(text, boolean, text[])", "discovery_refresh_ids(text, boolean, text[], timestamptz)",
      "discovery_flush_one(text, interval)", "discovery_drain_next(text[])", "discovery_flush_pending(integer, interval)",
      "discovery_drain(integer, interval)",
    ]) {
      for (const role of ["anon", "authenticated"]) {
        const ok = (await db.query<{ ok: boolean }>(`select has_function_privilege($1, $2, 'execute') ok`, [role, `public.${fn}`])).rows[0]!.ok;
        expect(ok, `${role} ${fn}`).toBe(false);
      }
    }
  });
});
