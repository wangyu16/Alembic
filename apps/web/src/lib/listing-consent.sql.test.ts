/**
 * Security loop r1, finding H1 — the "List publicly" consent must come from
 * the package's owner. Before migration 0025 the portal_registrations write
 * policies checked only `auth.uid() = owner_id`, so any signed-in user could
 * insert a registration row for SOMEONE ELSE's published package (its id leaks
 * through the element search) and the projection treated that row as consent:
 * the victim's course was listed with the attacker's snapshot, and the victim
 * could not unlist it (their delete matched no row they own).
 *
 * The class: every API-role write policy whose row names a package must
 * require that the caller owns that package (P5.S.1.d).
 *
 * Real Postgres (PGlite) with every migration applied; the upgrade test
 * applies the migrations before 0025, seeds the bad state, then applies 0025.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  applyMigrationsFrom,
  asRole,
  freshDatabase,
  listPackage,
  seedDoc,
  seedPackage,
  seedUser,
} from "./discovery-pglite";

let db: PGlite;
let victim: string;
let attacker: string;

beforeAll(async () => {
  db = await freshDatabase();
  victim = await seedUser(db, "victim");
  attacker = await seedUser(db, "attacker");
}, 60_000);
afterAll(async () => {
  await db?.close();
});

const REG_INSERT = `insert into public.portal_registrations
  (package_id, owner_id, title, description, license, public_repo_url, site_url)
  values ($1, $2, $3, '', 'CC-BY-4.0', 'https://github.com/evil/x', 'https://evil.example/')`;

async function attempt(fn: () => Promise<unknown>): Promise<"ok" | "refused"> {
  try {
    await fn();
    return "ok";
  } catch {
    return "refused";
  }
}

async function listedIds(): Promise<string[]> {
  const { rows } = await asRole(db, "anon", () =>
    db.query<{ package_id: string }>(
      `select package_id from public.discovery_search_courses(p_limit => 51) order by package_id`,
    ),
  );
  return rows.map((r) => r.package_id);
}

describe("H1 a registration row is consent only when the package owner wrote it", () => {
  it("[P5.S.1.a] a signed-in user cannot list another educator's package", async () => {
    const pkg = await seedPackage(db, { owner: victim });
    await seedDoc(db, { packageId: pkg });
    const r = await attempt(() =>
      asRole(db, "authenticated", () => db.query(REG_INSERT, [pkg, attacker, "attacker title"]), attacker),
    );
    expect(r).toBe("refused");
    // Not even naming the victim as owner_id helps.
    const r2 = await attempt(() =>
      asRole(db, "authenticated", () => db.query(REG_INSERT, [pkg, victim, "attacker title"]), attacker),
    );
    expect(r2).toBe("refused");
    expect(await listedIds()).not.toContain(pkg);
  });

  it("[P5.S.1.a] nor rewrite or take over an existing listing", async () => {
    const pkg = await seedPackage(db, { owner: victim, listed: true });
    await asRole(
      db,
      "authenticated",
      () =>
        db.query(`update public.portal_registrations set title = 'pwned', owner_id = $2 where package_id = $1`, [
          pkg,
          attacker,
        ]),
      attacker,
    ).catch(() => undefined);
    const { rows } = await db.query<{ title: string; owner_id: string }>(
      `select title, owner_id from public.portal_registrations where package_id = $1`,
      [pkg],
    );
    expect(rows[0]).toMatchObject({ owner_id: victim });
    expect(rows[0]!.title).not.toBe("pwned");
  });

  it("[P5.S.1.a] the owner still lists, re-lists (upsert) and unlists their own course", async () => {
    const pkg = await seedPackage(db, { owner: victim });
    // Since loop r2 (NEW-5, 0028_loop_r2_4) registerPackageAction checks its
    // gates and then writes through the SERVICE client, naming the owner it
    // verified (lib/package-trust-writes.ts, recordListing). The statement it
    // issues for `.upsert()`:
    const upsert = `insert into public.portal_registrations
        (package_id, owner_id, title, description, license, public_repo_url, site_url)
      values ($1, $3, $2, '', 'CC-BY-4.0', 'u', 's')
      on conflict (package_id) do update set
        title = excluded.title, description = excluded.description,
        license = excluded.license, public_repo_url = excluded.public_repo_url, site_url = excluded.site_url`;
    await asRole(db, "service_role", () => db.query(upsert, [pkg, "Mine", victim]));
    await asRole(db, "service_role", () => db.query(upsert, [pkg, "Mine again", victim]));
    const { rows: reg } = await db.query<{ owner_id: string; title: string }>(
      `select owner_id, title from public.portal_registrations where package_id = $1`,
      [pkg],
    );
    expect(reg[0]).toEqual({ owner_id: victim, title: "Mine again" });
    expect(await listedIds()).toContain(pkg);
    // The owner's own session can no longer write it (P5.S.1.f) …
    expect(await attempt(() => asRole(db, "authenticated", () => db.query(upsert, [pkg, "Direct", victim]), victim))).toBe(
      "refused",
    );
    // … but still unlists it.
    const { rows } = await asRole(
      db,
      "authenticated",
      () =>
        db.query<{ package_id: string }>(
          `delete from public.portal_registrations where package_id = $1 returning package_id`,
          [pkg],
        ),
      victim,
    );
    expect(rows).toHaveLength(1);
    expect(await listedIds()).not.toContain(pkg);
  });

  it("[P5.S.1.b] a registration row whose owner is not the package owner lists nothing", async () => {
    const pkg = await seedPackage(db, { owner: victim });
    await seedDoc(db, { packageId: pkg });
    // A row that predates the policy fix (written as the database owner).
    await db.query(REG_INSERT, [pkg, attacker, "attacker title"]);
    await db.query(`select public.discovery_refresh_package($1, false)`, [pkg]);
    expect(await listedIds()).not.toContain(pkg);
    const { rows: listable } = await db.query<{ ok: boolean }>(
      `select public.discovery_course_listable($1) as ok`,
      [pkg],
    );
    expect(listable[0]!.ok).toBe(false);
    const { rows: projected } = await db.query(
      `select 1 from public.discovery_courses where package_id = $1`,
      [pkg],
    );
    expect(projected).toHaveLength(0);
    const { rows: facets } = await asRole(db, "anon", () =>
      db.query<{ n: string }>(`select n::text from public.discovery_course_facets() where facet = 'total'`),
    );
    const total = Number(facets[0]!.n);
    expect(total).toBe((await listedIds()).length);
    // The victim can remove the stray row (unlisting must work).
    const { rows: del } = await asRole(
      db,
      "authenticated",
      () =>
        db.query(`delete from public.portal_registrations where package_id = $1 returning package_id`, [pkg]),
      victim,
    );
    expect(del).toHaveLength(1);
  });

  it("[P5.S.1.c] neither anon nor a signed-in user can read a registration's owner_id", async () => {
    const pkg = await seedPackage(db, { owner: victim, listed: true });
    for (const role of ["anon", "authenticated"] as const) {
      const r = await attempt(() =>
        asRole(db, role, () => db.query(`select owner_id from public.portal_registrations`), attacker),
      );
      expect(r).toBe("refused");
      const star = await attempt(() =>
        asRole(db, role, () => db.query(`select * from public.portal_registrations`), attacker),
      );
      expect(star).toBe("refused");
    }
    // The public columns stay readable (the edit page asks "am I listed?").
    const { rows } = await asRole(db, "anon", () =>
      db.query<{ package_id: string }>(
        `select package_id, title, license, site_url from public.portal_registrations where package_id = $1`,
        [pkg],
      ),
    );
    expect(rows).toHaveLength(1);
  });
});

describe("H1 class: every write policy whose row names a package requires owning it", () => {
  it("[P5.S.1.d] documents, sandbox files, review items and AI logs for another's package are refused", async () => {
    const pkg = await seedPackage(db, { owner: victim });
    const tries: Array<[string, string, unknown[]]> = [
      [
        "documents",
        `insert into public.documents (doc_id, package_id, repo, path, space, kind, origin, permalink_class)
         values ('doc-evil1', $1, 'public', 'assets/x.svg', 'assets', 'svg', 'created', 'object')`,
        [pkg],
      ],
      [
        "sandbox_files",
        `insert into public.sandbox_files (package_id, repo, path, content) values ($1, 'public', 'x.md', 'x')`,
        [pkg],
      ],
      [
        "package_changes",
        `insert into public.package_changes (package_id, user_id, tier, kind, summary, status)
         values ($1, $2, 2, 'edit', 'evil', 'pending')`,
        [pkg, attacker],
      ],
      [
        "ai_invocations",
        `insert into public.ai_invocations (user_id, package_id, kind, provider, model)
         values ($2, $1, 'draft-section', 'p', 'm')`,
        [pkg, attacker],
      ],
    ];
    const outcome: Record<string, string> = {};
    for (const [name, sql, params] of tries) {
      outcome[name] = await attempt(() => asRole(db, "authenticated", () => db.query(sql, params), attacker));
    }
    expect(outcome).toEqual({
      documents: "refused",
      sandbox_files: "refused",
      package_changes: "refused",
      ai_invocations: "refused",
    });
  });

  it("[P5.S.1.d] a suggestion must come from the sender's own package", async () => {
    const target = await seedPackage(db, { owner: victim, listed: true });
    const someoneElses = await seedPackage(db, { owner: victim });
    const own = await seedPackage(db, { owner: attacker });
    const send = (from: string) =>
      attempt(() =>
        asRole(
          db,
          "authenticated",
          () =>
            db.query(
              `insert into public.suggestions (target_package_id, from_package_id, from_user_id,
                 chapter_path, source_block_id, suggested_body)
               values ($1, $2, $3, 'study-guide/x.md', 'b1', 'body')`,
              [target, from, attacker],
            ),
          attacker,
        ),
      );
    expect(await send(someoneElses)).toBe("refused");
    expect(await send(own)).toBe("ok");
  });

  it("[P5.S.1.d] a stray registration row does not open the owner's suggestion inbox", async () => {
    const target = await seedPackage(db, { owner: victim });
    const from = await seedPackage(db, { owner: victim });
    await listPackage(db, target, victim);
    await db.query(
      `insert into public.suggestions (target_package_id, from_package_id, from_user_id,
         chapter_path, source_block_id, suggested_body)
       values ($1, $2, $3, 'study-guide/x.md', 'b1', 'private note')`,
      [target, from, victim],
    );
    // Simulate a hijacked row (pre-0025 state) by rewriting the owner directly.
    await db.query(`update public.portal_registrations set owner_id = $2 where package_id = $1`, [
      target,
      attacker,
    ]);
    const { rows } = await asRole(
      db,
      "authenticated",
      () => db.query(`select id from public.suggestions where target_package_id = $1`, [target]),
      attacker,
    );
    expect(rows).toHaveLength(0);
    const { rows: resolved } = await asRole(
      db,
      "authenticated",
      () =>
        db.query(
          `update public.suggestions set status = 'rejected' where target_package_id = $1 returning id`,
          [target],
        ),
      attacker,
    );
    expect(resolved).toHaveLength(0);
    // The real owner still reads and resolves their inbox.
    const { rows: mine } = await asRole(
      db,
      "authenticated",
      () => db.query(`select id from public.suggestions where target_package_id = $1`, [target]),
      victim,
    );
    expect(mine).toHaveLength(1);
  });
});

describe("H1 upgrade: 0025 removes registration rows the package owner did not write", () => {
  it("[P5.S.1.b] mismatched rows are deleted, matching rows kept", async () => {
    let old = await freshDatabase({ before: "0025" });
    try {
      const v = await seedUser(old, "v");
      const a = await seedUser(old, "a");
      const hijacked = await seedPackage(old, { owner: v });
      const genuine = await seedPackage(old, { owner: v, listed: true });
      await old.query(REG_INSERT, [hijacked, a, "attacker title"]);
      // The operator's pre-check named in the migration header.
      const { rows: before } = await old.query<{ n: string }>(
        `select count(*)::text as n from public.portal_registrations r
           join public.packages p on p.id = r.package_id where r.owner_id <> p.owner_id`,
      );
      expect(before[0]!.n).toBe("1");
      old = await applyMigrationsFrom(old, "0025");
      const { rows } = await old.query<{ package_id: string }>(
        `select package_id from public.portal_registrations order by package_id`,
      );
      expect(rows.map((r) => r.package_id)).toEqual([genuine]);
    } finally {
      await old.close();
    }
  }, 60_000);
});
