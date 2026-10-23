/**
 * The discovery projection is derived in SQL (0022, redefined by 0025_* and
 * 0026 — the checks read the live definitions from pg_proc where a later
 * migration replaced 0022's), the schema is owned by package-contract. These checks keep the two in step: the SQL reads exactly
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
  it("[P5.A.1.j] [P5.S.3.b] the projector reads exactly the contract's manifest fields", async () => {
    // The projector as the migrations leave it (0025 redefines 0022's).
    const { rows } = await db.query<{ src: string }>(
      `select prosrc as src from pg_proc where proname = 'discovery_refresh_package'`,
    );
    expect(rows).toHaveLength(1);
    const read = new Set(
      [...rows[0]!.src.matchAll(/v_m\s*->>?\s*'([A-Za-z]+)'/g)].map((m) => m[1]!),
    );
    expect([...read].sort()).toEqual([...DISCOVERY_MANIFEST_FIELDS].sort());
  });

  it("[P5.A.1.j] projects exactly the contract's public courseContext keys", async () => {
    // The projector as the migrations leave it (0025_2, then 0026, redefine 0022's).
    const { rows } = await db.query<{ src: string }>(
      `select prosrc as src from pg_proc where proname = 'discovery_refresh_package'`,
    );
    expect(rows).toHaveLength(1);
    const m = rows[0]!.src.match(/where k in \(([^)]*)\)/);
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

  it("[P5.A.1.j] every space exclusion in the SQL is the contract's never-listed set", async () => {
    // 0022's text (its table checks and policies) plus every public function
    // as the later migrations left it (0025_*, 0026 redefine the projector,
    // the listability predicates and the documents triggers).
    const { rows } = await db.query<{ src: string }>(
      `select string_agg(p.prosrc, E'\\n' order by p.proname) as src
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosrc ~ 'space not in'`,
    );
    const live = rows[0]?.src ?? "";
    expect(live).toMatch(/space not in/);
    const lists = [...(SQL + "\n" + live).matchAll(/space not in \(([^)]*)\)/g)].map((m) =>
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
