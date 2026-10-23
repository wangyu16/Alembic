import { LICENSE_LABELS, type License } from "@alembic/package-contract";

/**
 * Educator-facing words for Discover's facet values and badges (Phase 5
 * Track A.4). The index stores ids (`study-guide`, `CC-BY-4.0`, `pass`); the
 * pages show these. No Git or developer words (CLAUDE.md).
 */

const SPACE_LABELS: Record<string, string> = {
  "study-guide": "Study guide",
  slides: "Slides",
  practice: "Practice questions",
  concepts: "Concept map",
  "assessment-support": "Assessment guide",
  assets: "Figure or media",
  metadata: "Course information",
  provenance: "Attribution record",
};

const KIND_LABELS: Record<string, string> = {
  md: "Text",
  markdown: "Text",
  slides: "Slide deck",
  paged: "Printable document",
  svg: "Image (SVG)",
  png: "Image (PNG)",
  jpg: "Image (JPEG)",
  jpeg: "Image (JPEG)",
  gif: "Image (GIF)",
  webp: "Image (WebP)",
  mol: "Chemical structure",
  ket: "Chemical structure",
  plot: "Plot",
  pdf: "PDF",
  html: "Web page",
};

const IMAGE_KINDS = new Set(["svg", "png", "jpg", "jpeg", "gif", "webp"]);

export function spaceLabel(space: string): string {
  return SPACE_LABELS[space] ?? capitalize(space.replace(/-/g, " "));
}

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.toUpperCase();
}

export function isImageKind(kind: string): boolean {
  return IMAGE_KINDS.has(kind.toLowerCase());
}

export function licenseLabelOf(id: string): string {
  return (LICENSE_LABELS as Record<string, string>)[id as License] ?? id;
}

export const A11Y_LABELS: Record<string, { label: string; className: string } | null> = {
  pass: { label: "Accessible", className: "text-ok" },
  warn: { label: "Accessibility: minor issues", className: "text-warn" },
  fail: { label: "Accessibility: needs work", className: "text-danger" },
  unknown: null,
};

export const A11Y_FACET_LABELS: Record<string, string> = {
  pass: "Accessible",
  warn: "Minor issues",
  fail: "Needs work",
  unknown: "Not checked",
};

export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "1 chapter" / "3 chapters". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The publisher handle from a public repo URL (`https://github.com/{owner}/…`). */
export function publisherOf(publicRepoUrl: string): string {
  const m = publicRepoUrl.match(/^https:\/\/github\.com\/([^/]+)\//);
  return m ? m[1]! : "";
}
