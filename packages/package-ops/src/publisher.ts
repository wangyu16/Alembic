/**
 * Publisher v3, pure core (docs/specs/v3/publisher-v3.md §2–§3, family
 * SITE-TYPE-CONTRACT §7): which unit each file belongs to, and the assembled
 * public tree by file status. (The per-chapter decisions, course-plan gate and
 * link hold were retired on 2026-10-30: the person decides what is published.)
 * IO (reading the pinned tree, the public commit, the site build) lives in
 * the Publish job; everything that decides what reaches students is here.
 */

import {
  assertPublishWritable,
  isPage,
  isProjectable,
  statusOf,
  toPublicManifest,
  type StatusMap,
  type WorkingManifestV3,
} from "@alembic/package-contract";

/* -------------------------------------------------------------------------- *
 * Units
 * -------------------------------------------------------------------------- */

export type Unit =
  | { kind: "chapter"; slug: string }
  | { kind: "course" }
  | { kind: "asset"; path: string }
  | { kind: "orphan"; slug: string } // chapter files for a slug not in the manifest and never published
  | { kind: "none" }; // not projectable (private, generated)

export const unitKey = (u: Unit): string =>
  u.kind === "chapter" ? `chapter:${u.slug}` : u.kind === "asset" ? `asset:${u.path}` : u.kind === "orphan" ? `orphan:${u.slug}` : u.kind;

const SLOT_DIRS = ["study-guide", "slides", "practice", "concepts", "assessment-support"] as const;

/** The chapter slug a path belongs to, if it is a slot file or chapter-scoped. */
export function chapterSlugOf(path: string): string | null {
  // Any folder under `<space>/chapters/` is chapter-scoped, valid slug or not
  // (an invalid name can never match a chapter, so it becomes an orphan) (G3 M1).
  const scoped = /^[a-z-]+\/chapters\/([^/]+)\//.exec(path);
  if (scoped) return scoped[1]!;
  // Any file directly in a slot folder is a chapter file, named by its stem —
  // whatever its case or extension (G3 r2 M4). Only `concepts/course.md` is the course map.
  const direct = /^(study-guide|slides|practice|concepts|assessment-support)\/([^/]+)$/.exec(path);
  if (direct) {
    if (direct[1] === "concepts" && direct[2] === "course.md") return null;
    return direct[2]!.replace(/\.[^.]*$/, "").replace(/\.slides$/i, "");
  }
  return null;
}

/** Assign a working-repo path to its unit (publisher §2). */
export function unitOf(path: string, chapters: ReadonlySet<string>, everPublishedChapters: ReadonlySet<string>): Unit {
  if (!isProjectable(path)) return { kind: "none" };
  const slug = chapterSlugOf(path);
  if (slug !== null) {
    if (chapters.has(slug)) return { kind: "chapter", slug };
    return everPublishedChapters.has(slug) ? { kind: "chapter", slug } : { kind: "orphan", slug };
  }
  if (path.startsWith("assets/")) return { kind: "asset", path };
  return { kind: "course" };
}

/* -------------------------------------------------------------------------- *
 * Decisions
 * -------------------------------------------------------------------------- */

export type Severity = "always" | "default" | "never";
export interface Finding {
  unit: string; // unitKey
  path?: string;
  check: string;
  severity: Severity;
  message: string;
}

/* -------------------------------------------------------------------------- *
 * Assembly
 * -------------------------------------------------------------------------- */

export interface TreeFile {
  /** Existing blob id (reused), or text to write. */
  blobSha?: string;
  text?: string;
}

/* -------------------------------------------------------------------------- *
 * Assembly by file (family SITE-TYPE-CONTRACT §7: the person decides)
 * -------------------------------------------------------------------------- */

