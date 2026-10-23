/**
 * Listed courses for harvest — the sitemap and the LRMI/schema.org feed
 * (Phase 5 Track A.7; goal.md §6: "harvestable by existing OER aggregators
 * without going through the portal").
 *
 * **The one data seam:** `listListedCourses` is the ONLY read behind
 * `/feed/courses.jsonld` and the sitemaps. It reads the discovery index
 * (`discovery_courses`, Track A.1 — its read policy serves listed courses
 * only: published, not archived, openly licensed, Tier-3-consented), so the
 * feed carries the CURRENT listing, not the listing-time snapshot that
 * `portal_registrations` holds.
 *
 * **The course-page seam:** `/p/{packageId}` exists since Track A.4, so
 * `COURSE_PAGES_LIVE` is on: sitemaps list course pages, and each feed record's
 * `@id` is its course page.
 *
 * The record is the SAME `learningResource()` the published pages embed
 * (`@alembic/renderer`), so the portal, the feed and the course sites carry
 * one metadata format.
 *
 * Pure apart from the injected client — unit-tested (`listed-courses.test.ts`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { learningResource } from "@alembic/renderer";
import type { License } from "@alembic/package-contract";

/** On since Track A.4 shipped `/p/{packageId}`. */
export const COURSE_PAGES_LIVE = true;
export const coursePagePath = (packageId: string) => `/p/${encodeURIComponent(packageId)}`;

export const FEED_PAGE_SIZE = 100;
export const SITEMAP_PAGE_SIZE = 10_000;

export interface ListedCourse {
  packageId: string;
  title: string;
  description: string;
  keywords: string[];
  discipline: string;
  license: string;
  siteUrl: string;
  publicRepoUrl: string;
  accessibilityStatus: "pass" | "warn" | "fail" | "unknown";
  /** When it was listed. */
  registeredAt: string;
  /** Last change to the listing or the course's public files (Track A.1). */
  updatedAt?: string;
  level?: string;
}

export interface ListedCoursesPage {
  items: ListedCourse[];
  total: number;
}

interface ListedRow {
  package_id: string;
  title: string;
  description: string | null;
  keywords: string[] | null;
  discipline: string | null;
  level: string | null;
  license: string;
  site_url: string;
  public_repo_url: string;
  accessibility_status: ListedCourse["accessibilityStatus"] | null;
  listed_at: string;
  updated_at: string | null;
}

