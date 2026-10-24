/**
 * Discovery records (Phase 5 Track A; docs/specs/discovery-index.md).
 *
 * The discovery index is a PROJECTION (Roadmap rule 3): one row per listed
 * course and per shared element, derived in the database
 * (`supabase/migrations/0022_trackA_discovery.sql`) from the manifest, the
 * registration registry and the listing consent — never written by app code.
 * This module is the contract side of it: what may be listed, the shape of a
 * row the search returns, and which manifest fields feed it. The SQL mirrors
 * the constants here; `apps/web/src/lib/discovery-agreement.test.ts` keeps the two in step.
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

/**
 * The manifest fields the course projection reads (and nothing else). All are
 * owner-asserted descriptions of the course. NOT read since security loop r1
 * (M2, migration 0025): `publicRepo` (discovery uses the repository the publish
 * path recorded, `packages.public_repo`) and `accessibility` (discovery uses
 * the server's own check record, `packages.a11y_status`) — both are
 * owner-writable and were trusted for listability, adapt and ranking.
 */
export const DISCOVERY_MANIFEST_FIELDS = [
  "title",
  "description",
  "keywords",
  "discipline",
  "courseContext",
  "license",
  "chapters",
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

// ---------------------------------------------------------------------------
// Ranking (A.3; discovery-index.md §3). Mirrors the SQL functions
// `discovery_quality` and `discovery_score` exactly (agreement-tested).
// Quality gates PROMINENCE, never visibility (goal.md §6): it only scales a
// match's relevance, so a low-quality match is still listed.
// ---------------------------------------------------------------------------

export const RANKING = {
  /** Weights of the quality signals; they sum to 1. */
  weights: {
    accessibility: 0.3,
    openLicense: 0.15,
    completeness: 0.2,
    recency: 0.2,
    adaptations: 0.15,
  },
  /** Recency decays as exp(-days / recencyDays): ~0.5 after four months. */
  recencyDays: 180,
  /** Adaptations saturate at this many adapting packages (log scale). */
  adaptationsSaturateAt: 20,
  /** score = relevance × (floor + span × quality): ×0.75 … ×1.25. */
  floor: 0.75,
  span: 0.5,
} as const;

export interface QualitySignals {
  /** Course: the audit status. Element: "pass" when described, else "unknown". */
  a11y: string;
  license: string;
  /** 0 … 1 (projected). */
  completeness: number;
  adaptations: number;
  updatedAt: Date | string;
  asOf: Date | string;
}

const clamp01 = (n: number) => Math.min(Math.max(Number.isFinite(n) ? n : 0, 0), 1);

export function a11ySignal(status: string): number {
  return status === "pass" ? 1 : status === "warn" ? 0.5 : 0;
}

export function recencySignal(updatedAt: Date | string, asOf: Date | string): number {
  const days = Math.max((new Date(asOf).getTime() - new Date(updatedAt).getTime()) / 86_400_000, 0);
  return Math.exp(-Math.min(days / RANKING.recencyDays, 50));
}

export function adaptationSignal(count: number): number {
  return Math.min(Math.log(1 + Math.max(count, 0)) / Math.log(1 + RANKING.adaptationsSaturateAt), 1);
}

/** 0 … 1. */
export function qualityScore(s: QualitySignals): number {
  const w = RANKING.weights;
  return (
    w.accessibility * a11ySignal(s.a11y) +
    w.openLicense * (isOpenLicenseId(s.license) ? 1 : 0) +
    w.completeness * clamp01(s.completeness) +
    w.recency * recencySignal(s.updatedAt, s.asOf) +
    w.adaptations * adaptationSignal(s.adaptations)
  );
}

/** Accessibility statuses that are a current check (anything else — `unknown` — is none). */
export const CHECKED_A11Y_STATUSES = ["pass", "warn", "fail"] as const;

/**
 * A COURSE's quality (owner decision 2, 2026-10-24; SQL
 * `discovery_course_quality`, 0032): like `qualityScore`, except that a course
 * with no current accessibility check (`unknown` — not checked yet for the
 * current version, or the check could not run) is NEUTRAL on accessibility:
 * that term is left out and the other weights are re-scaled to sum to 1, so
 * the course is never ranked below a failing one with the same other signals,
 * nor above a passing one. Elements keep `qualityScore` (their signal — a
 * description — is always known). 0 … 1.
 */
export function courseQualityScore(s: QualitySignals): number {
  if ((CHECKED_A11Y_STATUSES as readonly string[]).includes(s.a11y)) return qualityScore(s);
  return qualityScore({ ...s, a11y: "unknown" }) / (1 - RANKING.weights.accessibility);
}

/** Relevance first; quality scales it within ×0.75 … ×1.25. Rounded to 6
 *  decimals (the SQL returns `numeric`, the paging key). */
export function rankScore(relevance: number, quality: number): number {
  const raw = (Number.isFinite(relevance) ? relevance : 0) * (RANKING.floor + RANKING.span * clamp01(quality));
  return Math.round(raw * 1e6) / 1e6;
}
