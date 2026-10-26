import { createPublicClient } from "@/lib/supabase/public";
import {
  COURSE_PAGES_LIVE,
  coursePagePath,
  elementPagePath,
  HARVEST_CACHE,
  harvestOrigin,
  listListedCourses,
  listSharedElements,
  SITEMAP_PAGE_SIZE,
  STATIC_PAGES,
  urlset,
} from "@/lib/listed-courses";

export const dynamic = "force-dynamic";

const xml = (body: string) =>
  new Response(body, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": HARVEST_CACHE },
  });
const notFound = () => new Response("Not found.", { status: 404, headers: { "cache-control": "no-store" } });

/** `/sitemaps/static.xml`, `/sitemaps/courses-{n}.xml` and `/sitemaps/elements-{n}.xml`
 *  (see `/sitemap.xml`). A page past the last one is a 404. */
export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const origin = harvestOrigin(req.url);
  if (file === "static.xml") return xml(urlset(STATIC_PAGES.map((p) => ({ loc: `${origin}${p}` }))));

  const m = /^(courses|elements)-(\d{1,4})\.xml$/.exec(file);
  if (!m) return notFound();
  const kind = m[1] as "courses" | "elements";
  if (kind === "courses" && !COURSE_PAGES_LIVE) return notFound();
  const n = Number(m[2]);
  if (n < 1) return notFound();
  const db = createPublicClient();
  if (!db) return notFound();
  const range = { offset: (n - 1) * SITEMAP_PAGE_SIZE, limit: SITEMAP_PAGE_SIZE };
  try {
    if (kind === "elements") {
      const { items } = await listSharedElements(db, range);
      // past the last page: not found (P10), never "temporarily unavailable"
      if (items.length === 0) return notFound();
      return xml(
        urlset(items.map((e) => ({ loc: `${origin}${elementPagePath(e.docId)}`, lastmod: e.updatedAt.slice(0, 10) }))),
      );
    }
    const { items } = await listListedCourses(db, range);
    if (items.length === 0) return notFound();
    return xml(
      urlset(items.map((c) => ({ loc: `${origin}${coursePagePath(c.packageId)}`, lastmod: (c.updatedAt ?? c.registeredAt).slice(0, 10) }))),
    );
  } catch {
    return new Response("Temporarily unavailable.", { status: 503, headers: { "cache-control": "no-store" } });
  }
}
