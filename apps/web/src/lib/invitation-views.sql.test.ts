/** The People page's invitation views (migration 0047; E1). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, githubIdFor, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let owner: string, co: string, invitee: string, pkg: string;
async function attempt(fn: () => Promise<unknown>): Promise<"ok" | "refused"> { try { await fn(); return "ok"; } catch { return "refused"; } }
const as = <T,>(u: string, sql: string, p: unknown[] = []) => asRole(db, "authenticated", () => db.query<T>(sql, p), u);
const svc = <T,>(sql: string, p: unknown[] = []) => asRole(db, "service_role", () => db.query<T>(sql, p));
const hash = (n: number) => n.toString(16).padStart(64, "0");

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "vown"); co = await seedUser(db, "vco"); invitee = await seedUser(db, "vinv");
  await db.query(`update public.profiles set github_username = 'Vinv' where id = $1`, [invitee]);
  await db.query(`update auth.users set email = 'inv@example.org' where id = $1`, [invitee]);
  pkg = await seedPackage(db, { owner });
  await db.query(`insert into public.course_members (package_id, user_id, role) values ($1, $2, 'co-author')`, [pkg, co]);
}, 90_000);
afterAll(async () => { await db?.close(); });

describe("invitation views", () => {
  it("the owner lists open invitations, without token hashes; others can't", async () => {
    const id = (await as<{ id: string }>(owner, `select public.invite_member($1, 'vinv', $2, $3) as id`, [pkg, githubIdFor(invitee), hash(1)])).rows[0]!.id;
    await as(owner, `select public.invite_member($1, 'nobody-here', '999999999', $2)`, [pkg, hash(2)]);
    const rows = (await as<Record<string, unknown>>(owner, `select * from public.course_open_invitations($1)`, [pkg])).rows;
    expect(rows.map((r) => r["invitee_login"]).sort()).toEqual(["nobody-here", "vinv"]);
    expect(Object.keys(rows[0]!)).not.toContain("token_hash");
    expect(await attempt(() => as(co, `select * from public.course_open_invitations($1)`, [pkg]))).toBe("refused");
    // Revoked ones drop off the list.
    await as(owner, `select public.revoke_invitation($1)`, [id]);
    expect((await as(owner, `select * from public.course_open_invitations($1)`, [pkg])).rows).toHaveLength(1);
  });

  it("matching is by GitHub's numeric id: a stale or copied login gets neither the email nor the course (review M)", async () => {
    // Mallory's profile claims the login 'vinv' too (stale or copied); the invitation is for the real vinv's id.
    const mallory = await seedUser(db, "vmal");
    await db.query(`update public.profiles set github_username = 'vinv' where id = $1`, [mallory]);
    await db.query(`update auth.users set email = 'mal@example.org' where id = $1`, [mallory]);
    const id = (await as<{ id: string }>(owner, `select public.invite_member($1, 'vinv', $2, $3) as id`, [pkg, githubIdFor(invitee), hash(5)])).rows[0]!.id;
    expect((await svc<{ a: string | null }>(`select public.invitee_address($1) as a`, [id])).rows[0]!.a).toBe("inv@example.org");
    expect(await attempt(() => as(mallory, `select public.accept_invitation($1)`, [hash(5)]))).toBe("refused");
    expect(await attempt(() => as(invitee, `select public.accept_invitation($1)`, [hash(5)]))).toBe("ok");
  });

  it("an invitee who already uses Alembic can be emailed (service role only); an unknown login gives nothing", async () => {
    const id = (await as<{ id: string }>(owner, `select public.invite_member($1, 'VINV', $2, $3) as id`, [pkg, githubIdFor(invitee), hash(3)])).rows[0]!.id;
    const other = (await as<{ id: string }>(owner, `select public.invite_member($1, 'stranger', '999999998', $2) as id`, [pkg, hash(4)])).rows[0]!.id;
    expect((await svc<{ a: string | null }>(`select public.invitee_address($1) as a`, [id])).rows[0]!.a).toBe("inv@example.org");
    expect((await svc<{ a: string | null }>(`select public.invitee_address($1) as a`, [other])).rows[0]!.a).toBeNull();
    expect(await attempt(() => as(owner, `select public.invitee_address($1)`, [id]))).toBe("refused");
  });
});
