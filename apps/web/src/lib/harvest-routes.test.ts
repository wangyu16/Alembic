import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isRangePastEnd, listListedCourses, listSharedElements, sitemapFiles } from "./listed-courses";

/**
 * Blind-critique 2026-10-26: P10 (a page past the end of the feed or a
 * sitemap is a 404, not 503 "Temporarily unavailable") and P9 (shared
 * elements are in the sitemap, so machine lists agree with the listing).
 */

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};

/** PostgREST double: a range past the rows answers 416 / PGRST103, like PostgREST. */
function fakeDb(): SupabaseClient {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const q = {
        select: () => q,
        order: () => q,
        range: async (from: number, to: number) => {
          if (from > 0 && from >= rows.length) {
            return { data: null, count: null, error: { code: "PGRST103", message: "Requested range not satisfiable" } };
          }
          return { data: rows.slice(from, to + 1), count: rows.length, error: null };
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

vi.mock("@/lib/supabase/public", () => ({ createPublicClient: () => fakeDb() }));

const course = (i: number): Row => ({
  package_id: `pkg-c${i}`,
  title: `Course ${i}`,
  description: "",
  keywords: [],
  discipline: "chemistry",
  level: null,
  license: "CC-BY-4.0",
  site_url: `https://u.github.io/c${i}/`,
  public_repo_url: `https://github.com/u/c${i}`,
  accessibility_status: "pass",
  listed_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-02T00:00:00Z",
});
const element = (i: number, over: Row = {}): Row => ({
  doc_id: `doc-e${i}`,
  repo: "public",
  space: "assets",
  updated_at: "2026-10-03T00:00:00Z",
  ...over,
});

beforeEach(() => {
  tables = {
    discovery_courses: [course(1), course(2)],
    discovery_elements: [element(1), element(2), element(3, { repo: "private" }), element(4, { space: "current" })],
  };
});

describe("harvest paging past the end (P10)", () => {
  it("a range past the rows is an empty page, not an error", async () => {
    expect(isRangePastEnd({ code: "PGRST103" })).toBe(true);
    expect(isRangePastEnd({ code: "42501" })).toBe(false);
    await expect(listListedCourses(fakeDb(), { offset: 100, limit: 100 })).resolves.toMatchObject({ items: [] });
  });

  it("feed page past the last answers 404; page 1 is the feed", async () => {
    const { GET } = await import("@/app/feed/courses.jsonld/route");
    const past = await GET(new Request("https://a.example/feed/courses.jsonld?page=7"));
    expect(past.status).toBe(404);
    const first = await GET(new Request("https://a.example/feed/courses.jsonld"));
    expect(first.status).toBe(200);
    expect(JSON.parse(await first.text())["dataFeedElement"]).toHaveLength(2);
  });

  it("an empty index still answers page 1 with an empty feed", async () => {
    tables = {};
    const { GET } = await import("@/app/feed/courses.jsonld/route");
    expect((await GET(new Request("https://a.example/feed/courses.jsonld?page=1"))).status).toBe(200);
  });

  it("sitemap pages past the last answer 404", async () => {
    const { GET } = await import("@/app/sitemaps/[file]/route");
    const call = (file: string) =>
      GET(new Request(`https://a.example/sitemaps/${file}`), { params: Promise.resolve({ file }) });
    expect((await call("courses-9.xml")).status).toBe(404);
    expect((await call("elements-9.xml")).status).toBe(404);
    expect((await call("courses-1.xml")).status).toBe(200);
  });
});

describe("shared elements in the sitemap (P9)", () => {
  it("lists only listable element pages", async () => {
    const { items, total } = await listSharedElements(fakeDb(), { offset: 0, limit: 10 });
    expect(total).toBe(4);
    expect(items.map((e) => e.docId)).toEqual(["doc-e1", "doc-e2"]);
  });

  it("elements-1.xml carries each shared element's own page", async () => {
    const { GET } = await import("@/app/sitemaps/[file]/route");
    const res = await GET(new Request("https://a.example/sitemaps/elements-1.xml"), {
      params: Promise.resolve({ file: "elements-1.xml" }),
    });
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain("/portal/element/doc-e1</loc>");
    expect(body).not.toContain("doc-e3");
    expect(body).not.toContain("doc-e4");
  });

  it("the sitemap index names the elements file", async () => {
    expect(sitemapFiles(1, "https://o", 1)).toContain("https://o/sitemaps/elements-1.xml");
    expect(sitemapFiles(1, "https://o", 0).some((f) => f.includes("elements"))).toBe(false);
    const { GET } = await import("@/app/sitemap.xml/route");
    const body = await (await GET(new Request("https://a.example/sitemap.xml"))).text();
    expect(body).toContain("/sitemaps/elements-1.xml");
  });
});