export interface FileAssembleInput {
  /** Placed, readable, safe files at the pinned working version W (path → file), with their unit key. */
  working: ReadonlyMap<string, TreeFile & { unit: string }>;
  /** The last published version of each public file (path → file + unit). */
  published: ReadonlyMap<string, TreeFile & { unit: string }>;
  /** Published texts of pages (to keep the deleted figures a kept draft still shows). */
  publishedTexts?: ReadonlyMap<string, string>;
  status: StatusMap | undefined;
  manifest: WorkingManifestV3;
  /** Files Publish generates (`.alembic/…`), already computed. */
  generated?: ReadonlyMap<string, TreeFile>;
}

export interface FileAssembly {
  files: Map<string, TreeFile & { origin: "unit" | "generated"; unit: string }>;
  /** Chapters with at least one page on the website. */
  publishedChapters: Set<string>;
  /** Pages that are drafts now and stay at their last published version. */
  kept: string[];
}

/**
 * What the website holds after a Publish (it mirrors this; anything else goes):
 * completed pages as they are now; pages set back to draft at their last
 * published version; other public files as they are now, unless withdrawn;
 * a figure deleted since stays only while a kept draft still shows it.
 * Nothing about content is decided here.
 */
export function assembleByFile(i: FileAssembleInput): FileAssembly {
  const files: FileAssembly["files"] = new Map();
  const kept: string[] = [];
  for (const [path, f] of i.working) {
    const s = statusOf(i.status, path);
    if (s === "withdrawn") continue;
    if (s === "completed" || s === "public") { files.set(path, { blobSha: f.blobSha, text: f.text, origin: "unit", unit: f.unit }); continue; }
    // A draft page: its last published version stays, if it has one.
    const before = i.published.get(path);
    if (before) { files.set(path, { blobSha: before.blobSha, text: before.text, origin: "unit", unit: before.unit }); kept.push(path); }
  }
  // Deleted figures (and other non-page files) a kept draft's published version still shows.
  const keptLinks = new Set<string>();
  for (const path of kept) {
    const text = i.publishedTexts?.get(path);
    if (text) for (const target of relativeLinks(path, text)) keptLinks.add(target);
  }
  for (const [path, f] of i.published) {
    if (files.has(path) || i.working.has(path) || isPage(path)) continue;
    if (statusOf(i.status, path) === "withdrawn" || !keptLinks.has(path)) continue;
    files.set(path, { blobSha: f.blobSha, text: f.text, origin: "unit", unit: f.unit });
  }
  const publishedChapters = new Set<string>();
  for (const [path, f] of files) if (f.unit.startsWith("chapter:") && isPage(path)) publishedChapters.add(f.unit.slice(8));

  const pub = toPublicManifest(i.manifest, publishedChapters);
  files.set("alembic.json", { text: JSON.stringify(pub, null, 2) + "\n", origin: "generated", unit: "course" });
  for (const [path, f] of i.generated ?? []) files.set(path, { ...f, origin: "generated", unit: "course" });
  for (const [path, f] of files) assertPublishWritable(path, f.origin);
  return { files, publishedChapters, kept };
}

/* -------------------------------------------------------------------------- *
 * Link check (to a fixpoint)
 * -------------------------------------------------------------------------- */

/** Relative links and image/embed sources in Markdown text. */
export function relativeLinks(fromPath: string, text: string): string[] {
  const out = new Set<string>();
  // Inline links (also <with spaces>), images, src/href attributes (either quote), and reference definitions (G3 L1, r2 L3).
  const re = /\]\(\s*(?:<([^>]+)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)|\b(?:src|href)\s*=\s*["']([^"']+)["']|^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm;
  for (const m of text.matchAll(re)) {
    let raw = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").split("#")[0]!.split("?")[0]!;
    try {
      raw = decodeURIComponent(raw);
    } catch {
      /* keep as written */
    }
    if (!raw || raw === "/" || raw.endsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) continue;
    // Root-absolute links resolve from the course root.
    const dir = raw.startsWith("/") ? [] : fromPath.split("/").slice(0, -1);
    for (const seg of raw.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") dir.pop();
      else dir.push(seg);
    }
    out.add(dir.join("/"));
  }
  return [...out];
}
