/** Sources (migration 0041): the row is the authority; the storage key is never readable by members. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let owner: string;
let co: string;
let out: string;
let pkg: string;
const as = <T,>(u: string, sql: string, p: unknown[] = []) => asRole(db, "authenticated", () => db.query<T>(sql, p), u);
async function attempt(fn: () => Promise<unknown>): Promise<"ok" | "refused"> { try { await fn(); return "ok"; } catch { return "refused"; } }
const ID = "src_abcdefghijklmnopqrstuvwxyz";

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "owner");
  co = await seedUser(db, "co");
  out = await seedUser(db, "out");
  pkg = await seedPackage(db, { owner });
  await db.query(`insert into public.course_members (package_id, user_id, role) values ($1, $2, 'co-author')`, [pkg, co]);
  await db.query(
    `insert into public.sources (id, package_id, uploader_id, title, kind, sha256, size_bytes, storage_key) values ($1, $2, $3, 'Chemistry 2e', 'file', $4, 100, $5)`,
    [ID, pkg, co, "a".repeat(64), `${pkg}/0123456789abcdef0123456789abcdef`],
  );
}, 90_000);
afterAll(async () => { await db?.close(); });

describe("sources", () => {
  it("members read the pointer facts but never the storage key; outsiders read nothing", async () => {
    const r = await as<{ title: string }>(owner, `select id, title, ai_allowed from public.sources where id = $1`, [ID]);
    expect(r.rows).toHaveLength(1);
    expect(await attempt(() => as(owner, `select storage_key from public.sources where id = $1`, [ID]))).toBe("refused");
    expect(await attempt(() => as(co, `select * from public.sources`))).toBe("refused");
    expect((await as(out, `select id from public.sources`)).rows).toHaveLength(0);
  });
  it("only the uploader changes the flags; sharing needs an attestation; no direct writes", async () => {
    expect(await attempt(() => as(owner, `select public.source_set_flags($1, true, false, false)`, [ID]))).toBe("refused");
    expect(await attempt(() => as(co, `select public.source_set_flags($1, true, true, false)`, [ID]))).toBe("refused");
    expect(await attempt(() => as(co, `select public.source_set_flags($1, true, true, true)`, [ID]))).toBe("ok");
    expect(await attempt(() => as(co, `update public.sources set uploader_id = $2 where id = $1`, [ID, owner]))).toBe("refused");
    expect(await attempt(() => as(co, `insert into public.sources (id, package_id, uploader_id, title, kind) values ('src_zzzzzzzzzzzzzzzzzzzzzzzzzz', $1, $2, 't', 'link')`, [pkg, co]))).toBe("refused");
  });
  it("fingerprints are not readable by members", async () => {
    await db.query(`insert into public.source_fingerprints (source_id, n, hashes) values ($1, 8, array['x'])`, [ID]);
    expect(await attempt(() => as(owner, `select * from public.source_fingerprints`))).toBe("refused");
  });
});
