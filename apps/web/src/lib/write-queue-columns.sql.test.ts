/** [RC.20] Members see the write queue's status, never other members' queued texts (migration 0060). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { SqlQueueStore } from "@alembic/package-ops";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
beforeAll(async () => { db = await freshDatabase(); }, 180_000);
afterAll(async () => { await db?.close(); });

describe("the write queue, as a member sees it", () => {
  it("[RC.20] a co-author sees each row's status but not another member's queued text or its result", async () => {
    const owner = await seedUser(db, "owner");
    const co = await seedUser(db, "co");
    const pkg = await seedPackage(db, { owner });
    await db.query(`insert into public.course_members (package_id, user_id, role) values ($1, $2, 'co-author')`, [pkg, co]);
    const sql = { query: <T,>(t: string, p?: unknown[]) => asRole(db, "service_role", () => db.query<T>(t, p)) };
    await new SqlQueueStore(sql).insert({ packageId: pkg, kind: "sync", idem: "s1", actorId: owner, payload: { files: [{ path: "study-guide/a.md", baseVersion: null, text: "the owner's unpublished draft" }] } });
    const asCo = <T,>(q: string) => asRole(db, "authenticated", () => db.query<T>(q, [pkg]), co);
    const { rows } = await asCo<{ status: string; idem_key: string }>(`select status, idem_key from public.write_queue where package_id = $1`);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("queued");
    await expect(asCo(`select payload from public.write_queue where package_id = $1`)).rejects.toThrow(/permission denied/);
    await expect(asCo(`select result from public.write_queue where package_id = $1`)).rejects.toThrow(/permission denied/);
  });
});
