/**
 * G2 adversary probes for migration 0037 (queue order and stuck rows), PGlite.
 * Each test asserts what queue-and-jobs-v3.md requires; a failure is a finding.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let owner: string;
const svc = <T>(fn: () => Promise<T>) => asRole(db, "service_role", fn);

async function insert(pkg: string, kind: string, idem: string, o: { actor?: string | null; invoker?: string | null; priority?: number; depends?: string | null } = {}) {
  const { rows } = await svc(() =>
    db.query<{ id: string }>(`select public.queue_insert($1, $2, $3, '{}'::jsonb, $4, $5, null, $6::smallint, $7) as id`, [
      pkg, kind, idem, o.actor ?? null, o.invoker ?? null, o.priority ?? 0, o.depends ?? null,
    ]),
  );
  return rows[0]!.id;
}
const acquire = async (pkg: string, holder: string) =>
  (await svc(() => db.query<{ f: string | null }>(`select public.committer_acquire($1, $2) as f`, [pkg, holder]))).rows[0]!.f!;
const next = async (pkg: string, holder: string, fence: string) =>
  (await svc(() => db.query<{ id: string; status: string; attempts: number }>(`select id, status, attempts from public.committer_next($1, $2, $3)`, [pkg, holder, fence]))).rows[0];
const expire = (pkg: string) => db.query(`update public.course_committer set lease_until = now() - interval '1 second' where package_id = $1`, [pkg]);

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "owner");
}, 90_000);
afterAll(async () => {
  await db?.close();
});

describe("G2 queue probes", () => {
  it("MEDIUM: a priority-1 row that depends on a priority-0 row deadlocks the course", async () => {
    const pkg = await seedPackage(db, { owner });
    const f = await acquire(pkg, "w");
    const x = await insert(pkg, "system", "x");
    // Fixed at insert: a priority row may not depend on a lower-priority row, so the deadlock can't be built.
    await expect(insert(pkg, "system", "undo", { priority: 1, depends: x })).rejects.toThrow();
    const r = await next(pkg, "w", f);
    expect(r?.id).toBe(x);
  });

  it("MEDIUM: a row abandoned in 'processing' (worker crash / lost lease) is re-claimed forever, never failed, no backoff", async () => {
    const pkg = await seedPackage(db, { owner });
    const id = await insert(pkg, "sync", "a", { actor: owner });
    let attempts = 0;
    for (let i = 0; i < 12; i++) {
      const f = await acquire(pkg, `w${i}`);
      const r = await next(pkg, `w${i}`, f);
      if (!r) break;
      attempts = r.attempts;
      await expire(pkg); // the worker dies mid-row; its lease runs out
    }
    const { rows } = await db.query<{ status: string; abandons: number }>(`select status, abandons from public.write_queue where id = $1`, [id]);
    // Revised after G2 round 2: SQL counts abandonments separately from retries and hands the row to the
    // committer, which fails it only after checking it did not land (course-committer: MAX_ABANDONS).
    expect(attempts).toBe(12);
    expect(rows[0]!.abandons).toBe(11);
    expect(rows[0]!.status).toBe("processing");
  });
});
