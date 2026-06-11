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
  publicRepo: RepoRefSchema,
  /** Absent only in sandbox (pre-GitHub) packages. */
  privateRepo: RepoRefSchema.optional(),
  createdAt: z.iso.datetime(),
});

export type PackageManifest = z.infer<typeof PackageManifestSchema>;

export function parseManifest(json: unknown): PackageManifest {
  return PackageManifestSchema.parse(json);
}
