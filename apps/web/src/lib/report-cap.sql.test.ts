/**
 * Security loop r1, finding M4 — the database report caps (migration 0024)
 * counted BEFORE validating the package, and `package_id` has no foreign key:
 * ten junk reports silenced a package for an hour, and sixty reports on
 * made-up ids silenced reporting everywhere (repro: /tmp/alembic-audit/report.mts).
 *
 * Now (0025_loop_r1_3_report_cap.sql): a report must name a package that
 * exists and is listed (a listed course, or a course with a shared element)
 * before any cap is charged; the per-package cap is kept per (package,
 * reporter key) — the app passes an HMAC of the address, or of the signed-in
 * user — so one source cannot silence other reporters; the global cap is
 * charged only after validation. Anonymous reporting still works.
 *
 * Real Postgres (PGlite) with every migration applied.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, freshDatabase, seedDoc, seedPackage, seedUser } from "./discovery-pglite";

let db: PGlite;
let owner: string;

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db);
}, 60_000);
afterAll(async () => {
  await db?.close();
});

async function report(pkg: string, source: string | null, reason = "This copies my textbook"): Promise<string> {
  return asRole(db, "service_role", async () => {
    const { rows } = await db.query<{ r: string }>(
      `select public.file_portal_report_v2($1, $2, null, $3) as r`,
      [pkg, reason, source],
    );
    return rows[0]!.r;
  });
}

async function resetCounters() {
  await db.query(`delete from public.rate_limit_counters`);
}

describe("M4 a report is validated before any cap is charged", () => {
  it("[P5.S.5.a] reports on unknown or unlisted packages answer invalid, store nothing and charge nothing", async () => {
    await resetCounters();
    const listed = await seedPackage(db, { owner, listed: true });
    const trial = await seedPackage(db, { owner, storage: "sandbox", listed: false });
    const unlisted = await seedPackage(db, { owner, listed: false });
    for (let i = 0; i < 70; i++) expect(await report(`pkg-nonexistent-${i}`, `src-${i}`)).toBe("invalid");
    expect(await report(trial, "src-a")).toBe("invalid");
    expect(await report(unlisted, "src-a")).toBe("invalid");
    const { rows } = await db.query<{ n: string }>(`select count(*)::text as n from public.portal_reports`);
    expect(rows[0]!.n).toBe("0");
    // Nothing was charged: the legitimate report still goes through.
    expect(await report(listed, "src-legit", "Copyright violation")).toBe("ok");
  });

  it("[P5.S.5.a] a course that is not listed but shares an element can be reported", async () => {
    await resetCounters();
    const pkg = await seedPackage(db, { owner, listed: false });
    await seedDoc(db, { packageId: pkg });
    expect(await report(pkg, "src-el")).toBe("ok");
  });

  it("[P5.S.5.a] the old three-argument entry point validates too", async () => {
    await resetCounters();
    const { rows } = await asRole(db, "service_role", () =>
      db.query<{ r: string }>(`select public.file_portal_report('pkg-nope', 'x', null) as r`),
    );
    expect(rows[0]!.r).toBe("invalid");
  });
});

describe("M4 one source cannot silence a package", () => {
  it("[P5.S.5.b] the per-package cap is kept per reporter: a flooder is capped, another reporter is not", async () => {
    await resetCounters();
    const pkg = await seedPackage(db, { owner, listed: true });
    const answers: string[] = [];
    for (let i = 0; i < 12; i++) answers.push(await report(pkg, "flooder", "x"));
    expect(answers).toContain("rate_limited");
    expect(answers.filter((a) => a === "ok").length).toBeLessThanOrEqual(5);
    expect(await report(pkg, "someone-else", "This copies my textbook")).toBe("ok");
    // An anonymous report with no key at all still files.
    expect(await report(pkg, null, "anonymous concern")).toBe("ok");
  });

  it("[P5.S.5.b] the global cap still bounds the table, charged only by valid reports", async () => {
    await resetCounters();
    const pkg = await seedPackage(db, { owner, listed: true });
    let ok = 0;
    let limited = 0;
    for (let i = 0; i < 65; i++) {
      const r = await report(pkg, `rotating-${i}`, "x");
      if (r === "ok") ok++;
      if (r === "rate_limited") limited++;
    }
    expect(ok).toBe(60);
    expect(limited).toBe(5);
  });

  it("[P5.S.5.b] [P5.H.2.c] only the service role may file (anon and signed-in callers cannot)", async () => {
    const pkg = await seedPackage(db, { owner, listed: true });
    for (const role of ["anon", "authenticated"] as const) {
      for (const sql of [
        `select public.file_portal_report_v2($1, 'x', null, 'k')`,
        `select public.file_portal_report($1, 'x', null)`,
        `insert into public.portal_reports (package_id, reason) values ($1, 'x')`,
      ]) {
        await expect(asRole(db, role, () => db.query(sql, [pkg]), owner)).rejects.toThrow(
          /permission denied|row-level security/i,
        );
      }
    }
  });
});
