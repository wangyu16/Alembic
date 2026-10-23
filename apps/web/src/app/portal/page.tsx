import Link from "next/link";
import { headers } from "next/headers";
import { learningResource } from "@alembic/renderer";
import type { License } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cachedSearch } from "@/lib/discovery-cache";
import {
  discoveryHref,
  pageNumber,
  parseDiscoveryQuery,
  type CourseHit,
  type DiscoveryQuery,
  type ElementHit,
} from "@/lib/discovery-search";
import { checkRateLimit } from "@/lib/rate-limit-server";
import { recordDiscoveryEvent } from "@/lib/record-discovery-event";
import { appBaseUrl } from "@/lib/app-url";
import type { AdaptTarget } from "./element-adapt";
import { CourseResult, ElementResult, Pager, ResultCount, SearchForm } from "./discovery-ui";

export const dynamic = "force-dynamic";

/**
 * Discover (Phase 5 Track A.4): server-side search over the discovery index
 * (`lib/discovery-search.ts`, docs/specs/discovery-index.md). All state is in
 * the URL — scope, text, filters, the keyset cursor — so results are
 * linkable, page with plain links and work without JavaScript. The result
 * pages are cached for every visitor alike (`lib/discovery-cache.ts`); only
 * the element adapt picker reads the visitor's own session.
 */
export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseDiscoveryQuery(await searchParams);
  const session = await createSupabaseServerClient();

  // Searching (text, filters or a later page) is rate limited per address
  // (A.6: 120 / min); the plain landing view is not.
  const searching = Boolean(query.q || query.cursor || Object.keys(query.filters).length);
  if (searching) {
    const gate = await checkRateLimit("search", await headers());
    if (!gate.ok) {
      return (
        <Shell query={query}>
          <p role="alert" className="text-muted">
            That&rsquo;s a lot of searches in a short time. Please wait{" "}
            {gate.retryAfterSeconds} seconds and try again.
          </p>
        </Shell>
      );
    }
  }

  const page = await cachedSearch(query);
  if (!page.unavailable) {
    recordDiscoveryEvent(
      {
        type: "portal.searched",
        scope: query.scope,
        query: query.q,
        filters: query.filters,
        resultCount: page.facets.total,
        page: pageNumber(query),
        sort: "relevance",
      },
      { session },
    );
  }

  if (page.unavailable) {
    return (
      <Shell query={query}>
        <p role="alert" className="text-muted">
          Search isn&rsquo;t available right now. Please try again in a moment.
        </p>
      </Shell>
    );
  }

  // The signed-in educator's own active courses, offered as targets for
  // "Adapt into my course" on shared elements (RLS: their own rows only).
  let targets: AdaptTarget[] = [];
  let signedIn = false;
  if (query.scope === "elements" && page.hits.length > 0) {
    const {
      data: { user },
    } = await session.auth.getUser();
    signedIn = Boolean(user);
    if (user) {
      const { data } = await session
        .from("packages")
        .select("id, title")
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      targets = (data as AdaptTarget[] | null) ?? [];
    }
  }

  const nothingListed = !searching && page.hits.length === 0;
  return (
    <Shell query={query}>
      {query.scope === "courses" && page.hits.length > 0 && (
        <ItemListJsonLd courses={page.hits as CourseHit[]} />
      )}
      <SearchForm query={query} facets={page.facets} />
      <ResultCount query={query} total={page.facets.total} />
      {page.hits.length === 0 ? (
        nothingListed ? (
          <EmptyIndex scope={query.scope} />
        ) : (
          <p className="text-muted">
            Nothing matches yet. Try fewer words, or{" "}
            <Link href={discoveryHref({ ...query, q: "", filters: {}, cursor: null } as DiscoveryQuery)} className="link">
              clear the search
            </Link>
            .
          </p>
        )
      ) : query.scope === "courses" ? (
        <ol className="divide-y divide-[var(--edge-soft)]" aria-label="Courses">
          {(page.hits as CourseHit[]).map((c) => (
            <CourseResult key={c.package_id} c={c} />
          ))}
        </ol>
      ) : (
        <ol className="divide-y divide-[var(--edge-soft)]" aria-label="Shared elements">
          {(page.hits as ElementHit[]).map((e) => (
            <ElementResult key={e.doc_id} e={e} targets={targets} />
          ))}
        </ol>
      )}
      {query.scope === "elements" && page.hits.length > 0 && !signedIn && (
        <p className="text-xs text-faint">
          <Link href="/signin" className="link">
            Sign in
          </Link>{" "}
          to add shared elements to your own courses.
        </p>
      )}
      <Pager query={query} next={page.next} />
    </Shell>
  );
}

