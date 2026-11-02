/**
 * G2 round-2 adversary probe for migration 0037 (abandoned-row bound), PGlite.
 * The test asserts what queue-and-jobs-v3.md requires; a failure is a finding.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let owner: string;
const svc = <T>(fn: () => Promise<T>) => asRole(db, "service_role", fn);

const acquire = async (pkg: string, holder: string) =>
  (await svc(() => db.query<{ f: string | null }>(`select public.committer_acquire($1, $2) as f`, [pkg, holder]))).rows[0]!.f!;
const next = async (pkg: string, holder: string, fence: string) =>
  (await svc(() => db.query<{ id: string; status: string; attempts: number }>(`select id, status, attempts from public.committer_next($1, $2, $3)`, [pkg, holder, fence]))).rows[0];
const retry = (id: string, holder: string, fence: string) =>
  svc(() => db.query(`select public.committer_finish($1, $2, $3, 'retry', null, 'GitHub is down', 0)`, [id, holder, fence]));
const expire = (pkg: string) => db.query(`update public.course_committer set lease_until = now() - interval '1 second' where package_id = $1`, [pkg]);

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "owner");
}, 90_000);
afterAll(async () => {
  await db?.close();
});

describe("G2 round-2 queue probe", () => {
  it("MEDIUM: one abandonment after ordinary retries fails the row at once — without the trailer scan (its commit may have landed)", async () => {
    const pkg = await seedPackage(db, { owner });
    const { rows: ins } = await svc(() =>
      db.query<{ id: string }>(`select public.queue_insert($1, 'sync', 'a', '{}'::jsonb, $2) as id`, [pkg, owner]),
    );
    const id = ins[0]!.id;
    // A GitHub outage: the row is tried and finished 'retry' 8 times (processRow never fails an outage).
    const f = await acquire(pkg, "w");
    for (let i = 0; i < 8; i++) {
      const r = await next(pkg, "w", f);
      expect(r?.id).toBe(id);
      await retry(id, "w", f);
    }
    // GitHub is back: attempt 9 commits, then the worker is redeployed before recording the result.
    const r9 = await next(pkg, "w", f);
    expect(r9?.attempts).toBe(9);
    await expire(pkg);
    // The new worker must get the row back (abandoned once) so the trailer scan can record the landed commit.
    const f2 = await acquire(pkg, "w2");
    const again = await next(pkg, "w2", f2);
    const { rows } = await db.query<{ status: string }>(`select status from public.write_queue where id = $1`, [id]);
    expect(rows[0]!.status).not.toBe("failed");
    expect(again?.id).toBe(id);
  });
});
