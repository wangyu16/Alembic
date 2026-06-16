/**
 * Package manifest (`alembic.json` at the public repo root).
 * Links the paired public/private repositories into one logical package
 * and records the schema version for explicit, logged migrations.
 */

import { z } from "zod";

/** Bump only with an explicit, documented migration. Old versions stay readable. */
export const PACKAGE_SCHEMA_VERSION = 1;

export const LicenseSchema = z.enum([
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "CC-BY-NC-4.0",
  "CC-BY-NC-SA-4.0",
  "CC0-1.0",
]);

export type License = z.infer<typeof LicenseSchema>;

export const RepoRefSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
});

export type RepoRef = z.infer<typeof RepoRefSchema>;

/** A chapter slug: filename-safe, becomes `study-guide/<slug>.md`. */
export const CHAPTER_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * One chapter (module) of a course, in display order. A chapter is the working
 * unit: one study-guide page plus its concept map, objectives, slides, and
 * question templates (later phases). v0.1/single-chapter packages omit
 * `chapters` entirely and are read as one implicit chapter.
 */
export const ChapterRefSchema = z.object({
  slug: z.string().regex(CHAPTER_SLUG_PATTERN),
  title: z.string().min(1),
});

export type ChapterRef = z.infer<typeof ChapterRefSchema>;

/**
 * Accessibility status, recorded in the manifest so it travels with the package
 * (repos are the source of truth) and can be projected to the public portal.
 * Additive and optional: absent means "never checked" (treated as unknown).
 */
export const AccessibilityStatusSchema = z.object({
  status: z.enum(["pass", "warn", "fail", "unknown"]),
  errorCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  checkedAt: z.iso.datetime(),
});

export type AccessibilityStatus = z.infer<typeof AccessibilityStatusSchema>;

export const PackageManifestSchema = z.object({
  schemaVersion: z.number().int().positive(),
  /** Stable platform-wide package ID (not the repo name). */
  packageId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(""),
  discipline: z.string().default("chemistry"),
  courseContext: z
    .object({
      courseName: z.string().optional(),
      level: z.string().optional(),
      institutionType: z.string().optional(),
    })
    .default({}),
  license: LicenseSchema,
  /** Absent only in sandbox (pre-GitHub) packages; set by graduation. */
  publicRepo: RepoRefSchema.optional(),
  /** Absent only in sandbox (pre-GitHub) packages; set by graduation. */
  privateRepo: RepoRefSchema.optional(),
  /**
   * Ordered chapters. Optional and additive: when absent, the package is a
   * single implicit chapter (the default study-guide file) — old packages stay
   * valid with no migration.
   */
  chapters: z.array(ChapterRefSchema).optional(),
  /** Last accessibility audit result. Optional and additive (absent = unknown). */
  accessibility: AccessibilityStatusSchema.optional(),
  /**
   * Package-level adaptation lineage: set when this package was forked/adapted
   * from another (goal.md §5). Optional + additive; absent = an original work.
   * Typed loosely here (the full record lives in adaptation.ts) to keep the
   * manifest free of import cycles; ops/validation use AdaptationSourceSchema.
   */
  adaptedFrom: z
    .object({
      packageId: z.string().min(1),
      title: z.string().optional(),
      snapshot: z.string().optional(),
      license: LicenseSchema,
      attribution: z.string().min(1),
      url: z.string().optional(),
    })
    .optional(),
  createdAt: z.iso.datetime(),
});

export type PackageManifest = z.infer<typeof PackageManifestSchema>;

export function parseManifest(json: unknown): PackageManifest {
  return PackageManifestSchema.parse(json);
}
