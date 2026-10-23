import type { SupabaseClient } from "@supabase/supabase-js";
import {
  A11Y_STATUSES,
  DiscoveryCourseSchema,
  DiscoveryElementSchema,
  ScoredSchema,
  parseCourseRows,
  parseElementRows,
  type DiscoveryCourse,
  type DiscoveryElement,
  type DiscoveryScope,
  DOC_ID_SOURCE,
} from "@alembic/package-contract";

/**
 * Discover's server-side search (Phase 5 Track A.2; discovery-index.md §2).
 *
 * The portal's state lives in the URL (`/portal?scope=&q=&discipline=…&after=`)
 * so a results page works without JavaScript, can be bookmarked and shared,
 * and pages with plain links. This module is the pure part: parse and clamp
 * the URL, encode the keyset cursor, build the RPC arguments, and parse what
 * comes back (fail closed through the contract's row parsers). The only IO is
 * the injected Supabase client's `rpc` calls — the anonymous session is
 * enough; no service role.
 *
 * Paging is keyset: the cursor is the last row's (score, id) plus the
 * `asOf` hour the scores were computed for, so later pages rank exactly like
 * the first. There is no offset anywhere, and no unbounded read: a page asks
 * for at most `MAX_PAGE_SIZE + 1` rows.
 */

export const PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
export const MAX_QUERY_LENGTH = 200;
export const MAX_FACET_LENGTH = 80;

export const COURSE_FILTERS = ["discipline", "level", "license", "a11y"] as const;
export const ELEMENT_FILTERS = ["kind", "type", "license", "discipline"] as const;
export type CourseFilter = (typeof COURSE_FILTERS)[number];
export type ElementFilter = (typeof ELEMENT_FILTERS)[number];

export interface Cursor {
  /** The last row's score, exactly as the database returned it. */
  score: string;
  /** The last row's id (package or doc id) — the tiebreak. */
  id: string;
  /** The hour the scores were computed for (ISO). */
  asOf: string;
  /** The 1-based number of the page this cursor opens (≥ 2) — for the
   *  "page N" label and the research event, never for the query. */
  page: number;
}

export type DiscoveryQuery =
  | {
      scope: "courses";
      q: string;
      filters: Partial<Record<CourseFilter, string>>;
      cursor: Cursor | null;
    }
  | {
      scope: "elements";
      q: string;
      filters: Partial<Record<ElementFilter, string>>;
      cursor: Cursor | null;
    };

type Params = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Collapse whitespace and drop control characters; cap the length. */
function cleanText(v: string, max: number): string {
  return v
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const SCORE_RE = /^\d{1,6}(\.\d{1,6})?$/;
// A course id, or THE docId shape (P5.B.1.o) — a cursor can only carry an id
// the registry could have minted or adopted.
const ID_RE = new RegExp(`^(pkg-[A-Za-z0-9_-]{1,120}|${DOC_ID_SOURCE})$`);

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify({ s: c.score, i: c.id, t: c.asOf, n: c.page }), "utf8").toString(
    "base64url",
  );
}

/** A malformed or tampered cursor is ignored (first page), never an error. */
export function decodeCursor(raw: string, scope: DiscoveryScope): Cursor | null {
  if (!raw || raw.length > 600) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    const score = v["s"];
    const id = v["i"];
    const asOf = v["t"];
    if (typeof score !== "string" || !SCORE_RE.test(score)) return null;
    if (typeof id !== "string" || !ID_RE.test(id)) return null;
    if (!id.startsWith(scope === "courses" ? "pkg-" : "doc-")) return null;
    if (typeof asOf !== "string" || Number.isNaN(Date.parse(asOf))) return null;
    const n = v["n"];
    const page = typeof n === "number" && Number.isInteger(n) && n >= 2 && n <= 100_000 ? n : 2;
    return { score, id, asOf: new Date(asOf).toISOString(), page };
  } catch {
    return null;
  }
}

