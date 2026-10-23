/**
 * Loop r2, improvement 1 (claim P5.S.13): the SQL test harness replays the
 * migrations the way Supabase applies them — as a NON-superuser owner, each
 * file in a fresh session — so a migration that only works as a superuser, or
 * that leans on session state an earlier file left behind, fails in tests
 * instead of in production (round 1's 42501 on 0025 did exactly that).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, OWNER_ROLE, readMigration, replayMigrations } from "./discovery-pglite";

const PRELOAD = /^select extensions\.similarity\('a', 'a'\);$/m;
const FIRST_0025 = "0025_loop_r1_1_listing_consent.sql";

let db: PGlite;
beforeAll(async () => {
  db = await freshDatabase();
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("P5.S.13 the harness is Supabase-shaped (non-superuser owner, fresh sessions)", () => {
  it("[P5.S.13] tests run as the non-superuser owner, which owns every migrated object and cannot set superuser parameters", async () => {
    const { rows } = await db.query<{ u: string; su: boolean; bypass: boolean }>(
      `select current_user u, r.rolsuper su, r.rolbypassrls bypass from pg_roles r where r.rolname = current_user`,
    );
    expect(rows).toEqual([{ u: OWNER_ROLE, su: false, bypass: true }]);
    const owners = await db.query<{ o: string }>(
      `select distinct pg_get_userbyid(relowner) o from pg_class where relnamespace = 'public'::regnamespace
       union select distinct pg_get_userbyid(proowner) from pg_proc where pronamespace = 'public'::regnamespace`,
    );
    expect(owners.rows.map((r) => r.o)).toEqual([OWNER_ROLE]);
    await expect(db.exec(`set track_functions = 'all'`)).rejects.toThrow(/permission denied/);
  });

  it("[P5.S.13] with 0025's pg_trgm preload line removed, the fresh-session replay fails with 42501 (and the real file applies)", async () => {
    const before = await freshDatabase({ before: "0025" });
    const start = await before.dumpDataDir("none");
    await before.close();
    expect(PRELOAD.test(readMigration(FIRST_0025))).toBe(true);
    const err = await replayMigrations([FIRST_0025], {
      from: start,
      transform: (_f, sql) => sql.replace(PRELOAD, "-- (preload removed by the probe)"),
    }).then(
      () => null,
      (e: Error & { code?: string }) => e,
    );
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/permission denied to set parameter "pg_trgm\./);
    expect(err!.code).toBe("42501");
    // Control: the file as shipped applies in the same fresh-session replay.
    await expect(replayMigrations([FIRST_0025], { from: start })).resolves.toBeDefined();
  }, 120_000);

  it("[P5.S.13] the fresh session is load-bearing: the same stripped file passes in a session that already loaded pg_trgm", async () => {
    const reused = await freshDatabase({ before: "0025" });
    try {
      await reused.query(`select extensions.similarity('a', 'a')`);
      await expect(
        reused.exec(readMigration(FIRST_0025).replace(PRELOAD, "-- (preload removed)")),
      ).resolves.toBeDefined();
    } finally {
      await reused.close();
    }
  }, 120_000);
});
