/**
 * Rate-limit windows never share a counter (migration 0034).
 *
 * rate_limit_hit stored one row per (key, window_start). Every caller charges
 * one key against an hourly and a daily window; in the first hour of each UTC
 * day both windows start at midnight, so they shared a row and every hit
 * counted twice (found when CI ran just after midnight UTC: the global report
 * cap let 30 reports through instead of 60).
 *
 * Real Postgres (PGlite) with every migration applied.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase } from "./discovery-pglite";

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
}, 60_000);
afterAll(async () => {
  await db?.close();
});

async function hit(key: string, seconds: number): Promise<number> {
  return asRole(db, "service_role", async () => {
    const { rows } = await db.query<{ n: number }>(`select public.rate_limit_hit($1, $2) as n`, [key, seconds]);
    return Number(rows[0]!.n);
  });
}

describe("rate-limit windows", () => {
  it("[P5.S.18] an hourly and a daily window of one key are counted in separate rows, at any time of day", async () => {
    await db.query(`delete from public.rate_limit_counters`);
    expect(await hit("probe:windows", 3600)).toBe(1);
    expect(await hit("probe:windows", 86400)).toBe(1);
    expect(await hit("probe:windows", 3600)).toBe(2);
    expect(await hit("probe:windows", 86400)).toBe(2);
    // The rows are distinct by key, not only by window start (which coincide at midnight UTC).
    const { rows } = await db.query<{ n: number }>(
      `select count(distinct key)::int as n from public.rate_limit_counters where key like 'probe:windows%'`,
    );
    expect(rows[0]!.n).toBe(2);
  });

  it("[P5.S.18] two windows that start at the same instant still never share a counter", async () => {
    await db.query(`delete from public.rate_limit_counters`);
    // 60 s and 120 s windows coincide every other minute; 1 s and 2 s every other second.
    for (let i = 0; i < 5; i++) {
      expect(await hit("probe:coincide", 1)).toBeGreaterThanOrEqual(1);
    }
    await hit("probe:coincide", 2);
    const { rows } = await db.query<{ k: string }>(
      `select distinct key as k from public.rate_limit_counters where key like 'probe:coincide%' order by 1`,
    );
    expect(rows.map((r) => r.k)).toEqual(["probe:coincide#1", "probe:coincide#2"]);
  });
});
