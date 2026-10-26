/**
 * Track A.2 — search, facets and keyset paging in Postgres (PGlite with every
 * migration applied): weighted full text, prefix and typo matching, facet
 * counts in SQL, bounded keyset pages, live re-checks against stale rows, and
 * the SQL shape (no OFFSET, every page clamped).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asRole,
  freshDatabase,
  readMigration,
  seedDoc,
  seedPackage,
  seedUser,
} from "./discovery-pglite";

let db: PGlite;
let owner: string;
const AS_OF = "2026-10-23T10:00:00Z";

interface Hit {
  package_id: string;
  title: string;
  score: string;
}
interface ElHit {
  doc_id: string;
  path: string;
  score: string;
}

async function courses(q: string | null, opts: Record<string, unknown> = {}): Promise<Hit[]> {
  const { rows } = await db.query<Hit>(
    `select package_id, title, score::text as score from public.discovery_search_courses(
       p_q => $1, p_discipline => $2, p_level => $3, p_license => $4, p_a11y => $5,
       p_after_score => $6::numeric, p_after_id => $7, p_as_of => $8, p_limit => $9)`,
    [
      q,
      opts["discipline"] ?? null,
      opts["level"] ?? null,
      opts["license"] ?? null,
      opts["a11y"] ?? null,
      opts["afterScore"] ?? null,
      opts["afterId"] ?? null,
      AS_OF,
      opts["limit"] ?? 20,
    ],
  );
  return rows;
}

async function elements(q: string | null, opts: Record<string, unknown> = {}): Promise<ElHit[]> {
  const { rows } = await db.query<ElHit>(
    `select doc_id, path, score::text as score from public.discovery_search_elements(
       p_q => $1, p_kind => $2, p_type => $3, p_license => $4, p_discipline => $5,
       p_package_id => $6, p_after_score => $7::numeric, p_after_id => $8, p_as_of => $9, p_limit => $10)`,
    [
      q,
      opts["kind"] ?? null,
      opts["type"] ?? null,
      opts["license"] ?? null,
      opts["discipline"] ?? null,
      opts["packageId"] ?? null,
      opts["afterScore"] ?? null,
      opts["afterId"] ?? null,
      AS_OF,
      opts["limit"] ?? 20,
    ],
  );
  return rows;
}

async function facets(fn: string, args: string): Promise<Record<string, Record<string, number>>> {
  const { rows } = await db.query<{ facet: string; value: string | null; n: number }>(
    `select facet, value, n::int as n from public.${fn}(${args})`,
  );
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) (out[r.facet] ??= {})[r.value ?? "*"] = r.n;
  return out;
}

let gen: string, thermo: string, organic: string, physics: string, descOnly: string;

beforeAll(async () => {
  db = await freshDatabase();
  owner = await seedUser(db);
  gen = await seedPackage(db, {
    owner,
    title: "General Chemistry",
    manifest: {
      description: "A first course in chemistry.",
      keywords: ["stoichiometry", "acids", "bases"],
      courseContext: { level: "Introductory undergraduate" },
      chapters: [{ slug: "titration", title: "Titration" }],
    },
    listed: true,
  });
  thermo = await seedPackage(db, {
    owner,
    title: "Thermodynamics",
    manifest: { description: "Heat, work and entropy.", courseContext: { level: "Upper undergraduate" } },
    listed: true,
  });
  organic = await seedPackage(db, {
    owner,
    title: "Organic Chemistry",
    manifest: { description: "Carbon compounds.", license: "CC-BY-SA-4.0", courseContext: { level: "Upper undergraduate" } },
    listed: true,
  });
  physics = await seedPackage(db, {
    owner,
    title: "Mechanics",
    manifest: { discipline: "Physics", description: "Forces and motion." },
    listed: true,
  });
  // "acids" only in the description: must rank below a keyword/title match.
  descOnly = await seedPackage(db, {
    owner,
    title: "Laboratory Safety",
    manifest: { description: "Handling acids safely in the teaching laboratory." },
    listed: true,
  });
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("A.2 matching", () => {
  it("[P5.A.2.a] full words, stemmed: 'acid' finds the keyword 'acids' and the description", async () => {
    const ids = (await courses("acid")).map((h) => h.package_id);
    expect(ids).toEqual(expect.arrayContaining([gen, descOnly]));
    expect(ids).not.toContain(physics);
  });

  it("[P5.A.2.a] weights: a keyword match outranks a description-only match", async () => {
    const ids = (await courses("acids")).map((h) => h.package_id);
    expect(ids.indexOf(gen)).toBeLessThan(ids.indexOf(descOnly));
  });

  it("[P5.A.2.a] weights: a title match outranks a description match", async () => {
    const t = await seedPackage(db, { owner, title: "Entropy Explained", listed: true });
    const ids = (await courses("entropy")).map((h) => h.package_id);
    expect(ids.slice(0, 2)).toEqual([t, thermo]);
  });

  it("[P5.A.2.a] prefixes: 'titr' finds the chapter 'Titration', 'thermo' finds 'Thermodynamics'", async () => {
    expect((await courses("titr")).map((h) => h.package_id)).toContain(gen);
    expect((await courses("thermo")).map((h) => h.package_id)).toContain(thermo);
  });

  it("[P5.A.2.a] typos: 'stoichiometery' and 'chemstry' still match (trigram)", async () => {
    expect((await courses("stoichiometery")).map((h) => h.package_id)).toContain(gen);
    const chem = (await courses("chemstry")).map((h) => h.package_id);
    expect(chem).toEqual(expect.arrayContaining([gen, organic]));
  });

  // Blind critique r2, P1 "Search" (0035_bc_1): tiered matching.
  it("[P5.A.2.a] transposed letters: 'entorpy' finds 'Information Entropy' (last-resort tier)", async () => {
    const info = await seedPackage(db, { owner, title: "Information Entropy", listed: true });
    const ids = (await courses("entorpy")).map((h) => h.package_id);
    expect(ids).toContain(info);
    expect(ids).not.toContain(gen);
    expect(ids).not.toContain(physics);
  });

  it("[P5.A.2.a] a junk word finds nothing: 'xyzzyq'", async () => {
    expect(await courses("xyzzyq")).toEqual([]);
    expect(await elements("xyzzyq")).toEqual([]);
    const f = await facets("discovery_course_facets", `p_q => 'xyzzyq'`);
    expect(f["total"]!["*"]).toBe(0);
  });

  it("[P5.A.2.a] all words: 'organic chemistry' returns Organic Chemistry and NOT General Chemistry", async () => {
    const ids = (await courses("organic chemistry")).map((h) => h.package_id);
    expect(ids).toContain(organic);
    expect(ids).not.toContain(gen);
    // the facet counts follow the same match set
    const f = await facets("discovery_course_facets", `p_q => 'organic chemistry'`);
    expect(f["total"]!["*"]).toBe(ids.length);
  });

  it("[P5.A.2.a] all words, each fuzzily: 'organic chemstry' still finds Organic Chemistry, not General Chemistry", async () => {
    const ids = (await courses("organic chemstry")).map((h) => h.package_id);
    expect(ids).toContain(organic);
    expect(ids).not.toContain(gen);
  });

  it("[P5.A.2.a] any-word fallback: when no course has every word, the courses matching some word are returned", async () => {
    const ids = (await courses("chemistry zyzzogeton")).map((h) => h.package_id);
    expect(ids).toEqual(expect.arrayContaining([gen, organic]));
    expect(ids).not.toContain(physics);
  });

  it("[P5.A.2.l] elements follow the same tiers: all words, any-word fallback, transposition, junk", async () => {
    const pkg = await seedPackage(db, { owner, title: "Tiered Figures" });
    const both = await seedDoc(db, { packageId: pkg, description: "Benzene ring resonance diagram" });
    const one = await seedDoc(db, { packageId: pkg, description: "Benzene vapour pressure plot" });
    const all = (await elements("benzene resonance")).map((e) => e.doc_id);
    expect(all).toContain(both);
    expect(all).not.toContain(one);
    expect((await elements("benzene zyzzogeton")).map((e) => e.doc_id)).toEqual(expect.arrayContaining([both, one]));
    expect((await elements("bnezene")).map((e) => e.doc_id)).toEqual(expect.arrayContaining([both, one]));
  });

  it("[P5.A.2.a] no query lists every listed course", async () => {
    expect((await courses(null)).length).toBeGreaterThanOrEqual(5);
    expect((await courses("   ")).length).toBe((await courses(null)).length);
  });

  it.each([
    "a & b | !c :* (d",
    "'; drop table public.packages; --",
    "\\x00 ::: <-> !!!",
    "the and of", // stop words only
    "é ü 化学",
    "x".repeat(5000),
  ])("hostile or odd input never errors: %j", async (q) => {
    await expect(courses(q)).resolves.toBeDefined();
    await expect(elements(q)).resolves.toBeDefined();
  });
});

describe("A.2 filters and facet counts", () => {
  it("[P5.A.2.b] filters compare normalised values", async () => {
    const ids = (await courses(null, { level: "  UPPER undergraduate " })).map((h) => h.package_id);
    expect(ids.sort()).toEqual([thermo, organic].sort());
    expect((await courses(null, { discipline: "physics" })).map((h) => h.package_id)).toEqual([physics]);
    expect((await courses(null, { license: "CC-BY-SA-4.0" })).map((h) => h.package_id)).toEqual([organic]);
  });

  it("[P5.A.2.b] each facet is counted with the OTHER filters applied; total with all", async () => {
    const f = await facets("discovery_course_facets", `p_level => 'upper undergraduate'`);
    expect(f["total"]!["*"]).toBe(2);
    // the level facet ignores its own filter …
    expect(f["level"]!["upper undergraduate"]).toBe(2);
    expect(f["level"]!["introductory undergraduate"]).toBe(1);
    // … the others apply it.
    expect(f["discipline"]).toEqual({ chemistry: 2 });
    expect(f["license"]).toEqual({ "CC-BY-4.0": 1, "CC-BY-SA-4.0": 1 });
    // no current accessibility check is not a facet value (owner decision 2,
    // 0032): neither course has one, so the a11y facet has no values
    expect(f["a11y"]).toBeUndefined();
  });

  it("[P5.A.2.b] facets follow the text query", async () => {
    const f = await facets("discovery_course_facets", `p_q => 'mechanics'`);
    expect(f["total"]!["*"]).toBe(1);
    expect(f["discipline"]).toEqual({ physics: 1 });
  });
});

describe("A.2 keyset paging", () => {
  it("[P5.A.2.c] pages of 2 walk the whole result exactly once, in order", async () => {
    const all = await courses(null, { limit: 50 });
    const seen: Hit[] = [];
    let after: Hit | undefined;
    for (let i = 0; i < 20; i++) {
      const page = await courses(null, { limit: 2, afterScore: after?.score, afterId: after?.package_id });
      if (page.length === 0) break;
      seen.push(...page);
      after = page[page.length - 1];
    }
    expect(seen.map((h) => h.package_id)).toEqual(all.map((h) => h.package_id));
    expect(new Set(seen.map((h) => h.package_id)).size).toBe(seen.length);
  });

  it("[P5.A.2.c] ties on score are broken by id (deterministic)", async () => {
    const all = await courses(null, { limit: 50 });
    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1]!, b = all[i]!;
      const sa = Number(a.score), sb = Number(b.score);
      expect(sa > sb || (sa === sb && a.package_id > b.package_id)).toBe(true);
    }
  });

  it("[P5.A.2.d] a page is never larger than 51 rows, whatever is asked", async () => {
    const pkg = await seedPackage(db, { owner });
    await db.query(
      `insert into public.documents (doc_id, package_id, repo, path, space, kind, origin,
         description, discoverable, permalink_class)
       select 'doc-bulk' || g, $1, 'public', 'assets/f' || g || '.svg', 'assets', 'svg', 'created',
              'Bulk figure number ' || g, true, 'object'
       from generate_series(1, 300) g`,
      [pkg],
    );
    expect((await elements(null, { limit: 100000 })).length).toBe(51);
    expect((await elements(null, { limit: -5 })).length).toBe(1);
    expect((await courses(null, { limit: 100000 })).length).toBeLessThanOrEqual(51);
  });
});

describe("A.2 elements", () => {
  let pkg: string, svg: string, md: string;
  beforeAll(async () => {
    pkg = await seedPackage(db, { owner, title: "Spectroscopy", manifest: { discipline: "chemistry" } });
    svg = await seedDoc(db, { packageId: pkg, description: "Infrared spectrum of ethanol", tags: ["IR"] });
    md = await seedDoc(db, {
      packageId: pkg,
      kind: "md",
      space: "practice",
      path: "practice/nmr.md",
      permalinkClass: "document",
      description: "NMR practice questions",
    });
  });

  it("[P5.A.2.l] matches description, tags and the course title; filters by kind, type and course", async () => {
    expect((await elements("ethanol")).map((e) => e.doc_id)).toEqual([svg]);
    expect((await elements("ir")).map((e) => e.doc_id)).toContain(svg);
    expect((await elements("spectroscopy")).map((e) => e.doc_id).sort()).toEqual([svg, md].sort());
    expect((await elements(null, { kind: "md", packageId: pkg })).map((e) => e.doc_id)).toEqual([md]);
    expect((await elements(null, { type: "practice", packageId: pkg })).map((e) => e.doc_id)).toEqual([md]);
  });

  it("[P5.A.2.b] element facets: kind, type, licence, discipline", async () => {
    const f = await facets("discovery_element_facets", `p_package_id => '${pkg}'`);
    expect(f["total"]!["*"]).toBe(2);
    expect(f["kind"]).toEqual({ svg: 1, md: 1 });
    expect(f["type"]).toEqual({ assets: 1, practice: 1 });
    expect(f["license"]).toEqual({ "CC-BY-4.0": 2 });
    expect(f["discipline"]).toEqual({ chemistry: 2 });
  });

  it("[P5.A.2.l] returns the live path after a rename", async () => {
    await db.query(`update public.documents set path = 'assets/renamed.svg' where doc_id = $1`, [svg]);
    expect((await elements("ethanol"))[0]!.path).toBe("assets/renamed.svg");
  });
});

describe("A.2 adversarial: a stale projection row is never served", () => {
  async function withoutTriggers(sql: string, args: unknown[]) {
    await db.exec(`
      alter table public.packages disable trigger discovery_packages;
      alter table public.portal_registrations disable trigger discovery_registrations;
      alter table public.documents disable trigger discovery_documents_update;`);
    try {
      await db.query(sql, args);
    } finally {
      await db.exec(`
        alter table public.packages enable trigger discovery_packages;
        alter table public.portal_registrations enable trigger discovery_registrations;
        alter table public.documents enable trigger discovery_documents_update;`);
    }
  }

  it.each([
    ["archived", `update public.packages set archived_at = now() where id = $1`],
    ["unpublished (back to trial)", `update public.packages set storage = 'sandbox' where id = $1`],
    ["unlisted", `delete from public.portal_registrations where package_id = $1`],
    ["re-licensed all-rights-reserved", `update public.packages set manifest = manifest || '{"license":"ALL-RIGHTS-RESERVED"}' where id = $1`],
  ])("[P5.A.2.f] course %s behind the projector's back", async (_l, sql) => {
    const id = await seedPackage(db, { owner, title: "Zymurgy Stale", listed: true });
    expect((await courses("zymurgy")).map((h) => h.package_id)).toContain(id);
    await withoutTriggers(sql, [id]);
    const { rows } = await db.query(`select 1 from public.discovery_courses where package_id = $1`, [id]);
    expect(rows).toHaveLength(1); // the stale row is there …
    expect((await courses("zymurgy")).map((h) => h.package_id)).not.toContain(id); // … and never served
    const f = await facets("discovery_course_facets", `p_q => 'zymurgy'`);
    expect(f["total"]!["*"]).toBe(0);
    await db.query(`delete from public.portal_registrations where package_id = $1`, [id]);
  });

  it.each([
    ["unshared", `update public.documents set discoverable = false where doc_id = $1`],
    ["tombstoned", `update public.documents set tombstoned = true where doc_id = $1`],
    ["moved to the current space", `update public.documents set space = 'current' where doc_id = $1`],
    ["moved to the private repo", `update public.documents set repo = 'private' where doc_id = $1`],
  ])("[P5.0.3.a] [P5.A.2.f] element %s behind the projector's back", async (_l, sql) => {
    const pkg = await seedPackage(db, { owner });
    const doc = await seedDoc(db, { packageId: pkg, description: "Quokka stale figure" });
    expect((await elements("quokka")).map((e) => e.doc_id)).toContain(doc);
    await withoutTriggers(sql, [doc]);
    expect((await elements("quokka")).map((e) => e.doc_id)).not.toContain(doc);
    await db.query(`update public.documents set discoverable = false where doc_id = $1`, [doc]);
  });
});

describe("A.2 access", () => {
  it("[P5.A.2.g] anon may search and count; the helpers stay internal", async () => {
    await asRole(db, "anon", async () => {
      expect((await courses("chemistry")).length).toBeGreaterThan(0);
      await expect(
        db.query(`select * from public.discovery_course_facets(p_q => 'chemistry')`),
      ).resolves.toBeDefined();
      for (const sql of [
        `select * from public.discovery_course_matches('x')`,
        `select * from public.discovery_element_matches('x')`,
        `select public.discovery_prefix_query('x')`,
        `select public.discovery_score(1, 1)`,
      ]) {
        await expect(db.query(sql)).rejects.toThrow(/permission denied/i);
      }
    });
  });
});

describe("A.2 SQL shape (scale): keyset only, every page bounded", () => {
  // Code only: comments may mention what the code avoids.
  const sql = readMigration("0022_trackA_discovery.sql").replace(/--[^\n]*/g, "").toLowerCase();
  const body = (name: string) => {
    const start = sql.indexOf(`function public.${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    return sql.slice(start, sql.indexOf("$$;", sql.indexOf("as $$", start)));
  };

  it("[P5.A.2.e] no OFFSET anywhere in the migration", () => {
    expect(sql).not.toMatch(/\boffset\b/);
  });

  it.each(["discovery_search_courses", "discovery_search_elements"])(
    "[P5.A.2.d] %s: keyset predicate, deterministic order, clamped limit",
    (fn) => {
      const b = body(fn);
      expect(b).toMatch(/where p_after_score is null\s+or \(x\.s, x\.(package_id|doc_id)\) < \(p_after_score, coalesce\(p_after_id, ''\)\)/);
      expect(b).toMatch(/order by x\.s desc, x\.(package_id|doc_id) desc/);
      expect(b).toContain("limit least(greatest(coalesce(p_limit, 20), 1), 51)");
    },
  );

  it.each(["discovery_course_facets", "discovery_element_facets"])(
    "[P5.A.2.d] %s: every facet list is capped",
    (fn) => {
      const b = body(fn);
      const groups = b.match(/group by/g)?.length ?? 0;
      expect(groups).toBe(4);
      expect(b.match(/limit 50/g)?.length).toBe(groups);
    },
  );

  it("[P5.A.2.h] text search is index-backed (GIN on the tsvector and the trigram text)", () => {
    for (const t of ["discovery_courses", "discovery_elements"]) {
      expect(sql).toContain(`on public.${t} using gin (search_vector)`);
      expect(sql).toContain(`on public.${t} using gin (search_text extensions.gin_trgm_ops)`);
    }
  });
});