/** The hour scores are computed for on a first page (stable across pages). */
export function pageAsOf(now: Date): string {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

/** Parse `/portal` search params into a clamped, validated query. */
export function parseDiscoveryQuery(sp: Params): DiscoveryQuery {
  const scope: DiscoveryScope = first(sp["scope"]) === "elements" ? "elements" : "courses";
  const q = cleanText(first(sp["q"]), MAX_QUERY_LENGTH);
  const cursor = decodeCursor(first(sp["after"]), scope);
  const pick = <K extends string>(keys: readonly K[]) => {
    const out: Partial<Record<K, string>> = {};
    for (const k of keys) {
      const v = cleanText(first(sp[k]), MAX_FACET_LENGTH);
      if (v) out[k] = v;
    }
    return out;
  };
  if (scope === "elements") {
    return { scope, q, filters: pick(ELEMENT_FILTERS), cursor };
  }
  const filters = pick(COURSE_FILTERS);
  // a11y is a closed set; anything else is dropped rather than sent.
  if (filters.a11y && !(A11Y_STATUSES as readonly string[]).includes(filters.a11y)) {
    delete filters.a11y;
  }
  return { scope, q, filters, cursor };
}

/** The `/portal` URL for a query, with `patch` applied (a filter set to ""
 *  is removed). Any change other than `after` starts again at page one. */
export function discoveryHref(
  query: DiscoveryQuery,
  patch: Partial<Record<string, string | null>> = {},
): string {
  const p = new URLSearchParams();
  if (query.scope === "elements") p.set("scope", "elements");
  const q = patch["q"] ?? query.q;
  if (q) p.set("q", q);
  const keys = query.scope === "elements" ? ELEMENT_FILTERS : COURSE_FILTERS;
  for (const k of keys) {
    const v = k in patch ? patch[k] : (query.filters as Record<string, string | undefined>)[k];
    if (v) p.set(k, v);
  }
  const after = patch["after"];
  if (after) p.set("after", after);
  const s = p.toString();
  return `/portal${s ? `?${s}` : ""}`;
}

function clampPage(n: number): number {
  return Math.min(Math.max(Math.trunc(n) || PAGE_SIZE, 1), MAX_PAGE_SIZE);
}

const orNull = (v: string | undefined) => (v ? v : null);

export function courseSearchArgs(
  query: Extract<DiscoveryQuery, { scope: "courses" }>,
  asOf: string,
  pageSize = PAGE_SIZE,
) {
  return {
    p_q: query.q || null,
    p_discipline: orNull(query.filters.discipline),
    p_level: orNull(query.filters.level),
    p_license: orNull(query.filters.license),
    p_a11y: orNull(query.filters.a11y),
    p_after_score: query.cursor?.score ?? null,
    p_after_id: query.cursor?.id ?? null,
    p_as_of: asOf,
    // One extra row tells us whether there is a next page.
    p_limit: clampPage(pageSize) + 1,
  };
}

export function courseFacetArgs(query: Extract<DiscoveryQuery, { scope: "courses" }>) {
  return {
    p_q: query.q || null,
    p_discipline: orNull(query.filters.discipline),
    p_level: orNull(query.filters.level),
    p_license: orNull(query.filters.license),
    p_a11y: orNull(query.filters.a11y),
  };
}

export function elementSearchArgs(
  query: Extract<DiscoveryQuery, { scope: "elements" }>,
  asOf: string,
  pageSize = PAGE_SIZE,
  packageId: string | null = null,
) {
  return {
    p_q: query.q || null,
    p_kind: orNull(query.filters.kind),
    p_type: orNull(query.filters.type),
    p_license: orNull(query.filters.license),
    p_discipline: orNull(query.filters.discipline),
    p_package_id: packageId,
    p_after_score: query.cursor?.score ?? null,
    p_after_id: query.cursor?.id ?? null,
    p_as_of: asOf,
    p_limit: clampPage(pageSize) + 1,
  };
}

export function elementFacetArgs(
  query: Extract<DiscoveryQuery, { scope: "elements" }>,
  packageId: string | null = null,
) {
  return {
    p_q: query.q || null,
    p_kind: orNull(query.filters.kind),
    p_type: orNull(query.filters.type),
    p_license: orNull(query.filters.license),
    p_discipline: orNull(query.filters.discipline),
    p_package_id: packageId,
  };
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface Facets {
  total: number;
  values: Record<string, FacetValue[]>;
}

/** Facet rows (`facet, value, n`) → counts per facet. Unknown facets dropped. */
export function parseFacetRows(rows: unknown, facets: readonly string[]): Facets {
  const out: Facets = { total: 0, values: Object.fromEntries(facets.map((f) => [f, []])) };
  if (!Array.isArray(rows)) return out;
  for (const r of rows as Array<Record<string, unknown>>) {
    const facet = r["facet"];
    const n = Number(r["n"]);
    if (!Number.isFinite(n) || n < 0) continue;
    if (facet === "total") {
      out.total = n;
      continue;
    }
    const value = r["value"];
    if (typeof facet !== "string" || typeof value !== "string" || !(facet in out.values)) continue;
    out.values[facet]!.push({ value, count: n });
  }
  return out;
}

export type CourseHit = DiscoveryCourse & { score: string };
export type ElementHit = DiscoveryElement & { score: string };

export interface SearchPage<T> {
  hits: T[];
  /** Cursor for the next page, or null on the last page. */
  next: string | null;
  facets: Facets;
  /** True when the search could not run (e.g. the migration is not applied). */
  unavailable: boolean;
}

const CourseHitSchema = DiscoveryCourseSchema.merge(ScoredSchema);
const ElementHitSchema = DiscoveryElementSchema.merge(ScoredSchema);

/**
 * Split what the database returned into this page's rows and the next-page
 * cursor — from the RAW rows, before the fail-closed parse.
 *
 * The query asks for `pageSize + 1` rows; the extra one only says "there is
 * more". Whether there is a next page, which rows belong to this page and
 * where the next page starts are all decided on the raw rows: a row that the
 * parse then drops (malformed, or failing the listing re-check) must neither
 * end paging early nor pull the look-ahead row onto this page.
 *
 * The cursor is the (score, id) of the last raw row of this page — dropped or
 * not, it is a real position in the database's order, so the next page neither
 * repeats nor skips a row. If that row's key is unusable as a cursor (it could
 * not be decoded back), walk back to the last row in the page whose key is: the
 * rows after it are read again at the top of the next page (and dropped again,
 * as they were here). Each cursor still lies strictly past the previous one, so
 * paging always advances. No usable key in the whole page → no next page.
 */
function splitPage(
  raw: unknown,
  pageSize: number,
  scope: DiscoveryScope,
  idKey: "package_id" | "doc_id",
  asOf: string,
  page: number,
): { pageRows: unknown[]; next: string | null } {
  const rows = Array.isArray(raw) ? raw : [];
  const pageRows = rows.slice(0, pageSize);
  if (rows.length <= pageSize) return { pageRows, next: null };
  const prefix = scope === "courses" ? "pkg-" : "doc-";
  for (let i = pageRows.length - 1; i >= 0; i--) {
    const r = pageRows[i] as Record<string, unknown> | null;
    if (!r || typeof r !== "object") continue;
    const rawScore = r["score"];
    const score = typeof rawScore === "number" ? String(rawScore) : rawScore;
    const id = r[idKey];
    if (typeof score !== "string" || !SCORE_RE.test(score)) continue;
    if (typeof id !== "string" || !ID_RE.test(id) || !id.startsWith(prefix)) continue;
    return { pageRows, next: encodeCursor({ score, id, asOf, page: page + 1 }) };
  }
  return { pageRows, next: null };
}

/** The 1-based number of the page a query is on. */
export function pageNumber(query: DiscoveryQuery): number {
  return query.cursor?.page ?? 1;
}

export async function searchCourses(
  client: SupabaseClient,
  query: Extract<DiscoveryQuery, { scope: "courses" }>,
  { now = new Date(), pageSize = PAGE_SIZE }: { now?: Date; pageSize?: number } = {},
): Promise<SearchPage<CourseHit>> {
  const size = clampPage(pageSize);
  const asOf = query.cursor?.asOf ?? pageAsOf(now);
  const [page, facets] = await Promise.all([
    client.rpc("discovery_search_courses", courseSearchArgs(query, asOf, size)),
    client.rpc("discovery_course_facets", courseFacetArgs(query)),
  ]);
  if (page.error) return { hits: [], next: null, facets: parseFacetRows(null, COURSE_FILTERS), unavailable: true };
  const { pageRows, next } = splitPage(page.data, size, "courses", "package_id", asOf, pageNumber(query));
  return {
    hits: parseCourseRows(pageRows, CourseHitSchema) as CourseHit[],
    next,
    facets: parseFacetRows(facets.error ? null : facets.data, COURSE_FILTERS),
    unavailable: false,
  };
}

export async function searchElements(
  client: SupabaseClient,
  query: Extract<DiscoveryQuery, { scope: "elements" }>,
  {
    now = new Date(),
    pageSize = PAGE_SIZE,
    packageId = null,
    withFacets = true,
  }: { now?: Date; pageSize?: number; packageId?: string | null; withFacets?: boolean } = {},
): Promise<SearchPage<ElementHit>> {
  const size = clampPage(pageSize);
  const asOf = query.cursor?.asOf ?? pageAsOf(now);
  const [page, facets] = await Promise.all([
    client.rpc("discovery_search_elements", elementSearchArgs(query, asOf, size, packageId)),
    withFacets
      ? client.rpc("discovery_element_facets", elementFacetArgs(query, packageId))
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (page.error) return { hits: [], next: null, facets: parseFacetRows(null, ELEMENT_FILTERS), unavailable: true };
  const { pageRows, next } = splitPage(page.data, size, "elements", "doc_id", asOf, pageNumber(query));
  return {
    hits: parseElementRows(pageRows, ElementHitSchema) as ElementHit[],
    next,
    facets: parseFacetRows(facets.error ? null : facets.data, ELEMENT_FILTERS),
    unavailable: false,
  };
}
