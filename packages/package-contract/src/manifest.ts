/**
 * Package manifest (`alembic.json` at the public repo root).
 * Links the paired public/private repositories into one logical package
 * and records the schema version for explicit, logged migrations.
 */

import { z } from "zod";
import { FileTypeDefSchema } from "./file-types";

/**
 * Schema version stamped on NEWLY CREATED packages (owner: bumped to 2,
 * 2026-07-09). Bump only with an explicit, documented migration. Old
 * version-1 packages stay readable and unaffected — this only changes what
 * *new* packages are stamped with. Note this is a **label bump only**: the
 * v2 space model (`spaces.ts`, `isV2Manifest`) isn't wired into any live
 * write path yet — `package-ops` still validates/writes through the v1
 * layer model (`layers.ts`) unconditionally, regardless of `schemaVersion`.
 * A real v2 activation (switching the write path to `spaces.ts`) is a
 * separate, larger migration.
 */
export const PACKAGE_SCHEMA_VERSION = 2;

/**
 * Schema versions the manifest parser accepts. Contract v2 (package-contract-v2.md
 * §7) is a staged, one-way migration: a v2 manifest (`schemaVersion: 2`) must
 * validate alongside v1. Additive — v1 packages parse byte-for-byte as before.
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

/** How each license is written for a human reader (public pages, citations). */
export const LICENSE_LABELS: Record<License, string> = {
  "CC-BY-4.0": "CC BY 4.0",
  "CC-BY-SA-4.0": "CC BY-SA 4.0",
  "CC-BY-NC-4.0": "CC BY-NC 4.0",
  "CC-BY-NC-SA-4.0": "CC BY-NC-SA 4.0",
  "CC0-1.0": "CC0 1.0",
};

export function licenseLabel(license: License): string {
  return LICENSE_LABELS[license];
}

/**
 * True when the license is a public-domain **dedication** rather than a grant of
 * permissions over a copyright the author keeps.
 *
 * The distinction is load-bearing wherever a notice is rendered: CC0 waives the
 * author's copyright, so printing "© 2026 A. Educator" beside it would assert
 * exactly the right the license gives up. Render a dedication notice for these,
 * never a copyright line.
 */
export function isPublicDomainDedication(license: License): boolean {
  return license === "CC0-1.0";
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
   * loosely. New packages are stamped `PACKAGE_SCHEMA_VERSION` (2, as of
   * 2026-07-09 — see that constant's doc comment for what the label bump
   * does and doesn't mean).
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
  /**
   * The course description: one paragraph of plain text (not markdown),
   * authored directly in the "Course details" card — soft-capped at 200
   * words at the write path (`setCourseInfoAction`), not enforced here so
   * older data always still parses. Shown on the published course home page,
   * the Discover/portal listing, and the LRMI JSON-LD.
   */
  description: z.string().default(""),
  /** Discovery tags/keywords, authored alongside `description`. Additive;
   *  feeds the published page's LRMI JSON-LD `keywords`. */
  keywords: z.array(z.string()).default([]),
  discipline: z.string().default("chemistry"),
  courseContext: z
    .object({
      courseName: z.string().optional(),
      level: z.string().optional(),
      institutionType: z.string().optional(),
      /**
       * Course-identity fields shown on the published course home page
       * (S — course site redesign, 2026-07). All optional/additive; a course
       * that hasn't filled them in just omits that line on the home page.
       */
      instructor: z.string().optional(),
      courseNumber: z.string().optional(),
      department: z.string().optional(),
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
  /**
   * The course's viewing theme — ONE theme for the whole course, so every
   * generated view (chapters/slides/paged, student site) looks consistent. It is
   * an **orz theme id** (e.g. `light-neat-3`, `dark-elegant-1`, `light-academic-1`),
   * captured from the study guide's own theme picker on save (last write wins
   * across chapters). Legacy values `"dark"`/`"light"` are still accepted and map
   * to defaults at generation. Optional + additive; absent = the editor default.
   */
  theme: z.string().optional(),
  /**
   * Per-space theme overrides (orz theme id), so a space can carry its own
   * global theme independent of the study guide — e.g. practice-question lists
   * can use a different theme from the study guides. Keyed by space id
   * (`practice`, …); a space absent here falls back to `theme`. Captured from
   * each document's own theme picker on save (last write wins across chapters).
   */
  themes: z.record(z.string(), z.string()).optional(),
  /** Last accessibility audit result. Optional and additive (absent = unknown). */
  accessibility: AccessibilityStatusSchema.optional(),
  /**
   * The IMMUTABLE id of the active teaching cycle in the `current/` space —
   * the pointer, per the pointer model (workspace-collections.md P5). Files
   * live at `current/<currentTerm>/…`; "current" vs "archived" is derived from
   * this field, never from position, so rollover is one manifest write and no
   * file ever moves. URL-safe by construction (see `isValidTermId`). Optional +
   * additive; absent = no active cycle. Never affects the v1 data model.
   */
  currentTerm: z.string().min(1).optional(),
  /**
   * The DISPLAY label for `currentTerm` ("Fall 2026"). Split from the id so the
   * label can be renamed freely without moving a file — renaming the id would
   * churn every path/permalink the pointer model exists to keep stable.
   * Optional + additive; absent = fall back to the id.
   */
  currentTermLabel: z.string().min(1).optional(),
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
  /**
   * Educator-added collection file types (collections framework, CF0;
   * file-types.ts). Extends the built-in registry: each entry maps an extension
   * to a handling class, so a new type Alembic doesn't ship still has a defined
   * insert/open/download behavior. Optional + additive; absent = built-ins only.
   */
  fileTypes: z.array(FileTypeDefSchema).optional(),
  createdAt: z.iso.datetime(),
});

export type PackageManifest = z.infer<typeof PackageManifestSchema>;

export function parseManifest(json: unknown): PackageManifest {
  return PackageManifestSchema.parse(json);
}
