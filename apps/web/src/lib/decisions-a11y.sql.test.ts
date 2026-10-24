/**
 * Owner decision 2 (2026-10-24) — the accessibility badge follows an
 * automatic check, and no current check is neutral in Discover.
 *
 * On the Supabase-shaped harness (non-superuser owner, every migration in a
 * fresh session — P5.S.13), with the app's own check runner
 * (`runPublishedA11yCheck`) and guarded record (`recordA11yCheck`) running
 * unchanged over the PGlite PostgREST double. The published repository is a
 * fake reader; the head it reports is what the check records.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { courseQualityScore, rankScore } from "@alembic/package-contract";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 180_000 });

import { asRole, freshDatabase, seedDoc, seedPackage, seedUser } from "./discovery-pglite";
import { pgliteClient } from "./pglite-postgrest";
import { SupabaseSandboxStore } from "./sandbox-store";
import { packageTrustWriter } from "./package-trust-writes";
import { A11yAutoScheduler, runPublishedA11yCheck } from "./a11y-auto";
import { A11Y_LABELS } from "./discovery-labels";

let db: PGlite;
let owner: string;

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db, "edu");
}, 180_000);
afterAll(async () => {
  await db?.close();
});

const MANIFEST = (id: string) =>
  JSON.stringify({ schemaVersion: 2, packageId: id, title: "T", license: "CC-BY-4.0", createdAt: "2026-08-28T00:00:00.000Z" });
const CLEAN = "## Intro {#b-aaaaaaaa}\n\nPlain prose with nothing to flag.\n";
const FAILING = "## Intro {#b-aaaaaaaa}\n\n![ ](figure.png)\n";

/** The published repository: its head, and what a chapter holds there. */
function repo(pkg: string, state: { head: string; chapter: string; onRead?: () => Promise<void> }) {
  return {
    getBranchHead: async () => ({ commitSha: state.head }),
    getFileAtRef: async (_c: unknown, path: string) => {
      await state.onRead?.();
      return path === "alembic.json" ? MANIFEST(pkg) : state.chapter;
    },
  };
}

/** The app's check, as the automatic path runs it (service-role store and record). */
const check = (pkg: string, connect: () => Promise<ReturnType<typeof repo> | null>) =>
  runPublishedA11yCheck(pkg, {
    store: new SupabaseSandboxStore(pgliteClient(db, "service_role")),
    userId: owner,
    connect,
    record: (v) => packageTrustWriter(() => pgliteClient(db, "service_role")).recordA11yCheck(pkg, owner, v),
  });

const own = <T,>(fn: () => Promise<T>) => asRole(db, "authenticated", fn, owner);
/** A save of a published course: Alembic's commit moves the recorded head. */
const save = (pkg: string, head: string) =>
  own(() => db.query(`update public.packages set last_synced_sha = $2 where id = $1`, [pkg, head]));

/** What an anonymous Discover visitor sees for the course. */
async function discover(pkg: string) {
  const search = await asRole(db, "anon", () =>
    db.query<{ accessibility_status: string }>(
      `select accessibility_status from public.discovery_search_courses(p_limit => 51) where package_id = $1`,
      [pkg],
    ),
  );
  const listing = await asRole(db, "anon", () =>
    db.query<{ s: string }>(`select accessibility_status s from public.portal_registrations where package_id = $1`, [pkg]),
  );
  const status = search.rows[0]!.accessibility_status;
  return { status, listing: listing.rows[0]!.s, badge: A11Y_LABELS[status] ?? null };
}

async function publishedCourse(title: string) {
  const p = await seedPackage(db, { owner, listed: true, title });
  await seedDoc(db, { packageId: p });
  await save(p, "c1");
  return p;
}

