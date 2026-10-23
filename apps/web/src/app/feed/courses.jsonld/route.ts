import { createPublicClient } from "@/lib/supabase/public";
import {
  buildCourseFeed,
  FEED_PAGE_SIZE,
  HARVEST_CACHE,
  harvestOrigin,
  listListedCourses,
} from "@/lib/listed-courses";

export const dynamic = "force-dynamic";

/**
 * `/feed/courses.jsonld[?page=N]` — every publicly listed course as a
 * schema.org `DataFeed` of LRMI `LearningResource` records, 100 per page,
 * paged by HTTP `Link` headers (rel first/prev/next/last). For OER
 * aggregators and search engines: discovery without the portal (goal.md §6,
 * Phase 5 Track A.7). Public data only (the listing index); CDN-cached.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("page");
  const page = raw === null ? 1 : Number(raw);
  if (!Number.isInteger(page) || page < 1 || page > 100_000) {
    return new Response("Bad page number.", { status: 400, headers: { "cache-control": "no-store" } });
  }
  const db = createPublicClient();
  if (!db) return new Response("Not configured.", { status: 503, headers: { "cache-control": "no-store" } });

  let result;
  try {
    result = await listListedCourses(db, { offset: (page - 1) * FEED_PAGE_SIZE, limit: FEED_PAGE_SIZE });
  } catch {
    return new Response("Temporarily unavailable.", { status: 503, headers: { "cache-control": "no-store", "retry-after": "60" } });
  }
  const { body, links } = buildCourseFeed(page, result, harvestOrigin(req.url));
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/ld+json; charset=utf-8",
      "cache-control": HARVEST_CACHE,
      "access-control-allow-origin": "*",
      link: links.join(", "),
    },
  });
}
