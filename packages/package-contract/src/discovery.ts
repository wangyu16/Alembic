/**
 * Discovery records (Phase 5 Track A; docs/specs/discovery-index.md).
 *
 * The discovery index is a PROJECTION (Roadmap rule 3): one row per listed
 * course and per shared element, derived in the database
 * (`supabase/migrations/0022_trackA_discovery.sql`) from the manifest, the
 * registration registry and the listing consent — never written by app code.
 * This module is the contract side of it: what may be listed, the shape of a
 * row the search returns, and which manifest fields feed it. The SQL mirrors
 * the constants here; `discovery.agreement.test.ts` keeps the two in step.
 *
 * Pure: no IO, no framework imports.
 */

import { z } from "zod";
import { OPEN_LICENSES } from "./manifest";
import type { PackageSpace } from "./spaces";

/** Spaces whose files are never listed, shared or not (contract v2 §2,
 *  document-model.md §4): `private` is the private repo, `current` is
 *  semester ephemera. */
export const NEVER_LISTED_SPACES: readonly PackageSpace[] = ["private", "current"];

/** The manifest fields the course projection reads (and nothing else). */
export const DISCOVERY_MANIFEST_FIELDS = [
  "title",
  "description",
  "keywords",
  "discipline",
  "courseContext",
  "license",
  "accessibility",
  "chapters",
  "publicRepo",
  "adaptedFrom",
] as const;

/** courseContext keys that are public course identity (shown on the published
 *  home page) and so may be projected. */
export const DISCOVERY_COURSE_CONTEXT_KEYS = [
  "courseName",
  "level",
  "institutionType",
  "instructor",
  "courseNumber",
  "department",
] as const;

/** The two search scopes (document-model.md §4). */
export const DISCOVERY_SCOPES = ["courses", "elements"] as const;
export type DiscoveryScope = (typeof DISCOVERY_SCOPES)[number];

export const A11Y_STATUSES = ["pass", "warn", "fail", "unknown"] as const;
export type A11yStatus = (typeof A11Y_STATUSES)[number];

/** Facet values are compared trimmed and lower-cased (SQL `discovery_facet_value`). */
export function facetValue(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toLowerCase();
  return v === "" ? null : v;
}

/** True when a licence id is one of the open licences. Accepts any string
 *  (an element's per-file licence is free text). */
export function isOpenLicenseId(license: string | null | undefined): boolean {
  return (OPEN_LICENSES as readonly string[]).includes(license ?? "");
}

const nullableText = z.string().nullable();
const textArray = z.array(z.string());
const timestamp = z.union([z.string(), z.date()]).transform((v) =>
  v instanceof Date ? v.toISOString() : v,
);
/** Postgres numerics arrive as strings through PostgREST, numbers through
 *  other drivers. Keep the exact text (it is the paging key). */
const numericText = z.union([z.string(), z.number()]).transform((v) => String(v));

/** One listed course, as the search and the course page read it. */
export const DiscoveryCourseSchema = z.object({
  package_id: z.string().min(1),
  title: z.string(),
  description: z.string(),
  keywords: textArray,
  chapter_titles: textArray,
  topics: textArray,
  discipline: nullableText,
  level: nullableText,
  course_context: z.record(z.string(), z.string()).default({}),
  license: z.string(),
  accessibility_status: z.enum(A11Y_STATUSES),
  chapter_count: z.number().int(),
  element_count: z.number().int(),
  adapted_from_package_id: nullableText,
  adapted_from_title: nullableText,
  adapted_from_url: nullableText,
  adapted_from_attribution: nullableText,
  adaptation_count: z.number().int(),
  public_repo_url: z.string(),
  site_url: z.string(),
  listed_at: timestamp,
  updated_at: timestamp,
  completeness: z.number(),
});
export type DiscoveryCourse = z.infer<typeof DiscoveryCourseSchema>;

/** One shared element. `repo`/`space` ride along so a reader can re-check
 *  the boundary (defence in depth, `isListableElementRow`). */
export const DiscoveryElementSchema = z.object({
  doc_id: z.string().regex(/^doc-/),
  package_id: z.string().min(1),
  repo: z.string(),
  space: z.string(),
  kind: z.string(),
  permalink_class: z.enum(["document", "object"]),
  path: z.string(),
  title: z.string(),
  description: nullableText,
  alt_text: nullableText,
  tags: textArray,
  license: z.string(),
  package_title: z.string(),
  discipline: nullableText,
  level: nullableText,
  course_listed: z.boolean(),
  adapted_from_doc_id: nullableText,
  adaptation_count: z.number().int(),
  described: z.boolean(),
  listed_at: timestamp,
  updated_at: timestamp,
  completeness: z.number(),
});
export type DiscoveryElement = z.infer<typeof DiscoveryElementSchema>;

/** A search hit carries its ranking score (exact text — the paging key). */
export const ScoredSchema = z.object({ score: numericText });

/** A course row may be shown only with an open licence (listing requires one). */
export function isListableCourseRow(row: Pick<DiscoveryCourse, "license">): boolean {
  return isOpenLicenseId(row.license);
}

/** An element row may be shown only from the public repo, outside the
 *  never-listed spaces. */
export function isListableElementRow(row: Pick<DiscoveryElement, "repo" | "space">): boolean {
  return (
    row.repo === "public" &&
    !(NEVER_LISTED_SPACES as readonly string[]).includes(row.space)
  );
}

/**
 * Parse rows from the database: drop any row that does not match the
 * contract shape or fails the boundary re-check (fail closed — a malformed
 * or out-of-bounds row is never shown).
 */
export function parseCourseRows<T extends z.ZodTypeAny = typeof DiscoveryCourseSchema>(
  rows: unknown,
  schema?: T,
): z.infer<T>[] {
  const s = (schema ?? DiscoveryCourseSchema) as T;
  if (!Array.isArray(rows)) return [];
  const out: z.infer<T>[] = [];
  for (const r of rows) {
    const parsed = s.safeParse(r);
    if (parsed.success && isListableCourseRow(parsed.data as DiscoveryCourse)) out.push(parsed.data);
  }
  return out;
}

export function parseElementRows<T extends z.ZodTypeAny = typeof DiscoveryElementSchema>(
  rows: unknown,
  schema?: T,
): z.infer<T>[] {
  const s = (schema ?? DiscoveryElementSchema) as T;
  if (!Array.isArray(rows)) return [];
  const out: z.infer<T>[] = [];
  for (const r of rows) {
    const parsed = s.safeParse(r);
    if (parsed.success && isListableElementRow(parsed.data as DiscoveryElement)) out.push(parsed.data);
  }
  return out;
}

/** Suggested values for the Course details card (free text is still allowed;
 *  facets compare lower-cased). */
export const DISCIPLINE_SUGGESTIONS = [
  "chemistry",
  "biochemistry",
  "biology",
  "physics",
  "mathematics",
  "statistics",
  "computer science",
  "engineering",
  "earth science",
  "environmental science",
] as const;

export const LEVEL_SUGGESTIONS = [
  "high school",
  "introductory undergraduate",
  "upper undergraduate",
  "graduate",
  "professional",
] as const;