/** One page of listed courses, newest listing first (stable: ties by id). */
export async function listListedCourses(
  db: SupabaseClient,
  { offset, limit }: { offset: number; limit: number },
): Promise<ListedCoursesPage> {
  const { data, count, error } = await db
    .from("discovery_courses")
    .select(
      "package_id, title, description, keywords, discipline, level, license, site_url, public_repo_url, accessibility_status, listed_at, updated_at",
      { count: "exact" },
    )
    .order("listed_at", { ascending: false })
    .order("package_id", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw new Error("listed courses unavailable");
  const rows = (data as ListedRow[] | null) ?? [];
  return {
    total: count ?? rows.length,
    items: rows.map((r) => ({
      packageId: r.package_id,
      title: r.title,
      description: r.description ?? "",
      keywords: r.keywords ?? [],
      discipline: r.discipline ?? "",
      license: r.license,
      siteUrl: r.site_url,
      publicRepoUrl: r.public_repo_url,
      accessibilityStatus: r.accessibility_status ?? "unknown",
      registeredAt: r.listed_at,
      ...(r.updated_at ? { updatedAt: r.updated_at } : {}),
      ...(r.level ? { level: r.level } : {}),
    })),
  };
}

/** A course as a schema.org LearningResource (no inner @context). */
export function courseLearningResource(c: ListedCourse, origin: string): Record<string, unknown> {
  const { ["@context"]: _ctx, ...ld } = learningResource({
    name: c.title,
    description: c.description || undefined,
    license: c.license as License,
    discipline: c.discipline || undefined,
    educationalLevel: c.level || undefined,
    url: c.siteUrl || undefined,
    datePublished: c.registeredAt ? c.registeredAt.slice(0, 10) : undefined,
    accessibility: c.accessibilityStatus,
    keywords: c.keywords.length ? c.keywords : undefined,
  });
  return {
    ...ld,
    "@id": COURSE_PAGES_LIVE ? `${origin}${coursePagePath(c.packageId)}` : c.siteUrl,
    ...(c.updatedAt ? { dateModified: c.updatedAt } : {}),
    identifier: c.packageId,
    ...(c.publicRepoUrl ? { sameAs: c.publicRepoUrl } : {}),
  };
}

export function feedPageUrl(origin: string, page: number): string {
  return `${origin}/feed/courses.jsonld${page > 1 ? `?page=${page}` : ""}`;
}

/** The JSON-LD feed document for one page, plus its paging links. */
export function buildCourseFeed(
  page: number,
  result: ListedCoursesPage,
  origin: string,
): { body: Record<string, unknown>; links: string[] } {
  const lastPage = Math.max(1, Math.ceil(result.total / FEED_PAGE_SIZE));
  const modified = result.items.map((c) => c.updatedAt ?? c.registeredAt).sort().pop();
  const links = [`<${feedPageUrl(origin, 1)}>; rel="first"`, `<${feedPageUrl(origin, lastPage)}>; rel="last"`];
  if (page > 1) links.push(`<${feedPageUrl(origin, page - 1)}>; rel="prev"`);
  if (page < lastPage) links.push(`<${feedPageUrl(origin, page + 1)}>; rel="next"`);
  return {
    links,
    body: {
      "@context": "https://schema.org",
      "@type": "DataFeed",
      "@id": feedPageUrl(origin, page),
      name: "Alembic — openly licensed courses",
      description:
        "Courses educators listed publicly on Alembic, as schema.org LearningResource records (LRMI). " +
        `Page ${page} of ${lastPage}; ${result.total} courses in all. Follow the HTTP Link rel="next" header for more.`,
      url: `${origin}/portal`,
      ...(modified ? { dateModified: modified } : {}),
      dataFeedElement: result.items.map((c) => courseLearningResource(c, origin)),
    },
  };
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function urlset(entries: Array<{ loc: string; lastmod?: string }>): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    entries
      .map(
        (e) =>
          `  <url><loc>${xmlEscape(e.loc)}</loc>${e.lastmod ? `<lastmod>${xmlEscape(e.lastmod)}</lastmod>` : ""}</url>`,
      )
      .join("\n") +
    `\n</urlset>\n`
  );
}

export function sitemapIndex(locs: string[]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    locs.map((l) => `  <sitemap><loc>${xmlEscape(l)}</loc></sitemap>`).join("\n") +
    `\n</sitemapindex>\n`
  );
}

/** Public pages that exist without a course listing. */
export const STATIC_PAGES = ["/", "/portal", "/guide"];

/** The sitemap files `/sitemap.xml` indexes. */
export function sitemapFiles(totalCourses: number, origin: string): string[] {
  const files = [`${origin}/sitemaps/static.xml`];
  if (COURSE_PAGES_LIVE) {
    const pages = Math.ceil(totalCourses / SITEMAP_PAGE_SIZE);
    for (let n = 1; n <= pages; n++) files.push(`${origin}/sitemaps/courses-${n}.xml`);
  }
  return files;
}

/**
 * Cache policy for harvest documents (feed, sitemaps): a shared cache keeps
 * them at most 300 s in all (240 s fresh + 60 s stale-while-revalidate) — the
 * same takedown bound as `/d` (`TAKEDOWN_BOUND_SECONDS`, security loop r1 M3),
 * so an unlisted or taken-down course leaves the feed within five minutes.
 */
export const HARVEST_CACHE = "public, max-age=300, s-maxage=240, stale-while-revalidate=60";

/** The origin absolute URLs are built on: the configured app URL, else the request's. */
export function harvestOrigin(requestUrl: string, env: Record<string, string | undefined> = process.env): string {
  const configured = env["NEXT_PUBLIC_APP_URL"];
  return (configured || new URL(requestUrl).origin).replace(/\/+$/, "");
}
