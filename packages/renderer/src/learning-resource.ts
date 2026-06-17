/**
 * LRMI / schema.org `LearningResource` metadata (Phase 6, M30).
 *
 * Published pages embed a JSON-LD `LearningResource` so the package is
 * discoverable by search engines + harvesters even independently of Alembic's
 * portal (goal.md §6: "the portal consumes the same standard metadata rather
 * than owning a proprietary record format"). Pure: builds a `<script
 * type="application/ld+json">` string from package metadata. The license URL
 * comes from the contract (`licenseUrl`).
 */

import { licenseUrl, type License } from "@alembic/package-contract";

export interface LearningResourceMeta {
  /** Resource title (course/package name). */
  name: string;
  description?: string;
  license: License;
  /** Subject area (schema.org `about`). */
  discipline?: string;
  /** Audience level (schema.org `educationalLevel`), e.g. "undergraduate". */
  educationalLevel?: string;
  /** Canonical public URL of the page, when known. */
  url?: string;
  /** ISO date the resource was published, when known. */
  datePublished?: string;
  /** Accessibility audit status — drives schema.org accessibility hints. */
  accessibility?: "pass" | "warn" | "fail" | "unknown";
}

/** JSON-encode safely for embedding in a <script> element (escape `<`). */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
}

/** Build the schema.org `LearningResource` object (plain data). */
export function learningResource(meta: LearningResourceMeta): Record<string, unknown> {
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LearningResource",
    name: meta.name,
    learningResourceType: "course",
    inLanguage: "en",
    isAccessibleForFree: true,
    license: licenseUrl(meta.license),
    creativeWorkStatus: "Published",
  };
  if (meta.description) ld["description"] = meta.description;
  if (meta.discipline) ld["about"] = meta.discipline;
  if (meta.educationalLevel) ld["educationalLevel"] = meta.educationalLevel;
  if (meta.url) ld["url"] = meta.url;
  if (meta.datePublished) ld["datePublished"] = meta.datePublished;
  // schema.org accessibility: a passing audit asserts conformance + features.
  if (meta.accessibility === "pass") {
    ld["accessMode"] = ["textual", "visual"];
    ld["accessibilityFeature"] = ["alternativeText", "structuralNavigation"];
    ld["accessibilityControl"] = ["fullKeyboardControl"];
  }
  return ld;
}

/** A `<script type="application/ld+json">` LearningResource block for <head>. */
export function learningResourceJsonLd(meta: LearningResourceMeta): string {
  return `<script type="application/ld+json">\n${jsonForScript(
    learningResource(meta),
  )}\n</script>`;
}
