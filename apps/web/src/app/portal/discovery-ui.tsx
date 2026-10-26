import Link from "next/link";
import type { ReactNode } from "react";
import {
  COURSE_FILTERS,
  ELEMENT_FILTERS,
  discoveryHref,
  pageNumber,
  type CourseHit,
  type DiscoveryQuery,
  type ElementHit,
  type Facets,
} from "@/lib/discovery-search";
import {
  A11Y_FACET_LABELS,
  A11Y_LABELS,
  capitalize,
  elementDescription,
  kindLabel,
  licenseLabelOf,
  plural,
  spaceLabel,
} from "@/lib/discovery-labels";
import { ClampedDescription, ReportControl } from "./portal-client";
import { ElementAdapt, type AdaptTarget } from "./element-adapt";
import type { ReportCode } from "@/lib/report-return";

/**
 * Server-rendered pieces of Discover (Phase 5 Track A.4). The search form is
 * a plain GET form and every result, filter and page is a link, so the
 * results list works without JavaScript; the only client parts are the
 * description toggle, the report control and the element adapt picker.
 */

const FILTER_LABELS: Record<string, string> = {
  discipline: "Subject",
  level: "Level",
  license: "License",
  a11y: "Accessibility",
  kind: "File kind",
  type: "Type",
};

const ANY_LABELS: Record<string, string> = {
  discipline: "Any subject",
  level: "Any level",
  license: "Any license",
  a11y: "Any accessibility",
  kind: "Any kind",
  type: "Any type",
};

function facetValueLabel(filter: string, value: string): string {
  switch (filter) {
    case "license":
      return licenseLabelOf(value);
    case "a11y":
      return A11Y_FACET_LABELS[value] ?? value;
    case "kind":
      return kindLabel(value);
    case "type":
      return spaceLabel(value);
    default:
      return capitalize(value);
  }
}

