/**
 * Course concept-map document (editor-overhaul Phase 1, guardrail G6;
 * repurposed 2026-07-09 — owner decision).
 *
 * `concepts/course.md` is free-form notes: concepts/topics, their
 * correlations, and course-level learning objectives, in whatever structure
 * the educator likes. It is NEVER read for the published course home page,
 * Discover/portal, or LRMI — those are driven by `manifest.description`
 * (authored directly, plain text, in the "Course details" card) and
 * `manifest.keywords`. The `.md` file is prose (no `{{attrs[#…]}}` block
 * IDs), so it stays outside the block-ID/reconcile machinery.
 *
 * The canonical path is `concepts/course.md` — the concepts space, matching
 * what offline producers (Coursewerk, the `alembic-package` skill) emit (see
 * docs/specs/upload-contract.md H9). Packages authored in-app before 2026-07-14
 * wrote to the old `metadata/course.md`; the loader falls back to that so their
 * map is still read.
 */

import { assertPathAllowedInRepo } from "@alembic/package-contract";
import type { PackageStore } from "./store";

/** Canonical course concept-map file (markdown, public `concepts` layer). */
export const COURSE_CONCEPT_MAP_PATH = "concepts/course.md";

/** Legacy location (pre-2026-07-14, in-app authored) — read-only fallback. */
export const LEGACY_COURSE_CONCEPT_MAP_PATH = "metadata/course.md";

/** Per-chapter description file. */
export function chapterDescriptionPath(slug: string): string {
  return `metadata/${slug}.md`;
}

/** The current course concept-map markdown, or null if unset. Reads the
 *  canonical `concepts/course.md`, falling back to the legacy `metadata/course.md`
 *  for packages authored in-app before the path was unified. */
export async function loadCourseConceptMap(
  store: PackageStore,
  packageId: string,
): Promise<string | null> {
  const files = await store.listFiles(packageId);
  const at = (path: string) =>
    files.find((f) => f.repo === "public" && f.path === path)?.content ?? null;
  return at(COURSE_CONCEPT_MAP_PATH) ?? at(LEGACY_COURSE_CONCEPT_MAP_PATH);
}

/**
 * Persist the course concept-map document verbatim. Free text — no
 * derivation, no manifest side effect (unlike the old course-description
 * behavior this replaces).
 */
export async function setCourseConceptMap(
  store: PackageStore,
  packageId: string,
  markdown: string,
): Promise<void> {
  assertPathAllowedInRepo(COURSE_CONCEPT_MAP_PATH, "public");
  await store.putFiles(packageId, [
    { repo: "public", path: COURSE_CONCEPT_MAP_PATH, content: markdown },
  ]);
}
