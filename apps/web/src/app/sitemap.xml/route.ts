import { createPublicClient } from "@/lib/supabase/public";
import {
  COURSE_PAGES_LIVE,
  HARVEST_CACHE,
  harvestOrigin,
  listListedCourses,
  sitemapFiles,
  sitemapIndex,
} from "@/lib/listed-courses";

export const dynamic = "force-dynamic";

/**
 * `/sitemap.xml` — a sitemap index (Phase 5 Track A.7): the static public
 * pages, plus one file per 10 000 listed courses once course pages exist
 * (`COURSE_PAGES_LIVE`, Track A.4). Listed in `/robots.txt`.
 */
export async function GET(req: Request) {
  const origin = harvestOrigin(req.url);
  let total = 0;
  if (COURSE_PAGES_LIVE) {
    const db = createPublicClient();
    try {
      if (db) total = (await listListedCourses(db, { offset: 0, limit: 1 })).total;
    } catch {
      /* the static part is still useful */
    }
  }
  return new Response(sitemapIndex(sitemapFiles(total, origin)), {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": HARVEST_CACHE },
  });
}