export function SearchForm({ query, facets }: { query: DiscoveryQuery; facets: Facets }) {
  const filters = query.scope === "elements" ? ELEMENT_FILTERS : COURSE_FILTERS;
  const current = query.filters as Record<string, string | undefined>;
  const anyFilter = filters.some((f) => current[f]);
  // Keyed by the query it shows, so its uncontrolled inputs are rebuilt from
  // the URL on every navigation — Back/Forward between result pages shows the
  // search and filters of the page you are on (P12), not what was last typed.
  // autoComplete="off" stops the browser restoring old values on a reload.
  return (
    <form
      key={discoveryHref(query)}
      role="search"
      method="get"
      action="/portal"
      autoComplete="off"
      className="flex min-w-0 flex-col gap-2"
    >
      {query.scope === "elements" && <input type="hidden" name="scope" value="elements" />}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="discover-q" className="sr-only">
          {query.scope === "elements" ? "Search shared files" : "Search courses"}
        </label>
        <input
          id="discover-q"
          type="search"
          name="q"
          defaultValue={query.q}
          maxLength={200}
          placeholder={
            query.scope === "elements"
              ? "Search figures, plots, explanations…"
              : "Search titles, topics, descriptions…"
          }
          className="field min-w-0 flex-1 text-sm"
        />
        <button type="submit" className="btn btn-primary btn-sm">
          Search
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => {
          // No current accessibility check is not a choice (owner decision 2,
          // 2026-10-24; the SQL leaves it out since 0032 — filtered here too,
          // so the order of deploying code and migration does not matter).
          const values = (facets.values[f] ?? []).filter((v) => !(f === "a11y" && v.value === "unknown"));
          const selected = current[f] ?? "";
          const listed = values.some((v) => v.value.toLowerCase() === selected.toLowerCase());
          return (
            <label key={f} className="min-w-0 max-w-full text-xs">
              <span className="sr-only">{FILTER_LABELS[f]}</span>
              {/* Capped to the row: a long option must not widen the page (P12, 375px). */}
              <select name={f} defaultValue={selected} className="field max-w-full min-w-0 text-xs">
                <option value="">{ANY_LABELS[f]}</option>
                {selected && !listed && (
                  <option value={selected}>{facetValueLabel(f, selected)} (0)</option>
                )}
                {values.map((v) => (
                  <option key={v.value} value={v.value}>
                    {facetValueLabel(f, v.value)} ({v.count})
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        {anyFilter && (
          <Link
            href={discoveryHref(query, Object.fromEntries(filters.map((f) => [f, ""])))}
            className="text-xs text-muted hover:text-ink"
          >
            Clear filters
          </Link>
        )}
      </div>
    </form>
  );
}

export function ResultCount({ query, total }: { query: DiscoveryQuery; total: number }) {
  const noun = query.scope === "elements" ? "shared file" : "course";
  const page = pageNumber(query);
  return (
    <p role="status" className="text-xs text-faint">
      {plural(total, noun)}
      {query.q ? <> matching “{query.q}”</> : null}
      {page > 1 ? ` · page ${page}` : null}
    </p>
  );
}

export function Pager({ query, next }: { query: DiscoveryQuery; next: string | null }) {
  if (!query.cursor && !next) return null;
  return (
    <nav aria-label="Result pages" className="flex items-center justify-between gap-3 pt-2 text-sm">
      {query.cursor ? (
        <Link href={discoveryHref(query)} className="link">
          ← First page
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={discoveryHref(query, { after: next })} className="link" rel="next">
          Next page →
        </Link>
      ) : (
        <span className="text-xs text-faint">End of results</span>
      )}
    </nav>
  );
}

function Meta({ children }: { children: ReactNode }) {
  return <span className="text-xs text-faint">{children}</span>;
}

export function CourseResult({
  c,
  back,
  reportOutcome = null,
}: {
  c: CourseHit;
  /** This results page's address (a no-script report comes back to it). */
  back: string;
  reportOutcome?: ReportCode | null;
}) {
  const badge = A11Y_LABELS[c.accessibility_status];
  return (
    <li className="py-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-xl text-ink">
          <Link href={`/p/${encodeURIComponent(c.package_id)}`} className="hover:underline">
            {c.title}
          </Link>
        </h2>
        <span className="chip shrink-0">{licenseLabelOf(c.license)}</span>
      </div>
      {c.description && <ClampedDescription text={c.description} />}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {c.discipline && <Meta>{capitalize(c.discipline)}</Meta>}
        {c.level && <Meta>{capitalize(c.level)}</Meta>}
        <Meta>{plural(c.chapter_count, "chapter")}</Meta>
        {c.element_count > 0 && <Meta>{plural(c.element_count, "shared file")}</Meta>}
        {c.adaptation_count > 0 && <Meta>Adapted by {plural(c.adaptation_count, "course")}</Meta>}
        {badge && <span className={`text-xs ${badge.className}`}>{badge.label}</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
        <a href={c.site_url} target="_blank" rel="noreferrer" className="link">
          Visit site<span className="sr-only"> of {c.title} (opens in a new tab)</span> ↗
        </a>
        <Link
          href={`/p/${encodeURIComponent(c.package_id)}?adapt=1#adapt`}
          className="text-muted hover:text-ink"
        >
          Adapt<span className="sr-only"> {c.title}</span> →
        </Link>
        <ReportControl packageId={c.package_id} title={c.title} back={back} outcome={reportOutcome} />
      </div>
    </li>
  );
}

export function ElementResult({ e, targets }: { e: ElementHit; targets: AdaptTarget[] }) {
  const description = elementDescription(e);
  return (
    <li className="flex items-center justify-between gap-3 py-4">
      <div className="min-w-0">
        <Link
          href={`/portal/element/${encodeURIComponent(e.doc_id)}`}
          className="block truncate text-sm text-ink hover:underline"
        >
          {e.title}
        </Link>
        {description && <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">{description}</p>}
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-faint">
          <span className="chip">{kindLabel(e.kind)}</span>
          <span>{spaceLabel(e.space)}</span>
          {e.course_listed ? (
            <Link href={`/p/${encodeURIComponent(e.package_id)}`} className="truncate hover:text-ink">
              {e.package_title}
            </Link>
          ) : (
            <span className="truncate">{e.package_title}</span>
          )}
          <span>{licenseLabelOf(e.license)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {e.permalink_class === "object" && <ElementAdapt docId={e.doc_id} packages={targets} />}
        <a href={`/d/${e.doc_id}`} target="_blank" rel="noreferrer" className="link text-sm">
          Open<span className="sr-only"> {e.title} (opens in a new tab)</span> ↗
        </a>
      </div>
    </li>
  );
}
