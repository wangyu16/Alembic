/** The sync entry point over the real SQL (PGlite): role and path checks before any queue row. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { enqueueSync, syncQueueKey, SyncRefused } from "@alembic/package-ops";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let owner: string;
let co: string;
let out: string;
let pkg: string;
const sql = { query: <T,>(t: string, p?: unknown[]) => asRole(db, "service_role", () => db.query<T>(t, p)) };
const f = (path: string) => [{ path, baseVersion: null, text: "x" }];

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "owner");
  co = await seedUser(db, "co");
  out = await seedUser(db, "out");
  pkg = await seedPackage(db, { owner });
  await db.query(`insert into public.course_members (package_id, user_id, role) values ($1, $2, 'co-author')`, [pkg, co]);
}, 90_000);
afterAll(async () => { await db?.close(); });

describe("enqueueSync", () => {
  it("[RC.17] queues a member's allowed change, idempotently, under the key the editor asks about on reopening", async () => {
    const id = randomUUID();
    const a = await enqueueSync(sql, { actorId: co, packageId: pkg, syncId: id, files: f("study-guide/a.md"), fromOpenEditor: true });
    const b = await enqueueSync(sql, { actorId: co, packageId: pkg, syncId: id, files: f("study-guide/a.md"), fromOpenEditor: true });
    expect(a.writeId).toBe(b.writeId);
    // The key the editor asks about on reopening (RC.17): it must find this row.
    const { rows } = await db.query<{ idem_key: string }>(`select idem_key from public.write_queue where id = $1`, [a.writeId]);
    expect(rows[0]!.idem_key).toBe(syncQueueKey(id));
  });
  it("refuses non-members, forbidden paths, and co-author-only limits", async () => {
    const bad = [
      { actorId: out, path: "study-guide/a.md" },
      { actorId: co, path: "README.md" },
      { actorId: owner, path: ".github/workflows/x.yml" },
      { actorId: owner, path: "private/sources/src_abcdefghijklmnopqrstuvwxyz.json" },
      { actorId: owner, path: "private/coursewerk/LOG.jsonl" },
      { actorId: owner, path: "alembic.json" },
      { actorId: owner, path: "study-guide/../private/instructor/k.md" },
    ];
    for (const b of bad) {
      await expect(enqueueSync(sql, { actorId: b.actorId, packageId: pkg, syncId: randomUUID(), files: f(b.path), fromOpenEditor: false }), b.path).rejects.toBeInstanceOf(SyncRefused);
    }
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from public.write_queue where package_id = $1`, [pkg]);
    expect(rows[0]!.n).toBe(1);
  });
  it("refuses a non-UUID key and oversized changes", async () => {
    await expect(enqueueSync(sql, { actorId: owner, packageId: pkg, syncId: "public:abc", files: f("study-guide/a.md"), fromOpenEditor: false })).rejects.toThrow(/sync id/);
    await expect(enqueueSync(sql, { actorId: owner, packageId: pkg, syncId: randomUUID(), files: [{ path: "study-guide/a.md", baseVersion: null, text: "x".repeat(2_000_001) }], fromOpenEditor: false })).rejects.toThrow(/too large/);
  });
});
