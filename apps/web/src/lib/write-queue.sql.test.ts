/**
 * The course write queue (migration 0037; docs/specs/v3/queue-and-jobs-v3.md).
 * Claims Q.1, Q.2, Q.3 (status rules), lease and fence behaviour — PGlite.
 * (Multi-connection contention needs real Postgres: claim A4.5/Q.4, run on
 * the testing database.)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let owner: string;
let outsider: string;

const svc = <T>(fn: () => Promise<T>) => asRole(db, "service_role", fn);

async function insert(pkg: string, kind: string, idem: string, o: { actor?: string | null; invoker?: string | null; priority?: number; depends?: string | null } = {}) {
  const { rows } = await svc(() =>
    db.query<{ id: string }>(
      `select public.queue_insert($1, $2, $3, '{}'::jsonb, $4, $5, null, $6::smallint, $7) as id`,
      [pkg, kind, idem, o.actor ?? null, o.invoker ?? null, o.priority ?? 0, o.depends ?? null],
    ),
  );
  return rows[0]!.id;
}
const acquire = async (pkg: string, holder: string, secs = 60) =>
  (await svc(() => db.query<{ f: string | null }>(`select public.committer_acquire($1, $2, $3) as f`, [pkg, holder, secs]))).rows[0]!.f;
const next = async (pkg: string, holder: string, fence: string) =>
  (await svc(() => db.query<{ id: string; status: string; attempts: number }>(`select id, status, attempts from public.committer_next($1, $2, $3)`, [pkg, holder, fence]))).rows[0];
const finish = (id: string, holder: string, fence: string, status: string, retry?: number) =>
  svc(() => db.query(`select public.committer_finish($1, $2, $3, $4, null, null, $5)`, [id, holder, fence, status, retry ?? null]));

async function attempt(fn: () => Promise<unknown>): Promise<"ok" | "refused"> {
  try {
    await fn();
    return "ok";
  } catch {
    return "refused";
  }
}

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "owner");
  outsider = await seedUser(db, "outsider");
}, 90_000);
afterAll(async () => {
  await db?.close();
});

describe("Q.1 insert authority", () => {
  it("members and anon can't insert, update or delete queue rows, nor call the queue functions", async () => {
    const pkg = await seedPackage(db, { owner });
    for (const r of ["authenticated", "anon"] as const) {
      for (const sql of [
        `insert into public.write_queue (package_id, kind, idem_key, payload, actor_id) values ('${pkg}', 'sync', 'x', '{}', '${owner}')`,
        `select public.queue_insert('${pkg}', 'sync', 'k', '{}'::jsonb, '${owner}')`,
        `select public.committer_acquire('${pkg}', 'w')`,
      ]) {
        expect(await attempt(() => asRole(db, r, () => db.query(sql), owner)), `${r}: ${sql}`).toBe("refused");
      }
    }
  });

  it("members read their course's rows; outsiders don't", async () => {
    const pkg = await seedPackage(db, { owner });
    await insert(pkg, "sync", "a", { actor: owner });
    const mine = await asRole(db, "authenticated", () => db.query(`select id from public.write_queue where package_id = $1`, [pkg]), owner);
    expect(mine.rows).toHaveLength(1);
    const theirs = await asRole(db, "authenticated", () => db.query(`select id from public.write_queue where package_id = $1`, [pkg]), outsider);
    expect(theirs.rows).toHaveLength(0);
  });

  it("a repeated key returns the same row for the same kind and actor, and is refused for anyone else", async () => {
    const pkg = await seedPackage(db, { owner });
    const a = await insert(pkg, "sync", "k1", { actor: owner });
    expect(await insert(pkg, "sync", "k1", { actor: owner })).toBe(a);
    expect(await attempt(() => insert(pkg, "sync", "k1", { actor: outsider }))).toBe("refused");
    // The same raw key in another kind is a different row (system keys can't be pre-claimed).
    const s = await insert(pkg, "system", "k1");
    expect(s).not.toBe(a);
  });

  it("sync rows need an actor; dependencies must be in the same course", async () => {
    const pkg = await seedPackage(db, { owner });
    const other = await seedPackage(db, { owner });
    expect(await attempt(() => insert(pkg, "sync", "noactor"))).toBe("refused");
    const x = await insert(other, "sync", "x", { actor: owner });
    expect(await attempt(() => insert(pkg, "sync", "dep", { actor: owner, depends: x }))).toBe("refused");
  });
});

describe("lease and fence", () => {
  it("one holder at a time; takeover after expiry increments the fence; a stale holder can't record", async () => {
    const pkg = await seedPackage(db, { owner });
    const f1 = await acquire(pkg, "w1");
    expect(f1).not.toBeNull();
    expect(await acquire(pkg, "w2")).toBeNull();
    expect(await acquire(pkg, "w1")).toBe(f1); // renew
    const id = await insert(pkg, "sync", "r1", { actor: owner });
    const row = await next(pkg, "w1", f1!);
    expect(row?.id).toBe(id);
    await db.query(`update public.course_committer set lease_until = now() - interval '1 second' where package_id = $1`, [pkg]);
    const f2 = await acquire(pkg, "w2");
    expect(Number(f2)).toBe(Number(f1) + 1);
    expect(await attempt(() => finish(id, "w1", f1!, "done"))).toBe("refused");
    expect(await attempt(() => next(pkg, "w1", f1!))).toBe("refused");
    // The new holder picks the unfinished row up again (attempt 2).
    const again = await next(pkg, "w2", f2!);
    expect(again).toMatchObject({ id, attempts: 2 });
    await finish(id, "w2", f2!, "done");
  });
});

describe("Q.2 strict order", () => {
  it("priority first, then sequence; a retry row that isn't due holds the course; terminal rows never block", async () => {
    const pkg = await seedPackage(db, { owner });
    const f = (await acquire(pkg, "w"))!;
    const a = await insert(pkg, "sync", "a", { actor: owner });
    const b = await insert(pkg, "sync", "b", { actor: owner });
    const u = await insert(pkg, "system", "undo", { priority: 1 });
    expect((await next(pkg, "w", f))!.id).toBe(u);
    await finish(u, "w", f, "done");
    expect((await next(pkg, "w", f))!.id).toBe(a);
    await finish(a, "w", f, "retry", 3600);
    expect(await next(pkg, "w", f)).toBeUndefined(); // b waits behind a
    await db.query(`update public.write_queue set next_attempt_at = now() - interval '1 second' where id = $1`, [a]);
    expect((await next(pkg, "w", f))!.id).toBe(a);
    await finish(a, "w", f, "refused");
    expect((await next(pkg, "w", f))!.id).toBe(b);
    await finish(b, "w", f, "done");
    expect(await next(pkg, "w", f)).toBeUndefined();
  });

  it("a dependent waits for its dependency, and is bounced if the dependency didn't land", async () => {
    const pkg = await seedPackage(db, { owner });
    const f = (await acquire(pkg, "w"))!;
    const d1 = await insert(pkg, "changeset", "c1", { invoker: owner });
    const d2 = await insert(pkg, "changeset", "c2", { invoker: owner, depends: d1 });
    expect((await next(pkg, "w", f))!.id).toBe(d1);
    await finish(d1, "w", f, "bounced");
    expect(await next(pkg, "w", f)).toBeUndefined();
    const { rows } = await db.query<{ status: string }>(`select status from public.write_queue where id = $1`, [d2]);
    expect(rows[0]!.status).toBe("bounced");
  });

  it("finish only accepts known statuses and only for a row being processed", async () => {
    const pkg = await seedPackage(db, { owner });
    const f = (await acquire(pkg, "w"))!;
    const a = await insert(pkg, "sync", "a", { actor: owner });
    expect(await attempt(() => finish(a, "w", f, "done"))).toBe("refused"); // not claimed yet
    await next(pkg, "w", f);
    expect(await attempt(() => finish(a, "w", f, "weird"))).toBe("refused");
    await finish(a, "w", f, "done");
    expect(await attempt(() => finish(a, "w", f, "done"))).toBe("refused"); // already terminal
  });
});
