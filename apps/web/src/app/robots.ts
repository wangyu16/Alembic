import type { MetadataRoute } from "next";

/**
 * `/robots.txt` (Phase 5 Track A.7): public pages, permalinks and the harvest
 * feed may be crawled; the signed-in surfaces may not. Points crawlers at the
 * sitemap index.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = (process.env["NEXT_PUBLIC_APP_URL"] ?? "https://alembic.orz.how").replace(/\/+$/, "");
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/workspace", "/admin", "/api/", "/auth/", "/signin", "/suspended"] }],
    sitemap: `${origin}/sitemap.xml`,
  };
}
