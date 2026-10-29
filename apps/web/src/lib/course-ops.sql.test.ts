/** Course operations over the real SQL (PGlite, every migration): the courseop kind, its actor rule, and Publish waiting for it (contract v3 §13.3). */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { SqlQueueStore } from "@alembic/package-ops";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let owner: string;
let pkg: string;
const sql = { query: <T,>(t: string, p?: unknown[]) => asRole(db, "service_role", () => db.query<T>(t, p)) };

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "owner");
  pkg = await seedPackage(db, { owner });
}, 90_000);
afterAll(async () => { await db?.close(); });

const publish = () => asRole(db, "authenticated", () => db.query(`select public.request_publish($1, '{}'::jsonb) as id`, [pkg]), owner);

describe("course operations in the queue (K1.15)", () => {
  it("[K1.15] a courseop row needs an actor, and Publish waits while one is on its way", async () => {
    const store = new SqlQueueStore(sql as never);
    await expect(store.insert({ packageId: pkg, kind: "courseop", idem: randomUUID(), payload: { files: [], op: { op: "removeChapter", slug: "gases" } } })).rejects.toThrow();
    const id = await store.insert({ packageId: pkg, kind: "courseop", idem: randomUUID(), actorId: owner, payload: { files: [], op: { op: "renameChapter", slug: "gases", title: "Gas Laws" } } });
    await expect(publish()).rejects.toThrow(/still being saved/);
    await sql.query(`update public.write_queue set status = 'done' where id = $1`, [id]);
    await expect(publish()).resolves.toBeTruthy();
  });
});