function Shell({ query, children }: { query: DiscoveryQuery; children: React.ReactNode }) {
  const tab = (active: boolean) =>
    active
      ? "rounded-full bg-[var(--accent-soft)] px-3 py-1 font-medium text-[var(--accent)]"
      : "rounded-full border border-edge px-3 py-1 text-muted hover:text-ink";
  const keepText = query.q ? `&q=${encodeURIComponent(query.q)}` : "";
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-6 py-12">
      <link rel="alternate" type="application/ld+json" href="/feed/courses.jsonld" title="Listed courses (LRMI feed)" />
      <header className="flex flex-col gap-3">
        <h1 className="font-serif text-4xl leading-[1.1] tracking-tight text-ink">
          <span aria-hidden className="mr-3 font-mono text-[0.7em] text-faint select-none">
            #
          </span>
          Discover.
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-muted text-pretty">
          Open educational resources shared by educators — visit them, adapt
          them, make them fit your students.
        </p>
      </header>

      {/* Two search scopes (document-model.md §4): whole courses, and
          individual shared elements (per-file "share this"). */}
      <nav aria-label="What to search" className="flex items-center gap-2 text-sm">
        <Link
          href={`/portal${keepText ? `?${keepText.slice(1)}` : ""}`}
          aria-current={query.scope === "courses" ? "page" : undefined}
          className={tab(query.scope === "courses")}
        >
          Courses
        </Link>
        <Link
          href={`/portal?scope=elements${keepText}`}
          aria-current={query.scope === "elements" ? "page" : undefined}
          className={tab(query.scope === "elements")}
          title="Individual shared elements — figures, plots, explanations"
        >
          Elements
        </Link>
      </nav>
      {children}
    </main>
  );
}

function EmptyIndex({ scope }: { scope: DiscoveryQuery["scope"] }) {
  return scope === "elements" ? (
    <p className="text-muted">
      No shared elements yet — in your workspace, open a package&rsquo;s Assets
      and choose <span className="text-ink">Share this</span> on any figure,
      plot, or explanation worth reusing.
    </p>
  ) : (
    <p className="text-muted">
      No courses have been listed yet — be the first: publish a package, then
      choose <span className="text-ink">List publicly</span>.
    </p>
  );
}

/**
 * M30.2 — the portal consumes the SAME standard metadata (schema.org), not a
 * proprietary record: an ItemList of LearningResource for the courses on this
 * page, each pointing at its course page.
 */
function ItemListJsonLd({ courses }: { courses: CourseHit[] }) {
  const origin = appBaseUrl();
  const json = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: courses.map((c, i) => {
      const { ["@context"]: _ctx, ...item } = learningResource({
        name: c.title,
        description: c.description || undefined,
        license: c.license as License,
        discipline: c.discipline || undefined,
        educationalLevel: c.level || undefined,
        url: `${origin}/p/${encodeURIComponent(c.package_id)}`,
        accessibility: c.accessibility_status,
        keywords: c.keywords.length ? c.keywords : undefined,
      });
      return { "@type": "ListItem", position: i + 1, item: { ...item, sameAs: c.site_url } };
    }),
  }).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}

