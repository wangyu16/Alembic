/**
 * The discovery projection is derived in SQL (0022), the schema is owned by
 * package-contract. These checks keep the two in step: the SQL reads exactly
 * the manifest fields the contract names, lists exactly the open licences,
 * and excludes exactly the never-listed spaces.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  ALL_RIGHTS_RESERVED,
  DISCOVERY_COURSE_CONTEXT_KEYS,
  DISCOVERY_MANIFEST_FIELDS,
  NEVER_LISTED_SPACES,
  OPEN_LICENSES,
  qualityScore,
  rankScore,
} from "@alembic/package-contract";
import { freshDatabase, readMigration } from "./discovery-pglite";

const SQL = readMigration("0022_trackA_discovery.sql");

let db: PGlite;
beforeAll(async () => {
  db = await freshDatabase();
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe("SQL ⇄ package-contract agreement (discovery)", () => {
  it("[P5.A.1.j] the projector reads exactly the contract's manifest fields", () => {
    const read = new Set(
      [...SQL.matchAll(/v_m\s*->>?\s*'([A-Za-z]+)'/g)].map((m) => m[1]!),
    );
    expect([...read].sort()).toEqual([...DISCOVERY_MANIFEST_FIELDS].sort());
  });

  it("[P5.A.1.j] projects exactly the contract's public courseContext keys", () => {
    const m = SQL.match(/where k in \(([^)]*)\)/);
    const keys = [...(m?.[1] ?? "").matchAll(/'([A-Za-z]+)'/g)].map((x) => x[1]);
    expect(keys.sort()).toEqual([...DISCOVERY_COURSE_CONTEXT_KEYS].sort());
  });

  it("[P5.A.1.j] lists exactly the open licences", async () => {
    for (const l of [...OPEN_LICENSES, ALL_RIGHTS_RESERVED, "", "cc-by-4.0"]) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select public.discovery_open_license($1) as ok`,
        [l],
      );
      expect(rows[0]!.ok, l).toBe((OPEN_LICENSES as readonly string[]).includes(l));
    }
  });

  it("[P5.A.1.j] every space exclusion in the SQL is the contract's never-listed set", () => {
    const lists = [...SQL.matchAll(/space not in \(([^)]*)\)/g)].map((m) =>
      [...m[1]!.matchAll(/'([a-z-]+)'/g)].map((x) => x[1]).sort(),
    );
    expect(lists.length).toBeGreaterThanOrEqual(5);
    for (const l of lists) expect(l).toEqual([...NEVER_LISTED_SPACES].sort());
  });

  it("[P5.A.3.e] ranking: SQL discovery_quality / discovery_score equal the contract's qualityScore / rankScore", async () => {
    const asOf = "2026-10-23T10:00:00.000Z";
    const cases: Array<[string, string, number, number, string, number]> = [];
    for (const a11y of ["pass", "warn", "fail", "unknown"])
      for (const license of ["CC-BY-4.0", "ALL-RIGHTS-RESERVED"])
        for (const completeness of [0, 0.4, 1])
          for (const adaptations of [0, 1, 7, 500])
            for (const updatedAt of ["2026-10-23T10:00:00.000Z", "2026-05-01T00:00:00.000Z", "1990-01-01T00:00:00.000Z", "2031-01-01T00:00:00.000Z"])
              for (const relevance of [0, 0.123456, 1.4])
                cases.push([a11y, license, completeness, adaptations, updatedAt, relevance]);
    for (const [a11y, license, completeness, adaptations, updatedAt, relevance] of cases) {
      const { rows } = await db.query<{ q: number; s: string }>(
        `select public.discovery_quality($1, $2, $3::real, $4, $5, $6) as q,
                public.discovery_score($7, public.discovery_quality($1, $2, $3::real, $4, $5, $6))::text as s`,
        [a11y, license, completeness, adaptations, updatedAt, asOf, relevance],
      );
      const q = qualityScore({ a11y, license, completeness, adaptations, updatedAt, asOf });
      expect(rows[0]!.q).toBeCloseTo(q, 6);
      expect(Number(rows[0]!.s)).toBeCloseTo(rankScore(relevance, q), 6);
    }
    expect(cases.length).toBeGreaterThan(1000);
  });
});
