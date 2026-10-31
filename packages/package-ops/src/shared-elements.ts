/**
 * Shared elements (docs/specs/v3/element-sharing-v3.md): what of a page can be
 * shared (its figures, its sections that have a block id), a section's text by
 * its id, and whether a shared element is available (on the course website
 * now). Pure.
 */
import { fileKind, isPage } from "@alembic/package-contract";
import { relativeLinks } from "./publisher";

export interface Shareable {
  kind: "figure" | "section";
  /** The figure's path, or the page's path for a section. */
  path: string;
  /** A section's block id. */
  anchor?: string;
  title: string;
}

const HEADING = /^(#{2,3})\s+(.*?)\s*\{\{attrs\[#(blk-[a-z0-9-]{1,60})\]\}\}\s*$/;

/** The page's figures (images it shows from the course) and its sections whose heading has a block id. */
export function shareablesOf(pagePath: string, text: string): Shareable[] {
  const out: Shareable[] = [];
  const seen = new Set<string>();
  for (const target of relativeLinks(pagePath, text)) {
    const kind = fileKind(target);
    if (!kind || kind === "text" || seen.has(target)) continue;
    seen.add(target);
    out.push({ kind: "figure", path: target, title: target.split("/").pop()! });
  }
  let fence: string | null = null;
  for (const line of text.split("\n")) {
    const f = /^(```|~~~)/.exec(line);
    if (f) fence = fence === null ? f[1]! : line.startsWith(fence) ? null : fence;
    if (fence !== null) continue;
    const h = HEADING.exec(line);
    if (h) out.push({ kind: "section", path: pagePath, anchor: h[3]!, title: h[2]!.replace(/[*_`]/g, "").slice(0, 200) || h[3]! });
  }
  return out;
}

/** A section's Markdown by its block id: its heading line up to the next heading of the same or a higher level. */
export function sectionText(text: string, anchor: string): string | null {
  const lines = text.split("\n");
  let start = -1;
  let level = 0;
  let fence: string | null = null;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k]!;
    const f = /^(```|~~~)/.exec(line);
    if (f) fence = fence === null ? f[1]! : line.startsWith(fence) ? null : fence;
    if (fence !== null && start < 0) continue;
    const h = /^(#{1,6})\s/.exec(line);
    if (start < 0) {
      const m = HEADING.exec(line);
      if (m && m[3] === anchor) { start = k; level = m[1]!.length; }
      continue;
    }
    if (fence === null && h && h[1]!.length <= level) return lines.slice(start, k).join("\n").trimEnd() + "\n";
  }
  return start < 0 ? null : lines.slice(start).join("\n").trimEnd() + "\n";
}

/**
 * Is a shared element available (K1.28)? Only while it is on the course website: the figure, or the page, is among
 * the published files, and a section's id is in the published text. Stopped sharing is never available.
 */
export function elementAvailable(e: { kind: "figure" | "section"; path: string; anchor: string | null; stoppedAt: string | null },
  publishedPaths: ReadonlySet<string>, publishedText?: string | null): boolean {
  if (e.stoppedAt) return false;
  if (!publishedPaths.has(e.path)) return false;
  if (e.kind === "figure") return fileKind(e.path) !== null && fileKind(e.path) !== "text";
  return isPage(e.path) && !!e.anchor && typeof publishedText === "string" && sectionText(publishedText, e.anchor) !== null;
}

/** A new element id: `el-` and 12 base36 characters. */
export function newElementId(random: () => number = Math.random): string {
  let s = "";
  for (let k = 0; k < 12; k++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36)]!;
  return `el-${s}`;
}
