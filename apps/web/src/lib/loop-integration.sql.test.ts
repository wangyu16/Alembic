/**
 * Loop r1 + r1b integration (2026-10-23): the two rounds' migrations compose.
 *
 * r1 (0025_loop_r1_1…5) narrowed what the API roles may write (column grants
 * on `packages`, owner-only listing consent, server-only events); r1b (0026,
 * 0027) added trigger-owned recency columns, a deferral queue, a docId guard
 * trigger and the registry flush RPC. Both were written against the same
 * baseline, so these checks pin the seams: the order applies, r1b's write path
 * still works as an educator's own session under r1's rules, r1's service-role
 * trust writes pass r1b's triggers, and r1b's projector keeps r1's trust rules
 * (0026 redefines the projector 0025_2 had already redefined).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, migrationFiles, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let owner: string;
let stranger: string;

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "edu");
  stranger = await seedUser(db, "stranger");
}, 60_000);
afterAll(async () => {
  await db?.close();
});

async function attempt(fn: () => Promise<unknown>): Promise<"ok" | string> {
  try {
    await fn();
    return "ok";
  } catch (e) {
    return (e as Error).message;
  }
}

const row = (packageId: string, docId: string, over: Record<string, unknown> = {}) => ({
  doc_id: docId,
  package_id: packageId,
  repo: "public",
  path: `assets/${docId}.svg`,
  space: "assets",
  kind: "svg",
  source_hash: "h1",
  origin: "created",
  discoverable: true,
  permalink_class: "object",
  description: "A titration curve for a weak acid",
  content_sha256: "a".repeat(64),
  ...over,
});

const apply = (user: string, packageId: string, tombstones: string[], rows: unknown[]) =>
  asRole(
    db,
    "authenticated",
    () =>
      db.query(`select public.documents_apply($1, $2, $3)`, [packageId, tombstones, JSON.stringify(rows)]),
    user,
  );

const elementIds = async (packageId: string) =>
  (
    await db.query<{ doc_id: string }>(
      `select doc_id from public.discovery_elements where package_id = $1 order by doc_id`,
      [packageId],
    )
  ).rows.map((r) => r.doc_id);

const listingChangedAt = async (id: string) =>
  new Date(
    (await db.query<{ t: Date }>(`select listing_changed_at as t from public.packages where id = $1`, [id]))
      .rows[0]!.t,
  ).getTime();

describe("loop r1 + r1b: the migrations compose", () => {
  it("applies every migration in file order: 0025_loop_r1_1…5, then 0026, then 0027", async () => {
    const files = migrationFiles();
    const r1 = files.filter((f) => f.startsWith("0025_loop_r1_"));
    expect(r1).toHaveLength(5);
    const i26 = files.indexOf("0026_loop_r1b_discovery.sql");
    const i27 = files.indexOf("0027_loop_r1b_registry.sql");
    expect(Math.max(...r1.map((f) => files.indexOf(f)))).toBeLessThan(i26);
    expect(i26).toBeLessThan(i27);
    // One projector, 0026's signature (0025_2's two-argument one is replaced).
    const { rows } = await db.query<{ args: string }>(
      `select pg_get_function_identity_arguments(oid) as args from pg_proc where proname = 'discovery_refresh_package'`,
    );
    expect(rows.map((r) => r.args)).toEqual(["p_package_id text, p_content_changed boolean, p_doc_ids text[]"]);
  });

  it("the projector 0026 leaves keeps r1's trust rules: recorded repo and a11y, never the manifest's", async () => {
    const { rows } = await db.query<{ src: string }>(
      `select prosrc as src from pg_proc where proname = 'discovery_refresh_package'`,
    );
    const src = rows[0]!.src;
    expect(src).toMatch(/v_pkg\.a11y_status/);
    expect(src).toMatch(/v_pkg\.public_repo/);
    expect(src).not.toMatch(/'publicRepo'/);
    expect(src).not.toMatch(/'accessibility'/);
  });

  it("r1b's registry flush runs as the owner's own session under r1's grants and policies", async () => {
    const id = await seedPackage(db, { owner, listed: true });
    expect(await attempt(() => apply(owner, id, [], [row(id, "doc-integ1"), row(id, "doc-integ2")]))).toBe("ok");
    expect(await elementIds(id)).toEqual(["doc-integ1", "doc-integ2"]);
    expect(await attempt(() => apply(owner, id, ["doc-integ1"], []))).toBe("ok");
    expect(await elementIds(id)).toEqual(["doc-integ2"]);
    // Another educator's session cannot write into this package.
    expect(await attempt(() => apply(stranger, id, [], [row(id, "doc-integ3")]))).not.toBe("ok");
    expect(await elementIds(id)).toEqual(["doc-integ2"]);
    // Nor take over its docId from a package of their own.
    const theirs = await seedPackage(db, { owner: stranger, storage: "sandbox" });
    expect(await attempt(() => apply(stranger, theirs, [], [row(theirs, "doc-integ2")]))).not.toBe("ok");
    const { rows } = await db.query(`select package_id from public.documents where doc_id = 'doc-integ2'`);
    expect(rows).toEqual([{ package_id: id }]);
  });

  it("an owner's manifest edit (a granted column) moves the trigger-owned listing_changed_at; the column itself is not writable", async () => {
    const id = await seedPackage(db, { owner, listed: true });
    const t0 = await listingChangedAt(id);
    expect(
      await attempt(() =>
        asRole(
          db,
          "authenticated",
          () =>
            db.query(
              `update public.packages set manifest = manifest || '{"description":"Now described"}', updated_at = now() where id = $1`,
              [id],
            ),
          owner,
        ),
      ),
    ).toBe("ok");
    expect(await listingChangedAt(id)).toBeGreaterThan(t0);
    const t1 = await listingChangedAt(id);
    expect(
      await attempt(() =>
        asRole(
          db,
          "authenticated",
          () => db.query(`update public.packages set listing_changed_at = '2099-01-01' where id = $1`, [id]),
          owner,
        ),
      ),
    ).toMatch(/permission denied/i);
    expect(await listingChangedAt(id)).toBe(t1);
  });

  it("r1's service-role trust writes (publish, a11y check, archive, restore) pass r1b's triggers; the a11y record is listing recency", async () => {
    const id = await seedPackage(db, { owner, storage: "sandbox" });
    await db.query(
      `insert into public.portal_registrations (package_id, owner_id, title, license, public_repo_url, site_url)
       values ($1, $2, 't', 'CC-BY-4.0', 'x', 'y')`,
      [id, owner],
    );
    const svc = (sql: string) => asRole(db, "service_role", () => db.query(sql, [id]));
    // publish (recordPublished)
    expect(
      await attempt(() =>
        svc(
          `update public.packages set storage = 'github', public_repo = '{"owner":"edu","name":"rec-oer"}', default_branch = 'main' where id = $1`,
        ),
      ),
    ).toBe("ok");
    const course = async () =>
      (
        await db.query<{ accessibility_status: string; public_repo_url: string }>(
          `select accessibility_status, public_repo_url from public.discovery_courses where package_id = $1`,
          [id],
        )
      ).rows[0];
    expect(await course()).toEqual({
      accessibility_status: "unknown",
      public_repo_url: "https://github.com/edu/rec-oer",
    });
    // accessibility check (recordA11yCheck)
    const t0 = await listingChangedAt(id);
    expect(await attempt(() => svc(`update public.packages set a11y_status = 'pass', a11y_checked_at = now() where id = $1`))).toBe("ok");
    expect(await listingChangedAt(id)).toBeGreaterThan(t0);
    expect((await course())!.accessibility_status).toBe("pass");
    // archive / restore (setArchived)
    expect(await attempt(() => svc(`update public.packages set archived_at = now() where id = $1`))).toBe("ok");
    expect(await course()).toBeUndefined();
    expect(await attempt(() => svc(`update public.packages set archived_at = null where id = $1`))).toBe("ok");
    expect(await course()).toBeDefined();
  });

  it("the docId guard binds the service role too (no server path moves a docId across packages)", async () => {
    const a = await seedPackage(db, { owner });
    const b = await seedPackage(db, { owner });
    await apply(owner, a, [], [row(a, "doc-integsvc")]);
    expect(
      await attempt(() =>
        asRole(db, "service_role", () =>
          db.query(`update public.documents set package_id = $1 where doc_id = 'doc-integsvc'`, [b]),
        ),
      ),
    ).toMatch(/belongs to another package/);
  });
});
