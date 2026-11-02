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

/* -------------------------------------------------------------------------- *
 * Step 2: using an element in one's own course; giving a section an address
 * -------------------------------------------------------------------------- */

/** A path from one course file to another (both relative to the course root), as a page links to it. */
export function relativePath(fromFile: string, to: string): string {
  const from = fromFile.split("/").slice(0, -1);
  const target = to.split("/");
  let k = 0;
  while (k < from.length && k < target.length - 1 && from[k] === target[k]) k++;
  return [...from.slice(k).map(() => ".."), ...target.slice(k)].join("/") || to;
}

/** Relative link and image targets in Markdown, made absolute against the page they came from (the source website). */
export function absolutizeMarkdown(md: string, pageUrl: string): string {
  return md.replace(/(\]\()(?![a-z][a-z0-9+.-]*:|#|\/)([^)\s]+)((?:\s+"[^"]*")?\))/gi, (_m, open: string, target: string, close: string) => {
    try { return `${open}${new URL(target.replace(/\.md$/i, ".md.html"), pageUrl).href}${close}`; } catch { return `${open}${target}${close}`; }
  });
}

export interface ElementCredit { title: string; course: string; authors: string | null; licence: string; pageUrl: string }

/** The credit line that travels with a used element (element-sharing-v3 §3): the source, its authors and licence. */
export function creditLine(c: ElementCredit): string {
  const clean = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/[[\]]/g, "").trim();
  return `*From “${clean(c.title)}” in [${clean(c.course)}](${c.pageUrl})${c.authors ? ` by ${clean(c.authors)}` : ""}, ${clean(c.licence) || "licence as stated there"}.*`;
}

/**
 * What using an element appends to a page of one's own course: a figure shown from where it was copied to, or a
 * section's text (its block ids removed — ids are never reused across courses, FC-02 — and its links pointed at the
 * source website), then the credit line.
 */
export function usedElementText(u: { kind: "figure" | "section"; pagePath: string; credit: ElementCredit; figurePath?: string; sectionMd?: string }): string {
  if (u.kind === "figure") {
    const alt = u.credit.title.replace(/[[\]\r\n]+/g, " ").trim();
    return `\n\n![${alt}](${relativePath(u.pagePath, u.figurePath!)})\n\n${creditLine(u.credit)}\n`;
  }
  const body = absolutizeMarkdown((u.sectionMd ?? "").replace(/\s*\{\{attrs\[[^\]]*\]\}\}/g, ""), u.credit.pageUrl).trimEnd();
  return `\n\n${body}\n\n${creditLine(u.credit)}\n`;
}

/** Headings of a page (levels 2–3) that have no block id yet, outside code: those a person can give an address. */
export function headingsWithoutId(text: string): Array<{ line: number; title: string }> {
  const out: Array<{ line: number; title: string }> = [];
  let fence: string | null = null;
  text.split("\n").forEach((line, k) => {
    const f = /^(```|~~~)/.exec(line);
    if (f) fence = fence === null ? f[1]! : line.startsWith(fence) ? null : fence;
    if (fence !== null) return;
    const h = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (h && !/\{\{attrs\[/.test(line)) out.push({ line: k, title: h[2]!.replace(/[*_`]/g, "").slice(0, 200) });
  });
  return out;
}

/** The page with a block id added to the heading on `line` (only if that line is still such a heading), or null. */
export function addHeadingId(text: string, line: number, id: string): string | null {
  if (!/^blk-[a-z0-9]{8,40}$/.test(id)) return null;
  const lines = text.split("\n");
  if (!headingsWithoutId(text).some((h) => h.line === line)) return null;
  lines[line] = `${lines[line]!.trimEnd()}{{attrs[#${id}]}}`;
  return lines.join("\n");
}

/** A new block id (FC-02: `blk-` and base36, minted by the host). */
export function newBlockId(random: () => number = Math.random): string {
  let s = "";
  for (let k = 0; k < 10; k++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36)]!;
  return `blk-${s}`;
}
