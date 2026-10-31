/**
 * Manifest schemaVersion 3 (docs/specs/v3/package-contract-v3.md §6).
 *
 * Two schemas: the WORKING manifest (in the private working repo; may name
 * both repositories) and the PUBLIC manifest (written by Publish; must never
 * name the working repo, and lists only the chapters present in the public
 * tree). v3 extends v2's fields; lineage stays in `adaptedFrom`.
 */

import { z } from "zod";
import { PackageManifestSchema } from "./manifest";
import { isReservedChapterSlug } from "./contract-v3";

export const MANIFEST_SCHEMA_VERSION_V3 = 3;

export const ChapterModeSchema = z.enum(["draft", "package"]);
export type ChapterMode = z.infer<typeof ChapterModeSchema>;

const base = PackageManifestSchema.omit({ schemaVersion: true, chapters: true });

const ChapterRefV3Schema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .refine((s) => !isReservedChapterSlug(s), { message: "This chapter slug is reserved" }),
  title: z.string().min(1),
  /** Coursewerk's mode for this chapter; Draft chapters are never published. */
  mode: ChapterModeSchema.default("package"),
});
export type ChapterRefV3 = z.infer<typeof ChapterRefV3Schema>;

const v3Fields = {
  schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION_V3),
  chapters: z.array(ChapterRefV3Schema).default([]),
  /** Who the course is for ("first-year undergraduates"). */
  audience: z.string().max(500).optional(),
  /** The site type and major version this course follows (family SITE-TYPE-CONTRACT §3), e.g. "oer-course@1"; Alembic's. */
  type: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*@\d+$/).optional(),
  /** The Coursewerk version this course runs (FC-16 v1); absent = no Coursewerk yet. */
  coursewerk: z.object({ version: z.string().min(1) }).optional(),
  /** Each file's status (family SITE-TYPE-CONTRACT §7): path → completed | withdrawn; a page not listed is a draft. Never public. */
  status: z.record(z.string().min(1).max(300), z.enum(["completed", "withdrawn"])).optional(),
  /** Alembic's per-course options (owner/deputy). `editReturnsToDraft`: a saved edit to a completed page makes it a draft again. Never public. */
  options: z.object({ editReturnsToDraft: z.boolean().optional() }).strict().optional(),
};

function uniqueSlugs(m: { chapters: Array<{ slug: string }> }, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const c of m.chapters) {
    if (seen.has(c.slug)) ctx.addIssue({ code: "custom", message: `Duplicate chapter slug "${c.slug}"` });
    seen.add(c.slug);
  }
}

/** The working-repo manifest. */
export const WorkingManifestV3Schema = base.extend(v3Fields).superRefine(uniqueSlugs);
export type WorkingManifestV3 = z.infer<typeof WorkingManifestV3Schema>;

/**
 * The public-repo manifest: strict (no unknown keys can carry anything out),
 * and with no repository references at all — the public copy needs none and
 * must never reveal the working repo's name (R16).
 */
export const PublicManifestV3Schema = base
  .omit({ privateRepo: true, publicRepo: true })
  .extend(v3Fields)
  .omit({ status: true, options: true })
  .strict()
  .superRefine(uniqueSlugs);
export type PublicManifestV3 = z.infer<typeof PublicManifestV3Schema>;

/**
 * Build the public manifest from the working one and the chapters present in
 * the assembled public tree (publisher §3 step 8): titles and order from the
 * working manifest, filtered to `publishedSlugs`.
 */
export function toPublicManifest(working: WorkingManifestV3, publishedSlugs: ReadonlySet<string>): PublicManifestV3 {
  const { privateRepo: _priv, publicRepo: _pub, status: _status, options: _options, ...rest } = working;
  return PublicManifestV3Schema.parse({
    ...rest,
    chapters: working.chapters.filter((c) => publishedSlugs.has(c.slug)),
  });
}