describe("decision 2(a): the badge follows an automatic check of the published head", () => {
  it("[P5.R.5.c] a commit expires then re-earns the badge", async () => {
    const p = await publishedCourse("Expires then re-earns");
    const gh = { head: "c1", chapter: CLEAN };
    expect(await check(p, async () => repo(p, gh))).toMatchObject({ kind: "recorded", status: "pass", headSha: "c1" });
    expect(await discover(p)).toMatchObject({ status: "pass", listing: "pass" });
    expect((await discover(p)).badge?.label).toBe("Accessible");

    // A save: the recorded head moves, the check expires (0030) — no badge.
    await save(p, "c2");
    gh.head = "c2";
    expect(await discover(p)).toEqual({ status: "unknown", listing: "unknown", badge: null });

    // The automatic re-check of that save (scheduled after the response).
    let after: Promise<void> | null = null;
    const scheduler = new A11yAutoScheduler({ schedule: (t) => void (after = t()), settleMs: 0 });
    expect(scheduler.request(p, () => check(p, async () => repo(p, gh)))).toBe("scheduled");
    await after;
    expect(await discover(p)).toMatchObject({ status: "pass", listing: "pass" });
    expect((await discover(p)).badge?.label).toBe("Accessible");
  });

  it("[P5.R.5.d] a failed audit hides the badge: nothing is recorded, the expired check stays expired", async () => {
    const p = await publishedCourse("Failed audit");
    expect((await check(p, async () => repo(p, { head: "c1", chapter: CLEAN }))).kind).toBe("recorded");
    await save(p, "c2");
    // the published copy cannot be read (not connected) …
    expect((await check(p, async () => null)).kind).toBe("unavailable");
    expect(await discover(p)).toEqual({ status: "unknown", listing: "unknown", badge: null });
    // … or the audit itself throws
    const broken = { getBranchHead: async () => ({ commitSha: "c2" }), getFileAtRef: async () => { throw new Error("502"); } };
    expect((await check(p, async () => broken)).kind).toBe("failed");
    expect(await discover(p)).toEqual({ status: "unknown", listing: "unknown", badge: null });
  });

  it("[P5.R.5.a] a check of a head a newer save replaced never lands (no badge for bytes nobody checked)", async () => {
    const p = await publishedCourse("Superseded");
    // The check reads head c1 … and while it audits, the educator saves (c2).
    const gh = { head: "c1", chapter: CLEAN, onRead: async () => { gh.onRead = undefined; await save(p, "c2"); } } as {
      head: string; chapter: string; onRead?: () => Promise<void>;
    };
    expect(await check(p, async () => repo(p, gh))).toMatchObject({ kind: "superseded", headSha: "c1" });
    expect(await discover(p)).toEqual({ status: "unknown", listing: "unknown", badge: null });
    // that save's own check records
    expect(await check(p, async () => repo(p, { head: "c2", chapter: FAILING }))).toMatchObject({ kind: "recorded", status: "fail" });
    expect((await discover(p)).badge?.label).toBe("Accessibility: needs work");
  });

  it("[P5.R.5.a] a trial course's check is never recorded, and another educator's check records nothing", async () => {
    const t = await seedPackage(db, { owner, storage: "sandbox", title: "Trial" });
    expect((await check(t, async () => repo(t, { head: "c1", chapter: CLEAN }))).kind).toBe("trial");
    expect((await db.query<{ s: string }>(`select a11y_status s from public.packages where id = $1`, [t])).rows[0]!.s).toBe("unknown");
    const p = await publishedCourse("Someone else's");
    const stranger = await seedUser(db, "stranger");
    const r = await runPublishedA11yCheck(p, {
      store: new SupabaseSandboxStore(pgliteClient(db, "service_role")),
      userId: stranger,
      connect: async () => repo(p, { head: "c1", chapter: CLEAN }),
      record: (v) => packageTrustWriter(() => pgliteClient(db, "service_role")).recordA11yCheck(p, stranger, v),
    });
    expect(r.kind).toBe("unavailable");
    expect((await discover(p)).status).toBe("unknown");
  });
});

