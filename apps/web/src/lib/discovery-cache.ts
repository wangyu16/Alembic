import "server-only";
import { unstable_cache, updateTag } from "next/cache";
import {
  DiscoveryCourseSchema,
  DiscoveryElementSchema,
  parseCourseRows,
  parseElementRows,
  type DiscoveryCourse,
  type DiscoveryElement,
} from "@alembic/package-contract";
import { createPublicClient } from "@/lib/supabase/public";
import { createServiceClient } from "@/lib/supabase/service";
import {
  searchCourses,
  searchElements,
  type CourseHit,
  type DiscoveryQuery,
  type ElementHit,
  type SearchPage,
} from "@/lib/discovery-search";

/**
 * Cached reads behind Discover (`/portal`), the course pages (`/p/{id}`) and
 * the element pages (Phase 5 Track A.4 + the A.6 "cached discover pages"
 * item). Every read goes through the cookie-less ANON client
 * (`createPublicClient`), so an answer is the same for every visitor and can
 * be shared in Next's data cache; the visitor's own session is used only for
 * the parts of a page that are about them (the adapt pickers).
 *
 * Freshness — the bound is 120 s, not zero: entries carry the `discovery`
 * tag and live at most `DISCOVERY_REVALIDATE_SECONDS` (120 s). The reads
 * re-check listability against the live tables (the index's read policy,
 * spec §1.1) only when they run, i.e. on a cache miss; a cached answer is
 * served as-is until it expires, so it can be up to 120 s stale — including
 * for content that has since been unlisted, archived, unshared or taken down.
 * Owner actions that change what Discover may show (list/unlist,
 * archive/restore, share/unshare, a shared file leaving the registry, course
 * details, rename, accessibility check) call `discoveryChanged()`, which
 * drops every entry at once (P5.S.8, `discovery-invalidation.test.ts`);
 * changes made outside the app — an operator delete in the database
 * dashboard, a direct GitHub change absorbed by reconcile — are bounded by
 * the 120 s window.
 *
 * A search that could not run (unavailable) is not cached.
 */

export const DISCOVERY_TAG = "discovery";
export const DISCOVERY_REVALIDATE_SECONDS = 120;

class Unavailable extends Error {}

function cached<T>(key: string[], load: () => Promise<T>): Promise<T> {
  return unstable_cache(load, ["alembic-discovery", ...key], {
    revalidate: DISCOVERY_REVALIDATE_SECONDS,
    tags: [DISCOVERY_TAG],
  })();
}

/** Call from a Server Action after a change Discover shows. Never throws. */
export function discoveryChanged(): void {
  try {
    updateTag(DISCOVERY_TAG);
  } catch {
    /* outside a Server Action (or no cache): the revalidate window applies */
  }
}

const unavailablePage = <T,>(): SearchPage<T> => ({
  hits: [],
  next: null,
  facets: { total: 0, values: {} },
  unavailable: true,
});

export async function cachedSearch(
  query: DiscoveryQuery,
  opts: { now?: Date; pageSize?: number } = {},
): Promise<SearchPage<CourseHit | ElementHit>> {
  const client = createPublicClient();
  if (!client) return unavailablePage();
  const now = opts.now ?? new Date();
  const hour = new Date(now);
  hour.setUTCMinutes(0, 0, 0);
  // The cursor (or the current hour) is part of the key: ranking is computed
  // for that hour, so the entry is exact for it.
  const key = ["search", JSON.stringify(query), hour.toISOString(), String(opts.pageSize ?? "")];
  try {
    return await cached(key, async () => {
      const page: SearchPage<CourseHit | ElementHit> =
        query.scope === "courses"
          ? await searchCourses(client, query, { now, pageSize: opts.pageSize })
          : await searchElements(client, query, { now, pageSize: opts.pageSize });
      if (page.unavailable) throw new Unavailable();
      return page;
    });
  } catch {
    return unavailablePage();
  }
}

/** A listed course (RLS: listed rows only), or null. */
export async function cachedCourse(packageId: string): Promise<DiscoveryCourse | null> {
  const client = createPublicClient();
  if (!client) return null;
  try {
    return await cached(["course", packageId], async () => {
      const { data, error } = await client
        .from("discovery_courses")
        .select(Object.keys(DiscoveryCourseSchema.shape).join(", "))
        .eq("package_id", packageId)
        .limit(1);
      if (error) throw new Unavailable();
      return parseCourseRows(data)[0] ?? null;
    });
  } catch {
    return null;
  }
}

/** Listed courses that name `packageId` as their source (lineage), newest first. */
export async function cachedAdaptations(
  packageId: string,
  limit = 12,
): Promise<Array<Pick<DiscoveryCourse, "package_id" | "title">>> {
  const client = createPublicClient();
  if (!client) return [];
  try {
    return await cached(["adaptations", packageId, String(limit)], async () => {
      const { data, error } = await client
        .from("discovery_courses")
        .select("package_id, title")
        .eq("adapted_from_package_id", packageId)
        .order("listed_at", { ascending: false })
        .order("package_id", { ascending: true })
        .limit(Math.min(Math.max(limit, 1), 50));
      if (error) throw new Unavailable();
      return ((data as Array<{ package_id: string; title: string }> | null) ?? []).filter(
        (r) => typeof r.package_id === "string" && typeof r.title === "string",
      );
    });
  } catch {
    return [];
  }
}

/** A shared element (RLS: listed rows only), or null. */
export async function cachedElement(docId: string): Promise<DiscoveryElement | null> {
  const client = createPublicClient();
  if (!client) return null;
  try {
    return await cached(["element", docId], async () => {
      const { data, error } = await client
        .from("discovery_elements")
        .select(Object.keys(DiscoveryElementSchema.shape).join(", "))
        .eq("doc_id", docId)
        .limit(1);
      if (error) throw new Unavailable();
      return parseElementRows(data)[0] ?? null;
    });
  } catch {
    return null;
  }
}

/** The first shared elements of one course (the course page's list). */
export async function cachedCourseElements(
  packageId: string,
  pageSize = 12,
  now: Date = new Date(),
): Promise<ElementHit[]> {
  const client = createPublicClient();
  if (!client) return [];
  const hour = new Date(now);
  hour.setUTCMinutes(0, 0, 0);
  try {
    return await cached(["course-elements", packageId, String(pageSize), hour.toISOString()], async () => {
      const page = await searchElements(
        client,
        { scope: "elements", q: "", filters: {}, cursor: null },
        { now, pageSize, packageId, withFacets: false },
      );
      if (page.unavailable) throw new Unavailable();
      return page.hits;
    });
  } catch {
    return [];
  }
}

/**
 * The manifest's chapter list (`chapters[]`: slug + title) of a course the
 * caller has ALREADY confirmed is listed (`cachedCourse` returned it) — the
 * slugs the course page needs to link each chapter to its page on the
 * student site (`lib/course-chapter-links.ts`). The discovery index carries
 * titles only, so this reads `packages.manifest -> chapters` with the service
 * client: one column path of one listed course, public course structure that
 * its student site already shows. Never throws; null when unavailable.
 */
export async function cachedListedCourseChapters(packageId: string): Promise<unknown> {
  const client = createServiceClient();
  if (!client) return null;
  try {
    return await cached(["course-chapters", packageId], async () => {
      const { data, error } = await client
        .from("packages")
        .select("chapters:manifest->chapters")
        .eq("id", packageId)
        .limit(1);
      if (error) throw new Unavailable();
      const row = (data as Array<{ chapters?: unknown }> | null)?.[0];
      return row?.chapters ?? null;
    });
  } catch {
    return null;
  }
}
