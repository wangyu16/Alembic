/** Publish records and approvals (migration 0042). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
const V = "a".repeat(64);
async function attempt(fn: () => Promise<unknown>): Promise<"ok" | "refused"> { try { await fn(); return "ok"; } catch { return "refused"; } }
beforeAll(async () => { db = await freshDatabase(); }, 90_000);
afterAll(async () => { await db?.close(); });

describe("approvals and publish records", () => {
  it("owner and deputy approve course-plan parts; co-authors and outsiders can't; members can't write records", async () => {
    const owner = await seedUser(db, "o"); const co = await seedUser(db, "c"); const dep = await seedUser(db, "d"); const out = await seedUser(db, "x");
    const pkg = await seedPackage(db, { owner });
    await db.query(`insert into public.course_members (package_id, user_id, role) values ($1, $2, 'co-author'), ($1, $3, 'co-author')`, [pkg, co, dep]);
    await db.query(`update public.course_members set deputy_until = now() + interval '1 day' where user_id = $1`, [dep]);
    const approve = (u: string, path: string) => asRole(db, "authenticated", () => db.query(`select public.approve_part($1, $2, $3)`, [pkg, path, V]), u);
    expect(await attempt(() => approve(owner, "concepts/a.md"))).toBe("ok");
    expect(await attempt(() => approve(dep, "assessment-support/a.md"))).toBe("ok");
    expect(await attempt(() => approve(co, "concepts/b.md"))).toBe("refused");
    expect(await attempt(() => approve(out, "concepts/b.md"))).toBe("refused");
    expect(await attempt(() => approve(owner, "study-guide/a.md"))).toBe("refused"); // not a plan part
    const { rows } = await db.query<{ r: string }>(`select approver_role as r from public.approvals where package_id = $1 order by part_path`, [pkg]);
    expect(rows.map((x) => x.r)).toEqual(["deputy", "owner"]);
    expect(await attempt(() => asRole(db, "authenticated", () => db.query(`insert into public.published_files (package_id, path, unit, blob_sha, run_id) values ($1, 'x', 'course', 'b', gen_random_uuid())`, [pkg]), owner))).toBe("refused");
    expect((await asRole(db, "authenticated", () => db.query(`select * from public.approvals where package_id = $1`, [pkg]), co)).rows).toHaveLength(2);
    expect((await asRole(db, "authenticated", () => db.query(`select * from public.approvals where package_id = $1`, [pkg]), out)).rows).toHaveLength(0);
  });
});
