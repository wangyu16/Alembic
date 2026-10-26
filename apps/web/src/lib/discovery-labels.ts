import { BUILTIN_FILE_TYPES, LICENSE_LABELS, type License } from "@alembic/package-contract";

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

/**
 * File kinds as the index stores them (carrier kind ids, `@alembic/carriers`
 * registry: `ketcher`, `plot`, `md`, `slides`, `paged`, and plain media by
 * extension). Explicit words first; anything else is looked up in the
 * file-type registry (`BUILTIN_FILE_TYPES`, by editor kind or extension), so a
 * kind id is never shown raw ("KETCHER" — blind-critique 2026-10-26, P7).
 */
const KIND_LABELS: Record<string, string> = {
  md: "Text",
  markdown: "Text",
  slides: "Slide deck",
  paged: "Printable document",
  ketcher: "Chemical structure",
  plot: "Plot",
  svg: "Image (SVG)",
  png: "Image (PNG)",
  jpg: "Image (JPEG)",
  jpeg: "Image (JPEG)",
  gif: "Image (GIF)",
  webp: "Image (WebP)",
  avif: "Image (AVIF)",
  mol: "Chemical structure",
  ket: "Chemical structure",
  mp3: "Audio",
  wav: "Audio",
  m4a: "Audio",
  ogg: "Audio",
  mp4: "Video",
  webm: "Video",
  mov: "Video",
  csv: "Data (CSV)",
  pdf: "PDF",
  html: "Web page",
};

/** Kinds whose `/d` link serves an image a browser can show in `<img>`
 *  (the SVG carriers `ketcher` and `plot` are images too). */
const IMAGE_KINDS = new Set(["svg", "png", "jpg", "jpeg", "gif", "webp", "avif", "ketcher", "plot"]);
const AUDIO_KINDS = new Set(["mp3", "wav", "m4a", "ogg"]);
const VIDEO_KINDS = new Set(["mp4", "webm", "mov"]);

export function spaceLabel(space: string): string {
  return SPACE_LABELS[space] ?? capitalize(space.replace(/-/g, " "));
}

export function kindLabel(kind: string): string {
  const k = kind.toLowerCase();
  const known = KIND_LABELS[k];
  if (known) return known;
  const def =
    BUILTIN_FILE_TYPES.find((t) => t.editorKind === k) ??
    BUILTIN_FILE_TYPES.find((t) => t.extension === `.${k}`);
  if (def) return def.label;
  return k ? `${k.toUpperCase()} file` : "File";
}

export function isImageKind(kind: string): boolean {
  return IMAGE_KINDS.has(kind.toLowerCase());
}

/** How the element page previews a kind: an image, a player, or nothing. */
export function previewOf(kind: string): "image" | "audio" | "video" | null {
  const k = kind.toLowerCase();
  if (IMAGE_KINDS.has(k)) return "image";
  if (AUDIO_KINDS.has(k)) return "audio";
  if (VIDEO_KINDS.has(k)) return "video";
  return null;
}

/**
 * The description worth showing under an element's title: its own
 * description, unless that only repeats the title (P7: the detail page
 * showed the title twice). Null when there is nothing to add.
 */
export function elementDescription(e: { title: string; description: string | null }): string | null {
  const d = (e.description ?? "").trim();
  if (!d) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return norm(d) === norm(e.title) ? null : d;
}

/** Alt text for an element's image preview: its alt text, else a real
 *  description, else what it is and its title. */
export function elementAlt(e: { title: string; kind: string; description: string | null; alt_text: string | null }): string {
  const alt = (e.alt_text ?? "").trim();
  if (alt) return alt;
  return elementDescription(e) ?? `${kindLabel(e.kind)}: ${e.title}`;
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
