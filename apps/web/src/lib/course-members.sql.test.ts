/**
 * Course membership (migration 0036; docs/specs/v3/permissions-v3.md).
 * Claims A2.2 (partial: read access), A2.4, A2.5, A2.8 (database part),
 * A2.10, A2.12 — real Postgres (PGlite) with every migration applied.
 */
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, listPackage, seedDoc, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let owner: string;
let coauthor: string;
let outsider: string;
let pkg: string;
let other: string;

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

async function attempt(fn: () => Promise<unknown>): Promise<"ok" | "refused"> {
  try {
    await fn();
    return "ok";
  } catch {
    return "refused";
  }
}

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

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "owner");
  coauthor = await seedUser(db, "coauthor");
  outsider = await seedUser(db, "outsider");
  pkg = await seedPackage(db, { owner });
  other = await seedPackage(db, { owner: outsider });
  await seedDoc(db, { packageId: pkg, path: "assets/a.svg" });
}, 90_000);
afterAll(async () => {
  await db?.close();
});

describe("owner rows", () => {
  it("every package gets exactly one owner member, automatically", async () => {
    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.course_members where package_id = $1 and role = 'owner'`,
      [pkg],
    );
    expect(rows[0]!.n).toBe(1);
    expect(await role(owner, pkg)).toBe("owner");
    expect(await role(outsider, pkg)).toBeNull();
  });
});

describe("A2.10 invitations", () => {
  it("only the owner can invite", async () => {
    expect(await attempt(() => invite(outsider, pkg, "coauthor"))).toBe("refused");
  });

  it("the wrong account can't accept; the right one can, once", async () => {
    const token = await invite(owner, pkg, "coauthor");
    expect(await attempt(() => as(outsider, () => db.query(`select public.accept_invitation($1)`, [hash(token)])))).toBe("refused");
    expect(await attempt(() => as(coauthor, () => db.query(`select public.accept_invitation($1)`, [hash(token)])))).toBe("ok");
    expect(await role(coauthor, pkg)).toBe("co-author");
    expect(await attempt(() => as(coauthor, () => db.query(`select public.accept_invitation($1)`, [hash(token)])))).toBe("refused");
  });

  it("expired and revoked invitations are refused", async () => {
    const u = await seedUser(db, "late");
    const t1 = await invite(owner, pkg, "late");
    await db.query(`update public.course_invitations set expires_at = now() - interval '1 minute' where token_hash = $1`, [hash(t1)]);
    expect(await attempt(() => as(u, () => db.query(`select public.accept_invitation($1)`, [hash(t1)])))).toBe("refused");
    const t2 = await invite(owner, pkg, "late");
    const { rows } = await db.query<{ id: string }>(`select id from public.course_invitations where token_hash = $1`, [hash(t2)]);
    await as(owner, () => db.query(`select public.revoke_invitation($1)`, [rows[0]!.id]));
    expect(await attempt(() => as(u, () => db.query(`select public.accept_invitation($1)`, [hash(t2)])))).toBe("refused");
  });

  it("an owner role can't be invited, and anon can execute no membership function", async () => {
    await expect(
      db.query(
        `insert into public.course_invitations (package_id, invitee_login, role, token_hash, invited_by, expires_at)
         values ($1, 'x', 'owner', $2, $3, now() + interval '1 day')`,
        [pkg, hash("x"), owner],
      ),
    ).rejects.toThrow();
    for (const sql of [
      `select public.invite_member('${pkg}', 'x', '123', '${hash("y")}')`,
      `select public.accept_invitation('${hash("z")}')`,
      `select public.remove_member('${pkg}', '${coauthor}')`,
      `select public.transfer_owner('${pkg}', '${coauthor}')`,
      `select public.course_role('${pkg}')`,
    ]) {
      expect(await attempt(() => asRole(db, "anon", () => db.query(sql))), sql).toBe("refused");
    }
  });
});

describe("A2.3 / A2.6 no direct writes to membership", () => {
  it("a member can't insert, update or delete course_members or invitations directly", async () => {
    for (const sql of [
      `insert into public.course_members (package_id, user_id, role) values ('${other}', '${coauthor}', 'owner')`,
      `update public.course_members set role = 'owner' where user_id = '${coauthor}'`,
      `update public.course_members set deputy_until = now() + interval '1 day' where user_id = '${coauthor}'`,
      `delete from public.course_members where package_id = '${pkg}'`,
      `select * from public.course_invitations`,
    ]) {
      expect(await attempt(() => as(coauthor, () => db.query(sql))), sql).toBe("refused");
    }
    expect(await role(coauthor, pkg)).toBe("co-author");
  });
});

describe("A2.2 member reads", () => {
  it("members read their course's package, documents and membership; outsiders read none", async () => {
    const pk = await as(coauthor, () => db.query(`select id from public.packages where id = $1`, [pkg]));
    expect(pk.rows).toHaveLength(1);
    const docs = await as(coauthor, () => db.query(`select doc_id from public.documents where package_id = $1`, [pkg]));
    expect(docs.rows.length).toBeGreaterThan(0);
    const names = await as(coauthor, () => db.query(`select * from public.course_member_profiles($1)`, [pkg]));
    expect(names.rows).toHaveLength(2);
    const otherPkg = await as(coauthor, () => db.query(`select id from public.packages where id = $1`, [other]));
    expect(otherPkg.rows).toHaveLength(0);
    const otherNames = await as(coauthor, () => db.query(`select * from public.course_member_profiles($1)`, [other]));
    expect(otherNames.rows).toHaveLength(0);
  });

  it("members still can't write the package row (owner-only policies unchanged)", async () => {
    const r = await as(coauthor, () => db.query(`update public.packages set title = 'hijacked' where id = $1`, [pkg]));
    expect(r.affectedRows ?? 0).toBe(0);
    const { rows } = await db.query<{ title: string }>(`select title from public.packages where id = $1`, [pkg]);
    expect(rows[0]!.title).not.toBe("hijacked");
  });
});

describe("A2.4 deputy", () => {
  it("only the owner names a deputy, for at most 6 months, and the role lapses by itself", async () => {
    expect(await attempt(() => as(coauthor, () => db.query(`select public.name_deputy($1, $2, now() + interval '1 day')`, [pkg, coauthor])))).toBe("refused");
    expect(await attempt(() => as(owner, () => db.query(`select public.name_deputy($1, $2, now() + interval '1 year')`, [pkg, coauthor])))).toBe("refused");
    await as(owner, () => db.query(`select public.name_deputy($1, $2, now() + interval '1 day')`, [pkg, coauthor]));
    expect(await role(coauthor, pkg)).toBe("deputy");
    await db.query(`update public.course_members set deputy_until = now() - interval '1 second' where user_id = $1 and package_id = $2`, [coauthor, pkg]);
    expect(await role(coauthor, pkg)).toBe("co-author");
  });
});

describe("A2.5 transfer", () => {
  it("is one transaction: one owner, the old owner stays a co-author, listing consent follows", async () => {
    const p = await seedPackage(db, { owner });
    await listPackage(db, p, owner);
    const token = await invite(owner, p, "coauthor");
    await as(coauthor, () => db.query(`select public.accept_invitation($1)`, [hash(token)]));
    await as(owner, () => db.query(`select public.transfer_owner($1, $2)`, [p, coauthor]));
    expect(await role(coauthor, p)).toBe("owner");
    expect(await role(owner, p)).toBe("co-author");
    const { rows } = await db.query<{ o: string; r: string }>(
      `select p.owner_id as o, r.owner_id as r from public.packages p join public.portal_registrations r on r.package_id = p.id where p.id = $1`,
      [p],
    );
    expect(rows[0]).toEqual({ o: coauthor, r: coauthor });
  });

  it("only to an existing co-author, and only by the owner", async () => {
    const p = await seedPackage(db, { owner });
    expect(await attempt(() => as(owner, () => db.query(`select public.transfer_owner($1, $2)`, [p, outsider])))).toBe("refused");
    expect(await attempt(() => as(outsider, () => db.query(`select public.transfer_owner($1, $2)`, [p, outsider])))).toBe("refused");
  });
});

describe("A2.8 / A2.12 removal and bans", () => {
  it("a removed member loses access at once", async () => {
    const p = await seedPackage(db, { owner });
    const u = await seedUser(db, "temp");
    const token = await invite(owner, p, "temp");
    await as(u, () => db.query(`select public.accept_invitation($1)`, [hash(token)]));
    expect(await role(u, p)).toBe("co-author");
    await as(owner, () => db.query(`select public.remove_member($1, $2)`, [p, u]));
    expect(await role(u, p)).toBeNull();
    const rows = await as(u, () => db.query(`select id from public.packages where id = $1`, [p]));
    expect(rows.rows).toHaveLength(0);
  });

  it("the owner can't leave or be removed", async () => {
    expect(await attempt(() => as(owner, () => db.query(`select public.leave_course($1)`, [pkg])))).toBe("refused");
    await as(owner, () => db.query(`select public.remove_member($1, $2)`, [pkg, owner]));
    expect(await role(owner, pkg)).toBe("owner");
  });

  it("a banned member has no role and reads nothing", async () => {
    const p = await seedPackage(db, { owner });
    const u = await seedUser(db, "banned");
    const token = await invite(owner, p, "banned");
    await as(u, () => db.query(`select public.accept_invitation($1)`, [hash(token)]));
    await db.query(`update auth.users set banned_until = now() + interval '1 day' where id = $1`, [u]);
    expect(await role(u, p)).toBeNull();
    const rows = await as(u, () => db.query(`select id from public.packages where id = $1`, [p]));
    expect(rows.rows).toHaveLength(0);
  });
});
