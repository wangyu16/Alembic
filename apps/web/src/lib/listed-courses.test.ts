import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildCourseFeed,
  COURSE_PAGES_LIVE,
  FEED_PAGE_SIZE,
  harvestOrigin,
  listListedCourses,
  sitemapFiles,
  urlset,
  type ListedCourse,
} from "./listed-courses";

const ORIGIN = "https://alembic.example";

function row(i: number) {
  return {
    package_id: `pkg-${String(i).padStart(3, "0")}`,
    title: `Course ${i} <&>`,
    description: i % 2 ? "About things" : null,
    keywords: i % 3 ? ["acids"] : null,
    discipline: "chemistry",
    license: "CC-BY-4.0",
    site_url: `https://u.github.io/c${i}/`,
    public_repo_url: `https://github.com/u/c${i}`,
    accessibility_status: i % 4 ? "unknown" : "pass",
    level: i % 5 ? null : "graduate",
    listed_at: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    updated_at: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T12:00:00Z`,
  };
}

/** PostgREST double for `discovery_courses` with order/range/count. */
function db(rows: ReturnType<typeof row>[], seen: { table?: string; range?: [number, number] } = {}) {
  return {
    from(table: string) {
      seen.table = table;
      const q = {
        select: () => q,
        order: () => q,
        range: async (from: number, to: number) => {
          seen.range = [from, to];
          const sorted = [...rows].sort(
            (a, b) => b.listed_at.localeCompare(a.listed_at) || a.package_id.localeCompare(b.package_id),
          );
          return { data: sorted.slice(from, to + 1), count: rows.length, error: null };
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

describe("listed courses for harvest (Track A.7)", () => {
  it("reads one page from the discovery index (the one data seam, Track A.1)", async () => {
    const seen: { table?: string; range?: [number, number] } = {};
    const rows = Array.from({ length: 250 }, (_, i) => row(i));
    const page = await listListedCourses(db(rows, seen), { offset: 100, limit: 100 });
    expect(seen.table).toBe("discovery_courses");
    expect(seen.range).toEqual([100, 199]);
    expect(page.total).toBe(250);
    expect(page.items).toHaveLength(100);
    expect(page.items[0]).toMatchObject({ discipline: "chemistry", license: "CC-BY-4.0" });
  });

  it("the feed is a schema.org DataFeed of LRMI LearningResources, paged by Link headers", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => row(i));
    const result = await listListedCourses(db(rows), { offset: FEED_PAGE_SIZE, limit: FEED_PAGE_SIZE });
    const { body, links } = buildCourseFeed(2, result, ORIGIN);
    expect(body["@context"]).toBe("https://schema.org");
    expect(body["@type"]).toBe("DataFeed");
    const items = body["dataFeedElement"] as Array<Record<string, unknown>>;
    expect(items).toHaveLength(100);
    for (const it of items) {
      expect(it["@type"]).toBe("LearningResource");
      expect(it["@context"]).toBeUndefined();
      expect(it["license"]).toBe("https://creativecommons.org/licenses/by/4.0/");
      expect(typeof it["identifier"]).toBe("string");
      // Track A.4: each record names its course page and its last update.
      expect(it["@id"]).toBe(`${ORIGIN}/p/${it["identifier"]}`);
      expect(typeof it["dateModified"]).toBe("string");
    }
    expect(links).toContain(`<${ORIGIN}/feed/courses.jsonld>; rel="first"`);
    expect(links).toContain(`<${ORIGIN}/feed/courses.jsonld>; rel="prev"`);
    expect(links).toContain(`<${ORIGIN}/feed/courses.jsonld?page=3>; rel="next"`);
    expect(links).toContain(`<${ORIGIN}/feed/courses.jsonld?page=3>; rel="last"`);
  });

  it("the last page has no next link; an empty index is one empty page", () => {
    const course = { packageId: "p", title: "T", description: "", keywords: [], discipline: "", license: "CC0-1.0", siteUrl: "https://s/", publicRepoUrl: "", accessibilityStatus: "unknown", registeredAt: "2026-10-01T00:00:00Z" } satisfies ListedCourse;
    expect(buildCourseFeed(1, { items: [course], total: 1 }, ORIGIN).links.some((l) => l.includes("next"))).toBe(false);
    const empty = buildCourseFeed(1, { items: [], total: 0 }, ORIGIN);
    expect(empty.body["dataFeedElement"]).toEqual([]);
  });

  it("carries only public listing fields (no owner, no private data)", async () => {
    const result = await listListedCourses(db([{ ...row(1), owner_id: "user-secret" } as ReturnType<typeof row>]), { offset: 0, limit: 10 });
    const json = JSON.stringify(buildCourseFeed(1, result, ORIGIN).body);
    expect(json).not.toContain("user-secret");
  });

  it("sitemaps escape XML and list course pages once they exist (Track A.4)", () => {
    expect(COURSE_PAGES_LIVE).toBe(true);
    expect(urlset([{ loc: "https://x/a?b=1&c=<2>" }])).toContain("<loc>https://x/a?b=1&amp;c=&lt;2&gt;</loc>");
    const files = sitemapFiles(25_000, ORIGIN);
    expect(files[0]).toBe(`${ORIGIN}/sitemaps/static.xml`);
    if (!COURSE_PAGES_LIVE) expect(files).toHaveLength(1);
    else expect(files).toHaveLength(1 + 3);
  });

  it("absolute URLs use the configured app origin", () => {
    expect(harvestOrigin("http://localhost:3000/x", { NEXT_PUBLIC_APP_URL: "https://alembic.orz.how/" })).toBe(
      "https://alembic.orz.how",
    );
    expect(harvestOrigin("http://localhost:3000/x", {})).toBe("http://localhost:3000");
  });
});