describe("decision 2(b): no current check is neutral in Discover (0032)", () => {
  const asOf = "2026-10-24T10:00:00.000Z";
  async function scores(q: string) {
    const { rows } = await asRole(db, "anon", () =>
      db.query<{ package_id: string; accessibility_status: string; score: string; completeness: number; updated_at: Date; adaptation_count: number; license: string }>(
        `select package_id, accessibility_status, score::text as score, completeness, updated_at, adaptation_count, license
           from public.discovery_search_courses(p_q => $1, p_as_of => $2, p_limit => 51)`,
        [q, asOf],
      ),
    );
    return rows;
  }

  it("[P5.R.5.e] ranking neutral without a check: unknown ranks between pass and fail, never with fail, and SQL = contract", async () => {
    const ids: Record<string, string> = {};
    for (const a11y of ["pass", "unknown", "fail"] as const) {
      ids[a11y] = await seedPackage(db, { owner, listed: true, title: `Zymurgy fermentation kinetics`, a11y });
      await seedDoc(db, { packageId: ids[a11y]! });
    }
    const rows = await scores("zymurgy fermentation");
    const by = (a: string) => rows.find((r) => r.package_id === ids[a])!;
    const [pass, unknown, fail] = [by("pass"), by("unknown"), by("fail")];
    expect(Number(pass.score)).toBeGreaterThan(Number(unknown.score));
    expect(Number(unknown.score)).toBeGreaterThan(Number(fail.score)); // was equal before 0032 (unknown counted as 0)
    // the contract's course quality, on the row's own signals and relevance, gives the same score
    for (const r of [pass, unknown, fail]) {
      const signals = { a11y: r.accessibility_status, license: r.license, completeness: r.completeness, adaptations: r.adaptation_count, updatedAt: r.updated_at, asOf };
      const rel = Number(fail.score) / (0.75 + 0.5 * courseQualityScore({ ...signals, a11y: "fail" }));
      expect(Number(r.score)).toBeCloseTo(rankScore(rel, courseQualityScore(signals)), 5);
    }
  });

  it("[P5.R.5.e] the a11y facet offers no 'not checked' value; the total still counts every course", async () => {
    const facets = await asRole(db, "anon", () =>
      db.query<{ facet: string; value: string | null; n: string }>(
        `select facet, value, n::text from public.discovery_course_facets(p_q => 'zymurgy fermentation')`,
      ),
    );
    const a11y = facets.rows.filter((f) => f.facet === "a11y").map((f) => f.value).sort();
    expect(a11y).toEqual(["fail", "pass"]);
    expect(facets.rows.find((f) => f.facet === "total")!.n).toBe("3");
  });

  it("[P5.R.5.e] discovery_course_quality = courseQualityScore over every signal combination", async () => {
    let n = 0;
    for (const a11y of ["pass", "warn", "fail", "unknown", "bogus"])
      for (const license of ["CC-BY-4.0", "ALL-RIGHTS-RESERVED"])
        for (const completeness of [0, 0.4, 1])
          for (const adaptations of [0, 7, 500])
            for (const updatedAt of ["2026-10-23T10:00:00.000Z", "1990-01-01T00:00:00.000Z"]) {
              const { rows } = await db.query<{ q: number }>(
                `select public.discovery_course_quality($1, $2, $3::real, $4, $5, $6) as q`,
                [a11y, license, completeness, adaptations, updatedAt, asOf],
              );
              expect(rows[0]!.q).toBeCloseTo(courseQualityScore({ a11y, license, completeness, adaptations, updatedAt, asOf }), 6); // completeness is a real (float4)
              n++;
            }
    expect(n).toBe(180);
  });
});

describe("composition (P5.A.1.r): 0032 keeps every rule of the definitions it replaces", () => {
  const src = async (fn: string) =>
    (await db.query<{ src: string; definer: boolean; config: string[] | null }>(
      `select prosrc src, prosecdef definer, proconfig config from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`,
      [fn],
    )).rows[0]!;

  it("[P5.A.1.r] [P5.R.5.f] discovery_search_courses keeps 0022's filters, keyset paging, clamp and hour rounding, and ranks with the course quality", async () => {
    const f = await src("discovery_search_courses");
    expect(f.definer).toBe(true);
    expect(f.config).toEqual(["search_path=\"\""]);
    for (const rule of [
      "public.discovery_course_matches(p_q)",
      "public.discovery_course_quality(",
      "c.discipline = public.discovery_facet_value(p_discipline)",
      "c.level = public.discovery_facet_value(p_level)",
      "c.license = p_license",
      "c.accessibility_status = p_a11y",
      "date_trunc('hour', now())",
      "(x.s, x.package_id) < (p_after_score, coalesce(p_after_id, ''))",
      "order by x.s desc, x.package_id desc",
      "limit least(greatest(coalesce(p_limit, 20), 1), 51)",
    ]) expect(f.src, rule).toContain(rule);
    expect(f.src).not.toMatch(/public\.discovery_quality\(/);
  });

  it("[P5.A.1.r] [P5.R.5.f] discovery_course_facets keeps 0022's per-facet counting and caps, and drops only 'unknown' from the a11y facet", async () => {
    const f = await src("discovery_course_facets");
    expect(f.definer).toBe(true);
    for (const rule of ["public.discovery_course_matches(p_q)", "ok_d and ok_l and ok_c and ok_a", "f.a11y <> 'unknown' and ok_d and ok_l and ok_c"])
      expect(f.src, rule).toContain(rule);
    expect(f.src.match(/limit 50/g)?.length).toBe(4);
  });

  it("[P5.A.1.r] [P5.R.5.f] the course-quality helper is closed to the API roles; the two RPCs stay open; elements keep discovery_quality", async () => {
    const can = async (role: string, fn: string) =>
      (await db.query<{ ok: boolean }>(
        `select bool_or(has_function_privilege($1, p.oid, 'execute')) ok from pg_proc p where p.proname = $2 and p.pronamespace = 'public'::regnamespace`,
        [role, fn],
      )).rows[0]!.ok;
    for (const role of ["anon", "authenticated"]) {
      expect(await can(role, "discovery_course_quality")).toBe(false);
      expect(await can(role, "discovery_search_courses")).toBe(true);
      expect(await can(role, "discovery_course_facets")).toBe(true);
    }
    expect((await src("discovery_search_elements")).src).toContain("public.discovery_quality(");
    expect((await src("discovery_course_quality")).src).toMatch(/discovery_quality\('unknown'[\s\S]*\/ 0\.70/);
  });
});
