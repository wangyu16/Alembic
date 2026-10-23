/**
 * A.2 — pure query building for Discover's server-side search: URL parsing and
 * clamping, the keyset cursor, the RPC arguments (no offset, bounded pages),
 * and fail-closed parsing of what comes back.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_PAGE_SIZE,
  PAGE_SIZE,
  courseSearchArgs,
  decodeCursor,
  discoveryHref,
  elementSearchArgs,
  encodeCursor,
  pageAsOf,
  parseDiscoveryQuery,
  parseFacetRows,
  searchCourses,
  searchElements,
  type DiscoveryQuery,
} from "./discovery-search";

type Courses = Extract<DiscoveryQuery, { scope: "courses" }>;
type Elements = Extract<DiscoveryQuery, { scope: "elements" }>;

describe("parseDiscoveryQuery", () => {
  it("defaults to the courses scope, first page, no filters", () => {
    expect(parseDiscoveryQuery({})).toEqual({ scope: "courses", q: "", filters: {}, cursor: null });
  });

  it("[P5.A.2.j] cleans and caps the text query", () => {
    const q = parseDiscoveryQuery({ q: `  acid\n\tbase\u0000 ${"x".repeat(500)}` });
    expect(q.q.startsWith("acid base ")).toBe(true);
    expect(q.q.length).toBe(200);
  });

  it("takes the first value of a repeated parameter", () => {
    expect(parseDiscoveryQuery({ q: ["one", "two"] }).q).toBe("one");
  });

  it("[P5.A.2.j] keeps only the scope's own filters, capped", () => {
    const c = parseDiscoveryQuery({ discipline: "Chemistry", kind: "svg", level: "y".repeat(300) });
    expect(c.filters).toEqual({ discipline: "Chemistry", level: "y".repeat(80) });
    const e = parseDiscoveryQuery({ scope: "elements", kind: "svg", type: "assets", level: "x" });
    expect(e.filters).toEqual({ kind: "svg", type: "assets" });
  });

  it("[P5.A.2.j] drops an a11y value outside the closed set", () => {
    expect(parseDiscoveryQuery({ a11y: "pass" }).filters).toEqual({ a11y: "pass" });
    expect(parseDiscoveryQuery({ a11y: "great" }).filters).toEqual({});
  });
});

describe("keyset cursor", () => {
  const c = { score: "1.234567", id: "pkg-gen-chem-abc12345", asOf: "2026-10-23T10:00:00.000Z", page: 3 };

  it("[P5.A.2.i] round-trips", () => {
    expect(decodeCursor(encodeCursor(c), "courses")).toEqual(c);
  });

  it.each([
    ["garbage", "%%%"],
    ["not JSON", Buffer.from("nope").toString("base64url")],
    ["a score with SQL in it", encodeCursor({ ...c, score: "1; drop table x" })],
    ["a score with too many decimals", encodeCursor({ ...c, score: "1.1234567" })],
    ["an id of the wrong scope", encodeCursor({ ...c, id: "doc-abc" })],
    ["an id with odd characters", encodeCursor({ ...c, id: "pkg-a'b" })],
    ["a bad date", encodeCursor({ ...c, asOf: "yesterday" })],
    ["an oversized cursor", "a".repeat(601)],
  ])("[P5.A.2.i] ignores %s (first page, not an error)", (_l, raw) => {
    expect(decodeCursor(raw, "courses")).toBeNull();
  });

  it("a missing or silly page number falls back to 2 (labels only)", () => {
    const raw = (n: unknown) =>
      Buffer.from(JSON.stringify({ s: c.score, i: c.id, t: c.asOf, n }), "utf8").toString("base64url");
    expect(decodeCursor(raw(undefined), "courses")?.page).toBe(2);
    expect(decodeCursor(raw(-4), "courses")?.page).toBe(2);
    expect(decodeCursor(raw(2.5), "courses")?.page).toBe(2);
    expect(decodeCursor(raw(7), "courses")?.page).toBe(7);
  });

  it("[P5.A.2.i] is scope-bound", () => {
    expect(decodeCursor(encodeCursor({ ...c, id: "doc-xyz" }), "elements")?.id).toBe("doc-xyz");
  });

  it("[P5.A.2.i] pins the first page's hour", () => {
    expect(pageAsOf(new Date("2026-10-23T10:42:17.123Z"))).toBe("2026-10-23T10:00:00.000Z");
  });
});

describe("RPC arguments", () => {
  const asOf = "2026-10-23T10:00:00.000Z";

  it("[P5.A.2.d] first page: no keyset, one extra row to detect a next page", () => {
    const q = parseDiscoveryQuery({ q: "acids", discipline: "chemistry" }) as Courses;
    const args = courseSearchArgs(q, asOf);
    expect(args).toEqual({
      p_q: "acids",
      p_discipline: "chemistry",
      p_level: null,
      p_license: null,
      p_a11y: null,
      p_after_score: null,
      p_after_id: null,
      p_as_of: asOf,
      p_limit: PAGE_SIZE + 1,
    });
  });

  it("[P5.A.2.e] later pages pass the keyset, never an offset", () => {
    const cursor = encodeCursor({ score: "0.5", id: "pkg-b", asOf, page: 2 });
    const q = parseDiscoveryQuery({ after: cursor }) as Courses;
    const args = courseSearchArgs(q, asOf);
    expect(args.p_after_score).toBe("0.5");
    expect(args.p_after_id).toBe("pkg-b");
    expect(Object.keys(args).some((k) => /offset|page/i.test(k))).toBe(false);
  });

  it("[P5.A.2.d] page size is clamped to 1…50", () => {
    const q = parseDiscoveryQuery({}) as Courses;
    expect(courseSearchArgs(q, asOf, 10_000).p_limit).toBe(MAX_PAGE_SIZE + 1);
    expect(courseSearchArgs(q, asOf, -3).p_limit).toBe(2);
    const e = parseDiscoveryQuery({ scope: "elements" }) as Elements;
    expect(elementSearchArgs(e, asOf, 10_000, "pkg-x").p_limit).toBe(MAX_PAGE_SIZE + 1);
    expect(elementSearchArgs(e, asOf, 10, "pkg-x").p_package_id).toBe("pkg-x");
  });
});

describe("discoveryHref", () => {
  it("[P5.A.4.e] keeps scope, text and filters; a change starts at page one", () => {
    const after = encodeCursor({ score: "1", id: "doc-a", asOf: "2026-10-23T10:00:00.000Z", page: 2 });
    const q = parseDiscoveryQuery({ scope: "elements", q: "curve", kind: "svg", after });
    expect(discoveryHref(q)).toBe("/portal?scope=elements&q=curve&kind=svg");
    expect(discoveryHref(q, { kind: "" })).toBe("/portal?scope=elements&q=curve");
    expect(discoveryHref(q, { type: "assets" })).toBe("/portal?scope=elements&q=curve&kind=svg&type=assets");
    expect(discoveryHref(q, { after: "abc" })).toBe("/portal?scope=elements&q=curve&kind=svg&after=abc");
  });

  it("[P5.A.4.e] encodes user text safely", () => {
    const q = parseDiscoveryQuery({ q: "a&b=c <x>" });
    expect(discoveryHref(q)).toBe("/portal?q=a%26b%3Dc+%3Cx%3E");
  });
});

describe("parseFacetRows", () => {
  it("[P5.A.2.b] collects counts per facet and the total; ignores junk", () => {
    const f = parseFacetRows(
      [
        { facet: "total", value: null, n: "12" },
        { facet: "discipline", value: "chemistry", n: 10 },
        { facet: "discipline", value: "physics", n: "2" },
        { facet: "nope", value: "x", n: 1 },
        { facet: "level", value: null, n: 3 },
        { facet: "license", value: "CC-BY-4.0", n: "NaN" },
      ],
      ["discipline", "level", "license", "a11y"],
    );
    expect(f.total).toBe(12);
    expect(f.values["discipline"]).toEqual([
      { value: "chemistry", count: 10 },
      { value: "physics", count: 2 },
    ]);
    expect(f.values["level"]).toEqual([]);
    expect(f.values["license"]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The search wrappers over an injected client.
// ---------------------------------------------------------------------------

function course(id: string, over: Record<string, unknown> = {}) {
  return {
    package_id: id,
    title: id,
    description: "",
    keywords: [],
    chapter_titles: [],
    topics: [],
    discipline: null,
    level: null,
    course_context: {},
    license: "CC-BY-4.0",
    accessibility_status: "unknown",
    chapter_count: 1,
    element_count: 0,
    adapted_from_package_id: null,
    adapted_from_title: null,
    adapted_from_url: null,
    adapted_from_attribution: null,
    adaptation_count: 0,
    public_repo_url: "https://github.com/a/b",
    site_url: "https://a.github.io/b/",
    listed_at: "2026-10-01T00:00:00+00:00",
    updated_at: "2026-10-01T00:00:00+00:00",
    completeness: 0,
    score: "1.000000",
    ...over,
  };
}

function element(id: string, over: Record<string, unknown> = {}) {
  return {
    doc_id: id,
    package_id: "pkg-a",
    repo: "public",
    space: "assets",
    kind: "svg",
    permalink_class: "object",
    path: "assets/x.svg",
    title: "x",
    description: null,
    alt_text: null,
    tags: [],
    license: "CC-BY-4.0",
    package_title: "A",
    discipline: null,
    level: null,
    course_listed: false,
    adapted_from_doc_id: null,
    adaptation_count: 0,
    described: false,
    listed_at: "2026-10-01T00:00:00+00:00",
    updated_at: "2026-10-01T00:00:00+00:00",
    completeness: 0,
    score: "0.900000",
    ...over,
  };
}

function fakeClient(results: Record<string, { data: unknown; error: unknown }>) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      return results[fn] ?? { data: [], error: null };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("searchCourses / searchElements", () => {
  const now = new Date("2026-10-23T10:42:00Z");

  it("returns one page and a cursor at the last shown row", async () => {
    const rows = Array.from({ length: 4 }, (_, i) => course(`pkg-${i}`, { score: `${4 - i}.000000` }));
    const { client, calls } = fakeClient({ discovery_search_courses: { data: rows, error: null } });
    const page = await searchCourses(client, parseDiscoveryQuery({}) as Courses, { now, pageSize: 3 });
    expect(page.hits.map((h) => h.package_id)).toEqual(["pkg-0", "pkg-1", "pkg-2"]);
    expect(decodeCursor(page.next!, "courses")).toEqual({
      score: "2.000000",
      id: "pkg-2",
      asOf: "2026-10-23T10:00:00.000Z",
      page: 2,
    });
    expect(calls.map(([fn]) => fn).sort()).toEqual(["discovery_course_facets", "discovery_search_courses"]);
  });

  it("no next page when the database returns no extra row", async () => {
    const { client } = fakeClient({ discovery_search_courses: { data: [course("pkg-0")], error: null } });
    const page = await searchCourses(client, parseDiscoveryQuery({}) as Courses, { now, pageSize: 3 });
    expect(page.next).toBeNull();
  });

  it("[P5.A.2.i] a later page keeps the cursor's hour, not the clock's", async () => {
    const asOf = "2026-10-20T08:00:00.000Z";
    const { client, calls } = fakeClient({});
    const q = parseDiscoveryQuery({ after: encodeCursor({ score: "1", id: "pkg-z", asOf, page: 4 }) }) as Courses;
    const page = await searchCourses(client, q, { now });
    expect(page.next).toBeNull();
    expect(calls.find(([fn]) => fn === "discovery_search_courses")![1]["p_as_of"]).toBe(asOf);
  });

  it("[P5.A.1.k] adversarial: drops rows a regressed query might return (ARR licence, private, current)", async () => {
    const { client } = fakeClient({
      discovery_search_courses: {
        data: [course("pkg-ok"), course("pkg-arr", { license: "ALL-RIGHTS-RESERVED" }), { junk: true }],
        error: null,
      },
      discovery_search_elements: {
        data: [
          element("doc-ok"),
          element("doc-priv", { repo: "private" }),
          element("doc-privspace", { space: "private" }),
          element("doc-cur", { space: "current" }),
        ],
        error: null,
      },
    });
    const c = await searchCourses(client, parseDiscoveryQuery({}) as Courses, { now });
    expect(c.hits.map((h) => h.package_id)).toEqual(["pkg-ok"]);
    const e = await searchElements(client, parseDiscoveryQuery({ scope: "elements" }) as Elements, { now });
    expect(e.hits.map((h) => h.doc_id)).toEqual(["doc-ok"]);
  });

  it("[P5.A.2.k] a database error is reported as unavailable, with nothing listed", async () => {
    const { client } = fakeClient({
      discovery_search_courses: { data: [course("pkg-ok")], error: { message: "function does not exist" } },
    });
    const page = await searchCourses(client, parseDiscoveryQuery({}) as Courses, { now });
    expect(page).toMatchObject({ hits: [], next: null, unavailable: true });
  });

  it("the course page's element list can skip facets", async () => {
    const { client, calls } = fakeClient({});
    await searchElements(client, parseDiscoveryQuery({ scope: "elements" }) as Elements, {
      now,
      packageId: "pkg-a",
      withFacets: false,
    });
    expect(calls.map(([fn]) => fn)).toEqual(["discovery_search_elements"]);
  });
});
