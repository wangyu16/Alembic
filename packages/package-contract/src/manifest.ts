/**
 * Package manifest (`alembic.json` at the public repo root).
 * Links the paired public/private repositories into one logical package
 * and records the schema version for explicit, logged migrations.
 */

import { z } from "zod";

/**
 * Schema version stamped on NEWLY CREATED packages. Bump only with an explicit,
 * documented migration. Old versions stay readable. Held at 1 until the E3
 * migration gate lands elsewhere — the schema already ACCEPTS v2 (see
 * `SUPPORTED_SCHEMA_VERSIONS`) so a migrated v2 package validates.
 */
export const PACKAGE_SCHEMA_VERSION = 1;

/**
 * Schema versions the manifest parser accepts. Contract v2 (package-contract-v2.md
 * §7) is a staged, one-way migration: a v2 manifest (`schemaVersion: 2`) must
 * validate alongside v1 while new packages stay v1 until the migration gate flips
 * the creation default. Additive — v1 packages parse byte-for-byte as before.
 */
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2] as const;

/** True when a parsed manifest is contract v2 (package-contract-v2.md). */
export function isV2Manifest(m: Pick<PackageManifest, "schemaVersion">): boolean {
  return m.schemaVersion === 2;
}

export const LicenseSchema = z.enum([
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "CC-BY-NC-4.0",
  "CC-BY-NC-SA-4.0",
  "CC0-1.0",
]);

export type License = z.infer<typeof LicenseSchema>;

/** Canonical public URL for each license (for citation + LRMI/schema.org metadata). */
export const LICENSE_URLS: Record<License, string> = {
  "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/",
  "CC-BY-SA-4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
  "CC-BY-NC-4.0": "https://creativecommons.org/licenses/by-nc/4.0/",
  "CC-BY-NC-SA-4.0": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
};

/** The canonical deed URL for a license id. */
export function licenseUrl(license: License): string {
  return LICENSE_URLS[license];
}

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
 * What a course calls its ordered units. Display-only: it never changes the
 * data model (the unit is always a `ChapterRef`), only the educator-facing
 * wording. Absent → "chapter" (so old packages are unchanged).
 */
export const UnitTermSchema = z.enum(["chapter", "module", "lesson", "unit", "week"]);
export type UnitTerm = z.infer<typeof UnitTermSchema>;

export interface UnitTermForms {
  singular: string;
  plural: string;
  Singular: string;
  Plural: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Display forms (singular/plural, each lower + Capitalized) for a unit term. */
export function unitTermForms(term: UnitTerm | undefined): UnitTermForms {
  const singular = term ?? "chapter";
  const plural = `${singular}s`; // chapter→chapters, module→modules, … (all +s)
  return { singular, plural, Singular: cap(singular), Plural: cap(plural) };
}

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
  /**
   * Contract schema version. Accepts 1 (v1) or 2 (v2); other values reject so a
   * package from an unknown/future schema fails closed rather than parsing
   * loosely. New packages are stamped `PACKAGE_SCHEMA_VERSION` (still 1).
   */
  schemaVersion: z
    .number()
    .int()
    .refine(
      (v): v is (typeof SUPPORTED_SCHEMA_VERSIONS)[number] =>
        (SUPPORTED_SCHEMA_VERSIONS as readonly number[]).includes(v),
      {
        message: `schemaVersion must be one of ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}`,
      },
    ),
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
  /**
   * What this course calls its units (display-only wording). Optional +
   * additive; absent = "chapter". Never affects the data model.
   */
  unitTerm: UnitTermSchema.optional(),
  /** Last accessibility audit result. Optional and additive (absent = unknown). */
  accessibility: AccessibilityStatusSchema.optional(),
  /**
   * Labels the active teaching cycle of the `current/` space (contract v2,
   * package-layout.md §8: `current/archive/<term>/`). Optional + additive;
   * absent = no active cycle. Free-form ("2026-fall") — it names a folder,
   * so keep it URL-safe by convention; never affects the v1 data model.
   */
  currentTerm: z.string().min(1).optional(),
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
