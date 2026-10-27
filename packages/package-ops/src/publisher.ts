/**
 * Publisher v3, pure core (docs/specs/v3/publisher-v3.md §2–§3,
 * queue-and-jobs-v3.md §5): which unit each file belongs to, what each unit
 * decides, the assembled public tree, and the link check to a fixpoint.
 * IO (reading the pinned tree, the public commit, the site build) lives in
 * the Publish job; everything that decides what reaches students is here.
 */

import {
  assertPublishWritable,
  isProjectable,
  toPublicManifest,
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
  for (const dir of SLOT_DIRS) {
    const m = new RegExp(`^${dir}/([a-z0-9]+(?:-[a-z0-9]+)*)\\.(?:slides\\.)?md$`).exec(path);
    if (m && !(dir === "concepts" && m[1] === "course")) return m[1]!;
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

export interface DecideInput {
  units: string[]; // unit keys present at W (excluding none/orphan)
  findings: Finding[];
  /** Chapter slugs in Draft mode. */
  draft: ReadonlySet<string>;
  /** Chapter slugs whose course-plan parts are approved at W (after approve-and-publish). */
  approved: ReadonlySet<string>;
  /** Chapter slugs the publisher chose "publish anyway" for. */
  publishAnyway: ReadonlySet<string>;
}

export type Decision = { unit: string; result: "pass" | "kept"; why: string[] };

export function decideUnits(i: DecideInput): Map<string, Decision> {
  const out = new Map<string, Decision>();
  for (const unit of i.units) {
    const why: string[] = [];
    const fs = i.findings.filter((f) => f.unit === unit);
    const slug = unit.startsWith("chapter:") ? unit.slice("chapter:".length) : null;
    if (fs.some((f) => f.severity === "always")) why.push(...fs.filter((f) => f.severity === "always").map((f) => f.message));
    if (slug && i.draft.has(slug)) why.push("Draft chapter");
    if (slug && !i.approved.has(slug)) why.push("Course plan not approved");
    const defaults = fs.filter((f) => f.severity === "default");
    if (defaults.length && !(slug && i.publishAnyway.has(slug))) why.push(...defaults.map((f) => f.message));
    out.set(unit, { unit, result: why.length ? "kept" : "pass", why });
  }
  return out;
}

/* -------------------------------------------------------------------------- *
 * Assembly
 * -------------------------------------------------------------------------- */

export interface TreeFile {
  /** Existing blob id (reused), or text to write. */
  blobSha?: string;
  text?: string;
}

export interface AssembleInput {
  /** Every file at the pinned working version W (path → file). */
  working: ReadonlyMap<string, TreeFile>;
  /** The last published version of each public file (path → file + unit). */
  published: ReadonlyMap<string, TreeFile & { unit: string }>;
  decisions: ReadonlyMap<string, Decision>;
  manifest: WorkingManifestV3;
  everPublishedChapters: ReadonlySet<string>;
  /** Files Publish generates (`.alembic/…`, `provenance/coursewerk/…`), already computed. */
  generated?: ReadonlyMap<string, TreeFile>;
  /** Texts of kept units' published files (to keep only the deleted assets they still link to). */
  keptTexts?: ReadonlyMap<string, string>;
}

export interface AssembledTree {
  files: Map<string, TreeFile & { origin: "unit" | "generated"; unit: string }>;
  publishedChapters: Set<string>;
}

export function assemblePublicTree(i: AssembleInput): AssembledTree {
  const chapters = new Set(i.manifest.chapters.map((c) => c.slug));
  const files: AssembledTree["files"] = new Map();
  const pass = (unit: string) => i.decisions.get(unit)?.result === "pass";

  // Passing units at W.
  for (const [path, f] of i.working) {
    const u = unitOf(path, chapters, i.everPublishedChapters);
    if (u.kind === "none" || u.kind === "orphan") continue;
    const key = unitKey(u);
    if (u.kind === "chapter" && !chapters.has(u.slug)) continue; // removed chapter: handled below
    if (pass(key)) files.set(path, { ...f, origin: "unit", unit: key });
  }
  // Kept units: their last published files.
  for (const [path, f] of i.published) {
    if (files.has(path)) continue;
    const key = f.unit;
    if (key.startsWith("chapter:")) {
      const slug = key.slice("chapter:".length);
      if (!chapters.has(slug)) continue; // removed from the manifest: its public files go
      if (pass(key)) continue; // passing: W is authoritative (a file deleted at W stays deleted)
    } else if (key.startsWith("asset:")) {
      if (pass(key) && i.working.has(path)) continue;
      if (!i.working.has(path)) {
        // Deleted at W: kept only while a kept unit's published text still links to it (G3 H3).
        const usedByKept = [...(i.keptTexts ?? new Map<string, string>())].some(([from, text]) => relativeLinks(from, text).includes(path));
        if (!usedByKept) continue;
      }
    } else if (pass(key)) {
      continue;
    }
    files.set(path, { blobSha: f.blobSha, text: f.text, origin: "unit", unit: key });
  }
  const publishedChapters = new Set<string>();
  for (const f of files.values()) if (f.unit.startsWith("chapter:")) publishedChapters.add(f.unit.slice(8));

  // Generated: the public manifest and Publish's own files.
  const pub = toPublicManifest(i.manifest, publishedChapters);
  files.set("alembic.json", { text: JSON.stringify(pub, null, 2) + "\n", origin: "generated", unit: "course" });
  for (const [path, f] of i.generated ?? []) files.set(path, { ...f, origin: "generated", unit: "course" });

  // The public boundary, file by file (fail closed).
  for (const [path, f] of files) assertPublishWritable(path, f.origin);
  return { files, publishedChapters };
}

/* -------------------------------------------------------------------------- *
 * Link check (to a fixpoint)
 * -------------------------------------------------------------------------- */

/** Relative links and image/embed sources in Markdown text. */
export function relativeLinks(fromPath: string, text: string): string[] {
  const out = new Set<string>();
  // Inline links, images, src/href attributes (either quote), and reference definitions (G3 L1).
  const re = /\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|\b(?:src|href)\s*=\s*["']([^"']+)["']|^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm;
  for (const m of text.matchAll(re)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").split("#")[0]!.split("?")[0]!;
    if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) continue;
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

/**
 * Re-decide until stable: a passing chapter linking to a path absent from
 * the assembled tree gets a `default` finding (kept unless published
 * anyway). Decisions only move pass → kept, so this ends.
 */
export function publishWithLinkCheck(
  assembleIn: Omit<AssembleInput, "decisions">,
  decideIn: DecideInput,
): { tree: AssembledTree; decisions: Map<string, Decision>; rounds: number } {
  let findings = [...decideIn.findings];
  for (let round = 1; ; round++) {
    const decisions = decideUnits({ ...decideIn, findings });
    const tree = assemblePublicTree({ ...assembleIn, decisions });
    const added: Finding[] = [];
    for (const [path, f] of tree.files) {
      // Chapters and the course unit (course map) are link-checked (G3 L2).
      if (f.origin !== "unit" || f.text === undefined || !(f.unit.startsWith("chapter:") || f.unit === "course")) continue;
      if (decisions.get(f.unit)?.result !== "pass") continue;
      for (const target of relativeLinks(path, f.text)) {
        const missing = !tree.files.has(target);
        // A link to an asset kept at an older version than this chapter expects (G3 M4).
        const targetUnit = `asset:${target}`;
        const stale = !missing && target.startsWith("assets/") && decisions.get(targetUnit)?.result === "kept" &&
          assembleIn.working.has(target) && tree.files.get(target)?.text !== assembleIn.working.get(target)?.text;
        if ((missing || stale) && !findings.some((x) => x.unit === f.unit && x.check === "link" && x.path === target)) {
          added.push({ unit: f.unit, path: target, check: "link", severity: "default", message: missing ? `Links to ${target}, which is not published` : `Links to ${target}, which is published only in an older version` });
        }
      }
    }
    if (added.length === 0) return { tree, decisions, rounds: round };
    findings = [...findings, ...added];
    if (round > decideIn.units.length + 1) return { tree, decisions, rounds: round }; // cannot happen: monotone
  }
}
