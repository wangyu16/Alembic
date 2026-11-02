/**
 * G1 adversary probes against migrations 0036–0038 (permissions-v3.md).
 * Each `it` asserts what the spec requires; a failing case is a finding.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, listPackage, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const as = <T>(user: string, fn: () => Promise<T>) => asRole(db, "authenticated", fn, user);
const role = async (user: string, p: string) =>
  (await as(user, () => db.query<{ r: string | null }>(`select public.course_role($1) as r`, [p]))).rows[0]!.r;
async function attempt(fn: () => Promise<unknown>): Promise<"ok" | "refused"> {
  try {
    await fn();
    return "ok";
  } catch {
    return "refused";
  }
}
async function invite(by: string, p: string, login: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  // The server resolves the login to GitHub's numeric id; here, from the seeded identities.
  const gid = (await db.query<{ g: string }>(
    `select coalesce((select i.provider_id from auth.identities i join public.profiles pr on pr.id = i.user_id
                       where i.provider = 'github' and lower(pr.github_username) = lower($1) limit 1), '999999999') as g`, [login])).rows[0]!.g;
  await as(by, () => db.query(`select public.invite_member($1, $2, $3, $4)`, [p, login, gid, hash(token)]));
  return token;
}
const accept = (u: string, token: string) => as(u, () => db.query(`select public.accept_invitation($1)`, [hash(token)]));

beforeAll(async () => {
  db = await freshDatabase();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("G1 probes", () => {
  it("0038: the course installation id is service-role only (a co-author can't read it)", async () => {
    const owner = await seedUser(db, "inst-owner");
    const co = await seedUser(db, "inst-co");
    const p = await seedPackage(db, { owner });
    await db.query(`insert into public.course_installations (package_id, installation_id) values ($1, 424242)`, [p]);
    await accept(co, await invite(owner, p, "inst-co"));
    const r = await attempt(() => as(co, () => db.query(`select installation_id from public.course_installations where package_id = $1`, [p])));
    expect(r).toBe("refused");
  });

  it("an invitation the previous owner sent can't be accepted after a transfer", async () => {
    const a = await seedUser(db, "tr-a");
    const b = await seedUser(db, "tr-b");
    const x = await seedUser(db, "tr-x");
    const p = await seedPackage(db, { owner: a });
    await accept(b, await invite(a, p, "tr-b"));
    const pending = await invite(a, p, "tr-x"); // A's invitation, still open
    await as(a, () => db.query(`select public.transfer_owner($1, $2)`, [p, b]));
    expect(await attempt(() => accept(x, pending))).toBe("refused");
  });

  it("A2.8: a removed member can't rejoin with a second invitation that was open at removal", async () => {
    const owner = await seedUser(db, "rm-owner");
    const u = await seedUser(db, "rm-u");
    const p = await seedPackage(db, { owner });
    const first = await invite(owner, p, "rm-u");
    const resent = await invite(owner, p, "rm-u"); // e.g. "resend invitation"
    await accept(u, first);
    await as(owner, () => db.query(`select public.remove_member($1, $2)`, [p, u]));
    expect(await attempt(() => accept(u, resent))).toBe("refused");
  });

  it("§2: the owner row is the source of truth and packages.owner_id follows it (trigger)", async () => {
    const a = await seedUser(db, "sot-a");
    const b = await seedUser(db, "sot-b");
    const p = await seedPackage(db, { owner: a });
    await listPackage(db, p, a);
    await accept(b, await invite(a, p, "sot-b"));
    // An ownership change made by any path other than transfer_owner (e.g. the
    // operator's succession, transfer.succession): swap the owner row.
    await db.query(`update public.course_members set role = 'co-author' where package_id = $1 and user_id = $2`, [p, a]);
    await db.query(`update public.course_members set role = 'owner' where package_id = $1 and user_id = $2`, [p, b]);
    const { rows } = await db.query<{ o: string }>(`select owner_id as o from public.packages where id = $1`, [p]);
    expect(rows[0]!.o).toBe(b);
  });

});
