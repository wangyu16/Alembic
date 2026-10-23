/**
 * Security loop r1, M3 class: the harvest documents (the course feed and the
 * sitemaps, built from the listing) are served to crawlers through the CDN.
 * A course that is unlisted or taken down must leave them within the same
 * takedown bound as `/d` (`TAKEDOWN_BOUND_SECONDS`). Before: `s-maxage=900,
 * stale-while-revalidate=86400` — a takedown could stay in the feed for a day.
 */
import { describe, expect, it } from "vitest";
import { HARVEST_CACHE } from "./listed-courses";
import { TAKEDOWN_BOUND_SECONDS } from "./permalink-response";
import { sharedLifetimeSeconds } from "./cache-lifetime";

describe("harvest documents respect the takedown bound", () => {
  it("[P5.S.4.b] the feed and sitemaps live in no shared cache longer than the takedown bound", () => {
    const lifetime = sharedLifetimeSeconds(new Headers({ "cache-control": HARVEST_CACHE }));
    expect(lifetime).toBeGreaterThan(0);
    expect(lifetime).toBeLessThanOrEqual(TAKEDOWN_BOUND_SECONDS);
  });
});
