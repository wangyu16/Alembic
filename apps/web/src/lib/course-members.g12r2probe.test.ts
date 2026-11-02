/**
 * G1 round-2 adversary probe against migration 0036 (permissions-v3.md).
 * The test asserts what the spec requires; a failure is a finding.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const as = <T>(user: string, fn: () => Promise<T>) => asRole(db, "authenticated", fn, user);
const role = async (user: string, p: string) =>
  (await as(user, () => db.query<{ r: string | null }>(`select public.course_role($1) as r`, [p]))).rows[0]!.r;
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
const rename = (u: string, login: string) => db.query(`update public.profiles set github_username = $2 where id = $1`, [u, login]);

beforeAll(async () => {
  db = await freshDatabase();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("G1 round-2 probe", () => {
  it("LOW: a removed member rejoins with an open invitation sent to their earlier GitHub login", async () => {
    const owner = await seedUser(db, "rn-owner");
    const bob = await seedUser(db, "rn-bob");
    const p = await seedPackage(db, { owner });
    const old = await invite(owner, p, "rn-bob"); // sent, never used
    await rename(bob, "rn-robert"); // Bob renames on GitHub; the install callback updates the profile
    await accept(bob, await invite(owner, p, "rn-robert"));
    expect(await role(bob, p)).toBe("co-author");
    await as(owner, () => db.query(`select public.remove_member($1, $2)`, [p, bob])); // revokes 'rn-robert' only
    await rename(bob, "rn-bob"); // renames back
    try {
      await accept(bob, old);
    } catch {
      /* refused is the required outcome */
    }
    // A2.8 / G1 F1: no open invitation lets a removed person back in.
    expect(await role(bob, p)).toBeNull();
  });
});
