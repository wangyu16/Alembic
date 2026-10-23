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
  it("the projector reads exactly the contract's manifest fields", () => {
    const read = new Set(
      [...SQL.matchAll(/v_m\s*->>?\s*'([A-Za-z]+)'/g)].map((m) => m[1]!),
    );
    expect([...read].sort()).toEqual([...DISCOVERY_MANIFEST_FIELDS].sort());
  });

  it("projects exactly the contract's public courseContext keys", () => {
    const m = SQL.match(/where k in \(([^)]*)\)/);
    const keys = [...(m?.[1] ?? "").matchAll(/'([A-Za-z]+)'/g)].map((x) => x[1]);
    expect(keys.sort()).toEqual([...DISCOVERY_COURSE_CONTEXT_KEYS].sort());
  });

  it("lists exactly the open licences", async () => {
    for (const l of [...OPEN_LICENSES, ALL_RIGHTS_RESERVED, "", "cc-by-4.0"]) {
      const { rows } = await db.query<{ ok: boolean }>(
        `select public.discovery_open_license($1) as ok`,
        [l],
      );
      expect(rows[0]!.ok, l).toBe((OPEN_LICENSES as readonly string[]).includes(l));
    }
  });

  it("every space exclusion in the SQL is the contract's never-listed set", () => {
    const lists = [...SQL.matchAll(/space not in \(([^)]*)\)/g)].map((m) =>
      [...m[1]!.matchAll(/'([a-z-]+)'/g)].map((x) => x[1]).sort(),
    );
    expect(lists.length).toBeGreaterThanOrEqual(5);
    for (const l of lists) expect(l).toEqual([...NEVER_LISTED_SPACES].sort());
  });
});
