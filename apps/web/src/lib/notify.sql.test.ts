/** Email preferences and the Needs-you email feed (migration 0046; C8). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
const svc = <T,>(sql: string, p: unknown[] = []) => asRole(db, "service_role", () => db.query<T>(sql, p));
async function attempt(fn: () => Promise<unknown>): Promise<"ok" | "refused"> { try { await fn(); return "ok"; } catch { return "refused"; } }
const due = async (every: string, key: string) =>
  (await svc<{ user_id: string; email: string }>(`select * from public.notify_due_people($1, $2)`, [every, key])).rows;
const raise = (pkg: string, kind: string, key: string, title: string, addressed: string[] = []) =>
  svc(`select public.needs_you_raise($1, $2, 'platform', $3, $4, 'Chapter 1', null, false, $5::uuid[])`, [pkg, kind, key, JSON.stringify({ title }), addressed]);

let owner: string, coauthor: string, loner: string, pkg: string;

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "nown"); coauthor = await seedUser(db, "nco"); loner = await seedUser(db, "nlone");
  for (const [u, e] of [[owner, "own@example.org"], [coauthor, "co@example.org"], [loner, "lone@example.org"]]) {
    await db.query(`update auth.users set email = $2 where id = $1`, [u, e]);
  }
  pkg = await seedPackage(db, { owner });
  await db.query(`insert into public.course_members (package_id, user_id, role) values ($1, $2, 'co-author')`, [pkg, coauthor]);
}, 90_000);
afterAll(async () => { await db?.close(); });

describe("Needs-you email feed", () => {
  it("lists course members due for the period (weekly by default), once per period", async () => {
    const ids = (await due("week", "2026-W44")).map((r) => r.user_id).sort();
    expect(ids).toEqual([owner, coauthor].sort()); // not someone on no course
    await svc(`select public.notify_mark_sent($1, '2026-W44')`, [owner]);
    expect((await due("week", "2026-W44")).map((r) => r.user_id)).toEqual([coauthor]);
    expect((await due("week", "2026-W45")).length).toBe(2);
  });

  it("follows each person's own setting; nobody can change someone else's", async () => {
    await asRole(db, "authenticated", () => db.query(`select public.set_email_every('off')`), coauthor);
    expect((await due("week", "2026-W46")).map((r) => r.user_id)).toEqual([owner]);
    await asRole(db, "authenticated", () => db.query(`select public.set_email_every('day')`), coauthor);
    expect((await due("day", "2026-10-28")).map((r) => r.user_id)).toEqual([coauthor]);
    expect(await attempt(() => asRole(db, "authenticated", () => db.query(`select public.set_email_every('monthly')`), owner))).toBe("refused");
    expect(await attempt(() => asRole(db, "anon", () => db.query(`select public.set_email_every('off')`)))).toBe("refused");
  });

  it("items: live ones in the person's courses, for everyone or addressed to them", async () => {
    await raise(pkg, "approve", "k1", "Chapter 1 plan", [owner]);
    await raise(pkg, "update", "k2", "New figure style");
    const forOwner = (await svc<{ kind: string; title: string; course_title: string }>(`select * from public.notify_items($1)`, [owner])).rows;
    const forCo = (await svc<{ kind: string }>(`select * from public.notify_items($1)`, [coauthor])).rows;
    expect(forOwner.map((r) => r.kind).sort()).toEqual(["approve", "update"]);
    expect(forOwner[0]!.course_title).toBeTruthy();
    expect(forCo.map((r) => r.kind)).toEqual(["update"]);
    expect((await svc(`select * from public.notify_items($1)`, [loner])).rows).toHaveLength(0);
  });

  it("members can't read addresses or other people's items", async () => {
    expect(await attempt(() => asRole(db, "authenticated", () => db.query(`select * from public.notify_due_people('week', 'x')`), owner))).toBe("refused");
    expect(await attempt(() => asRole(db, "authenticated", () => db.query(`select * from public.notify_items($1)`, [owner]), coauthor))).toBe("refused");
  });
});
