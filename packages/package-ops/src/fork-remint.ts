/**
 * Identity re-mint for a whole-package fork (correctness loop r3, L3-3, and
 * loop r4, HIGH-2 / MEDIUM-6 / MEDIUM-7 — P5.B.1.z). Pure text operations —
 * no markdown library, no IO.
 *
 * A fork is a NEW course: every contract block id it copies gets a fresh id
 * (CLAUDE.md rule 7 — ids are never reused) and every embedded document uid a
 * fresh uid. References inside the copied files must then follow the ids of
 * the copy they point into. The rule:
 *
 *  0. **Only text files are read.** A file whose name is not a text type
 *     (`TEXT_FILE_RE`: images, PDFs, archives … — stored base64) is copied
 *     byte for byte and never scanned (loop r4, HIGH-2: scanning a base64
 *     photo took seconds per 40 KB).
 *  1. **Definitions.** A contract block id is a `{{attrs[#blk-…]}}` marker
 *     (the canonical, well-formed form — `BLOCK_ID_PATTERN`) outside code in a
 *     `study-guide/`, `slides/` or `practice/` file (upload-contract H4).
 *     Each (file, id) pair gets its own fresh id: an id that two chapters
 *     share becomes two different ids, one per chapter, so the fork is valid
 *     across the whole course. A marker on a line `parseStudyGuide` reads as
 *     a section heading is ALWAYS a definition, whatever else surrounds it, so
 *     no id the publish gate counts can survive a fork. `{#blk-…}` / `{#b-…}`
 *     heading attributes are not contract block ids and are left alone.
 *  2. **In the defining file**, every whole occurrence of the id outside code
 *     (heading marker, rendered `id="…"` anchor, `#blk-…` fragment) takes that
 *     file's new id.
 *  3. **Permalinks** `/d/doc-X#blk-…` (also with a trailing `/` or a `?…`
 *     query, which the permalink route ignores): when doc-X is the uid of a
 *     copied file, the doc part takes that file's new uid and the fragment that
 *     file's new id for the block. A link to a document the fork does not copy
 *     (another course's) or a pinned `/d/doc-X@version…` (or `%40version`)
 *     link is left exactly as it was — it still names a real, unchanged
 *     document.
 *  4. **File links** `path/to/file#blk-…` resolve in the file they name,
 *     relative to the linking file (a leading `/` = the course root), after
 *     URL-decoding and dropping any `?query`; a lean `.md` name also finds its
 *     `.md.html` carrier, and a name with no extension finds `.md`,
 *     `.md.html`, `.slides.html` or `.paged.html`, in that order. A URL or a
 *     path the fork does not copy is left alone.
 *  5. **Any other** `blk-…` / `#blk-…` (e.g. in a concept map or objectives
 *     file, or a chapter pointing at a block it does not define) takes the new
 *     id from the FIRST file, in path order, that defines it.
 *  6. **Never inside code.** In markdown — a `.md` file, or the source island
 *     of an HTML carrier — code is: fences as `parseStudyGuide` reads them
 *     (``` / ~~~ at column 0, closed by a line starting with the same three
 *     characters); fences inside list items and block quotes, and fences
 *     indented by 1–3 spaces; indented (4-space) code blocks; and inline code
 *     spans, which may run over several lines of one paragraph. In the HTML
 *     outside a carrier's source, code is `<code>` / `<pre>` elements (a
 *     `<code>` MENTIONED in markdown prose is not an element). Data files
 *     (JSON, CSV, …) have no code. A line `parseStudyGuide` reads as a section
 *     heading is never code (rule 1).
 *
 * Linear time: every pattern is anchored on a literal (`/d/doc-`, `blk-`,
 * `<code`, `<pre`, a backtick run), and a file link is read BACKWARD from its
 * `#blk-` fragment, so no scan restarts at every character (loop r4, HIGH-2:
 * the r3 link pattern was quadratic on long unbroken text — a 2 MB carrier
 * with an embedded image took 20 s).
 *
 * Deterministic: given the same minters, the same files produce the same
 * output in any input order (ids are minted in path order).
 */

import { BLOCK_ID_PATTERN, newDocId } from "@alembic/package-contract";
import { extractEmbeddedUid, remintEmbeddedUid } from "./document-registry";
import type { PackageFile } from "./store";

/** The spaces whose `{{attrs[#blk-…]}}` markers are contract block ids. */
export const BLOCK_ID_SPACES = ["study-guide/", "slides/", "practice/"] as const;

export function definesBlockIds(path: string): boolean {
  return BLOCK_ID_SPACES.some((p) => path.startsWith(p));
}

/** Files a fork reads (text types). Everything else is copied untouched. */
export const TEXT_FILE_RE =
  /\.(?:md|markdown|txt|csv|tsv|json|jsonld|html?|svg|xml|ya?ml|cff|tex|bib)$/i;

export function isForkText(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  return TEXT_FILE_RE.test(base);
}

interface Span {
  start: number;
  end: number;
}

/* ── code regions ──────────────────────────────────────────────────────── */

/** The source-island ids an HTML carrier keeps its markdown in (carriers/html.ts). */
const SOURCE_ISLAND_IDS = new Set(["orz-carrier", "md-source", "orz-src", "orz-deck"]);

export interface OpenTag {
  /** Offset of the `<`. */
  index: number;
  /** Offset just past the tag's `>`. */
  end: number;
  /** The tag name as written. */
  tag: string;
}

const SCRIPT_OPEN = /<(script)\b/gi;
const CODE_OPEN = /<(code|pre)\b/gi;

/**
 * The next open tag `<name …>` at or after `from` — what `/<(name)\b[^>]*>/gi`
 * matches, without its rescans (round 5, P5.B.1.ad): that pattern scanned to
 * the end of the file for every tag left without a `>`, so 120 KB of
 * `<code ` took seconds. When no `>` follows a tag, no later tag can close
 * either, so the scan stops.
 */
function nextOpenTag(text: string, open: RegExp, from: number): OpenTag | null {
  open.lastIndex = from;
  const m = open.exec(text);
  if (m === null) return null;
  const gt = text.indexOf(">", m.index + m[0].length);
  if (gt === -1) return null;
  return { index: m.index, end: gt + 1, tag: m[1]! };
}

/** Every open tag of the given names, left to right (for tests). */
export function openTags(text: string, names: readonly string[], from = 0): OpenTag[] {
  const open = new RegExp(`<(${names.join("|")})\\b`, "gi");
  const out: OpenTag[] = [];
  let m: OpenTag | null;
  while ((m = nextOpenTag(text, open, from)) !== null) {
    out.push(m);
    from = m.end;
  }
  return out;
}

/** [start, end) of each markdown source island body in an HTML file. */
function sourceIslands(text: string, lower: string): Span[] {
  const out: Span[] = [];
  let from = 0;
  let m: OpenTag | null;
  while ((m = nextOpenTag(text, SCRIPT_OPEN, from)) !== null) {
    const bodyStart = m.end;
    const close = lower.indexOf("</script", bodyStart);
    const id = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(text.slice(m.index + 1 + m.tag.length, m.end - 1));
    const end = close === -1 ? text.length : close;
    if (id && SOURCE_ISLAND_IDS.has(id[1] ?? id[2] ?? "")) out.push({ start: bodyStart, end });
    if (close === -1) break;
    from = end;
  }
  return out;
}

/**
 * `<code>…</code>` / `<pre>…</pre>` elements of HTML between `from` and `to`
 * (skipping `holes` — the markdown islands). An element with no closing tag
 * is not code. Linear: each tag kind remembers where its next closing tag is.
 */
function htmlCodeSpans(text: string, lower: string, from: number, to: number, holes: Span[]): Span[] {
  const out: Span[] = [];
  let at = from;
  const nextClose = new Map<string, number>();
  let m: OpenTag | null;
  while ((m = nextOpenTag(text, CODE_OPEN, at)) !== null && m.index < to) {
    at = m.end;
    if (holes.some((h) => m!.index >= h.start && m!.index < h.end)) {
      const hole = holes.find((h) => m!.index >= h.start && m!.index < h.end)!;
      at = hole.end;
      continue;
    }
    const tag = m.tag.toLowerCase();
    const after = m.end;
    let close = nextClose.get(tag);
    if (close === undefined || (close !== -1 && close < after)) {
      close = lower.indexOf(`</${tag}`, after);
      nextClose.set(tag, close);
    }
    if (close === -1) continue;
    const gt = text.indexOf(">", close);
    const end = gt === -1 ? text.length : gt + 1;
    out.push({ start: m.index, end });
    at = end;
  }
  return out;
}

const PARSER_FENCE = /^(```|~~~)/; // parseStudyGuide's FENCE_RE
const PARSER_H2 = /^##\s/; // parseStudyGuide's H2_RE
const LIST_ITEM = /^[ \t]{0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const ATX_OR_BREAK = /^(?:#{1,6}(?:[ \t]|$)|(?:-[ \t]*){3,}$|(?:\*[ \t]*){3,}$|(?:_[ \t]*){3,}$)/;

function indentWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (ch === " ") w++;
    else if (ch === "\t") w += 4 - (w % 4);
    else break;
  }
  return w;
}

export interface ContainerFence {
  /** The block-quote markers before the fence, with their spacing. */
  quotes: string;
  /** Spaces and tabs after the quote markers. */
  lead: string;
  /** A list marker with the spacing after it, when there is one. */
  marker: string | undefined;
  /** The run of backticks or tildes. */
  fence: string;
  /** The rest of the line (the info string). */
  info: string;
}

const QUOTE_MARKER = /[ \t]{0,3}>[ \t]?/y;
const isBlank = (c: string | undefined) => c === " " || c === "\t";
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

/**
 * A fence opening inside block quotes and/or a list item — what the round-4
 * pattern
 *   /^((?:[ \t]{0,3}>[ \t]?)*)([ \t]*)((?:[-*+]|\d{1,9}[.)])[ \t]+)?([ \t]*)(`{3,}|~{3,})(.*)$/
 * matched, read by one left-to-right scan (round 5, P5.B.1.ad). The pattern's
 * nested and adjacent quantifiers backtracked exponentially on a line of
 * quote markers and quadratically on a run of spaces; every step here is
 * decided by the next character, so the scan is linear. Quote markers are
 * taken greedily like `stripQuotes`; the pattern's second space run was
 * always empty (the first takes every space), so it is not kept.
 */
export function matchContainerFence(line: string): ContainerFence | null {
  let i = 0;
  for (;;) {
    QUOTE_MARKER.lastIndex = i;
    if (!QUOTE_MARKER.test(line)) break;
    i = QUOTE_MARKER.lastIndex;
  }
  let j = i;
  while (isBlank(line[j])) j++;
  let f = j; // where the fence starts
  let marker: string | undefined;
  let k = j; // past a list marker's bullet or number
  if (line[j] === "-" || line[j] === "*" || line[j] === "+") k = j + 1;
  else if (isDigit(line[j])) {
    let d = j;
    while (isDigit(line[d])) d++;
    if (d - j <= 9 && (line[d] === "." || line[d] === ")")) k = d + 1;
  }
  if (k > j) {
    let w = k;
    while (isBlank(line[w])) w++;
    if (w === k) return null; // a bullet with no space is not a marker, and not a fence
    marker = line.slice(j, w);
    f = w;
  }
  const ch = line[f];
  if (ch !== "`" && ch !== "~") return null;
  let e = f;
  while (line[e] === ch) e++;
  if (e - f < 3) return null;
  const info = line.slice(e);
  if (/[\n\r\u2028\u2029]/.test(info)) return null; // the pattern's `.` stopped there
  return { quotes: line.slice(0, i), lead: line.slice(i, j), marker, fence: line.slice(f, e), info };
}

/** Strip up to `depth` block-quote markers; null when the line has fewer. */
function stripQuotes(line: string, depth: number): string | null {
  let rest = line;
  for (let i = 0; i < depth; i++) {
    const m = /^[ \t]{0,3}>[ \t]?/.exec(rest);
    if (!m) return null;
    rest = rest.slice(m[0].length);
  }
  return rest;
}

/**
 * Inline code spans in one paragraph [`from`, `to`): a run of N backticks up
 * to the next run of exactly N (CommonMark), across the paragraph's lines.
 * Linear: per run length, a cursor into that length's runs.
 */
function inlineCodeSpans(text: string, from: number, to: number, out: Span[]): void {
  const runs: Array<{ pos: number; len: number }> = [];
  const re = /`+/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && m.index < to) {
    let pos = m.index;
    let len = Math.min(m[0].length, to - m.index);
    // An opener preceded by a backslash: its first backtick is literal.
    let bs = 0;
    for (let k = pos - 1; k >= from && text[k] === "\\"; k--) bs++;
    if (bs % 2 === 1) {
      pos++;
      len--;
    }
    if (len > 0) runs.push({ pos, len });
  }
  if (runs.length < 2) return;
  const byLen = new Map<number, number[]>();
  runs.forEach((r, i) => {
    const list = byLen.get(r.len) ?? [];
    list.push(i);
    byLen.set(r.len, list);
  });
  const cursor = new Map<number, number>();
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i]!;
    const list = byLen.get(r.len)!;
    let c = cursor.get(r.len) ?? 0;
    while (c < list.length && list[c]! <= i) c++;
    cursor.set(r.len, c);
    if (c >= list.length) continue; // unmatched: literal backticks
    const j = list[c]!;
    out.push({ start: r.pos, end: runs[j]!.pos + r.len });
    i = j;
  }
}

/**
 * Code regions of markdown text between `from` and `to` (rule 6). Lines
 * `parseStudyGuide` reads as section headings are never inside one.
 */
export function markdownCodeSpans(text: string, from = 0, to = text.length): Span[] {
  const out: Span[] = [];
  let parserFence: { fence: string; start: number } | null = null;
  let fence: { char: string; len: number; indent: number; quotes: number; start: number } | null = null;
  let indented: { start: number; lastEnd: number } | null = null;
  let para: { start: number; end: number } | null = null;
  let prevBlank = true;
  let inList = false;
  let prevEnd = from;

  const flushPara = () => {
    if (para) inlineCodeSpans(text, para.start, para.end, out);
    para = null;
  };
  const endFence = () => {
    if (fence) out.push({ start: fence.start, end: prevEnd });
    fence = null;
  };
  const endIndented = () => {
    if (indented) out.push({ start: indented.start, end: indented.lastEnd });
    indented = null;
  };

  let lineStart = from;
  while (lineStart <= to) {
    let nl = text.indexOf("\n", lineStart);
    if (nl === -1 || nl > to) nl = to;
    const lineEnd = nl;
    const line = text.slice(lineStart, lineEnd);
    const next = lineEnd + 1;

    // parseStudyGuide's own fences (authoritative at column 0).
    if (parserFence) {
      if (line.startsWith(parserFence.fence)) {
        out.push({ start: parserFence.start, end: lineEnd });
        parserFence = null;
      }
      prevEnd = lineEnd;
      lineStart = next;
      if (lineEnd >= to) break;
      continue;
    }
    const pf = PARSER_FENCE.exec(line);
    if (pf) {
      endFence();
      endIndented();
      flushPara();
      parserFence = { fence: pf[1]!, start: lineStart };
      prevBlank = false;
      prevEnd = lineEnd;
      lineStart = next;
      if (lineEnd >= to) break;
      continue;
    }
    // A section heading to the parser is never code, whatever surrounds it.
    if (PARSER_H2.test(line)) {
      endFence();
      endIndented();
      flushPara();
      inList = false;
      prevBlank = false;
      prevEnd = lineEnd;
      lineStart = next;
      if (lineEnd >= to) break;
      continue;
    }

    let handled = false;
    if (fence) {
      const f = fence as { char: string; len: number; indent: number; quotes: number; start: number };
      const content = stripQuotes(line, f.quotes);
      if (content === null || (content.trim() !== "" && indentWidth(content) < f.indent)) {
        endFence(); // the container ended: the fence closes with it
      } else {
        const t = content.trim();
        if (t.length >= f.len && t[0] === f.char && /^(`+|~+)$/.test(t)) {
          out.push({ start: f.start, end: lineEnd });
          fence = null;
        }
        handled = true;
      }
    }
    if (!handled && indented) {
      const ind = indented as { start: number; lastEnd: number };
      if (line.trim() === "") handled = true;
      else if (indentWidth(line) >= 4) {
        ind.lastEnd = lineEnd;
        handled = true;
      } else endIndented();
    }
    if (!handled) {
      const blank = line.trim() === "";
      if (blank) {
        flushPara();
        prevBlank = true;
      } else {
        const cf = line.includes("```") || line.includes("~~~") ? matchContainerFence(line) : null;
        const quotes = cf ? (cf.quotes.match(/>/g) ?? []).length : 0;
        const marker = cf?.marker;
        const lead = cf ? indentWidth(cf.lead) : 0;
        const isFence =
          cf !== null &&
          !(cf.fence[0] === "`" && cf.info.includes("`")) &&
          (quotes > 0 || marker !== undefined || lead <= 3 || inList);
        if (isFence) {
          flushPara();
          const indent = marker !== undefined ? lead + marker.length : quotes === 0 && !inList ? 0 : lead;
          fence = { char: cf!.fence[0]!, len: cf!.fence.length, indent, quotes, start: lineStart };
          if (marker !== undefined) inList = true;
        } else if (!inList && prevBlank && indentWidth(line) >= 4) {
          flushPara();
          indented = { start: lineStart, lastEnd: lineEnd };
        } else {
          if (LIST_ITEM.test(line)) {
            inList = true;
            flushPara(); // a new list item is a new paragraph
          } else if (indentWidth(line) === 0 && (prevBlank || ATX_OR_BREAK.test(line))) inList = false;
          if (ATX_OR_BREAK.test(line.trimStart())) {
            flushPara();
            inlineCodeSpans(text, lineStart, lineEnd, out);
          } else if (para) (para as { start: number; end: number }).end = lineEnd;
          else para = { start: lineStart, end: lineEnd };
        }
        prevBlank = false;
      }
    }
    prevEnd = lineEnd;
    lineStart = next;
    if (lineEnd >= to) break;
  }
  if (parserFence) out.push({ start: (parserFence as { start: number }).start, end: to });
  endFence();
  endIndented();
  flushPara();
  return out;
}

/**
 * The regions of a file that are code (rule 6), sorted and merged. `.md` /
 * `.markdown` is markdown; an HTML/SVG file is HTML whose carrier source
 * islands are markdown; data files have none.
 */
export function codeSpans(text: string, path = "x.md"): Span[] {
  let spans: Span[];
  if (/\.(?:md|markdown)$/i.test(path)) spans = markdownCodeSpans(text);
  else if (/\.(?:html?|svg|xml)$/i.test(path)) {
    const lower = text.toLowerCase();
    const islands = sourceIslands(text, lower);
    spans = htmlCodeSpans(text, lower, 0, text.length, islands);
    for (const i of islands) spans.push(...markdownCodeSpans(text, i.start, i.end));
  } else spans = [];
  spans.sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}

/** Does [start, end) overlap a code span? Binary search over merged spans. */
function inSpans(spans: Span[], start: number, end: number): boolean {
  let lo = 0;
  let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = spans[mid]!;
    if (s.end <= start) lo = mid + 1;
    else if (s.start >= end) hi = mid - 1;
    else return true;
  }
  return false;
}

const MARKER_RE = /\{\{attrs\[#(blk-[a-z0-9]+)\]\}\}/g;

/** Contract block ids defined (outside code) in a file, in first-seen order. */
export function definedBlockIds(path: string, text: string, spans = codeSpans(text, path)): string[] {
  if (!definesBlockIds(path) || !isForkText(path)) return [];
  const out: string[] = [];
  for (const m of text.matchAll(MARKER_RE)) {
    const id = m[1]!;
    if (!BLOCK_ID_PATTERN.test(id) || out.includes(id)) continue;
    if (inSpans(spans, m.index!, m.index! + m[0].length)) continue;
    out.push(id);
  }
  return out;
}

/**
 * One alternation, scanned left to right, each branch anchored on a literal:
 *   1-5  a permalink `/d/doc-X[@ver|%40ver][/][?query][#blk-…]`
 *   6    a bare block id (a `#blk-…` fragment is read backward for its file)
 */
const REF_RE =
  /\/d\/(doc-[0-9a-z]{1,64})(?![0-9a-z])((?:@|%40)[A-Za-z0-9._~%-]+)?(\/)?(\?[^\s#"'<>()[\]{}|`\\]*)?(?:#(blk-[a-z0-9]{8,})(?![a-z0-9]))?|(?<![A-Za-z0-9_-])(blk-[a-z0-9]{8,})(?![a-z0-9])/g;

/** Characters a file link can contain (read backward from its `#`). */
const LINK_CHAR = /[^\s()[\]"'<>#{}|`\\]/;
const MAX_LINK = 2048;

function resolveRelative(from: string, link: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith("//")) return null; // a URL
  let decoded: string;
  try {
    decoded = decodeURIComponent(link.split("?")[0]!);
  } catch {
    return null;
  }
  const parts = decoded.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const seg of decoded.replace(/^\/+/, "").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

/** The copied file a resolved link names (lean `.md` → its carrier; no extension). */
function findCopied(target: string, byPath: Map<string, PackageFile>): string | null {
  if (byPath.has(target)) return target;
  const base = target.split("/").pop() ?? "";
  const candidates = target.endsWith(".md")
    ? [`${target}.html`]
    : base.includes(".")
      ? []
      : [".md", ".md.html", ".slides.html", ".paged.html"].map((e) => target + e);
  return candidates.find((c) => byPath.has(c)) ?? null;
}

export interface RemintedFile extends PackageFile {
  /** old id → new id for the ids this file defines. */
  ids: Map<string, string>;
}

export interface RemintResult {
  files: RemintedFile[];
}

/**
 * Re-mint ids and uids across a fork's copied files (rules above). `files`
 * are the copied public files in any order; the output keeps that order.
 */
export function remintForkIdentities(
  files: PackageFile[],
  mint: () => string,
  mintDocId: () => string = newDocId,
): RemintResult {
  // 1. Per-file definitions, in path order (rule 5's "first file").
  const byPath = new Map(files.map((f) => [f.path, f]));
  const ordered = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const spansOf = new Map<string, Span[]>();
  const defs = new Map<string, Map<string, string>>();
  const firstDef = new Map<string, string>();
  for (const f of ordered) {
    const ids = new Map<string, string>();
    if (isForkText(f.path)) {
      const spans = codeSpans(f.content, f.path);
      spansOf.set(f.path, spans);
      for (const id of definedBlockIds(f.path, f.content, spans)) {
        const fresh = mint();
        ids.set(id, fresh);
        if (!firstDef.has(id)) firstDef.set(id, fresh);
      }
    }
    defs.set(f.path, ids);
  }

  // 2. Per-file uids (only where an embedded uid is actually re-minted).
  const uidOwner = new Map<string, string>(); // old uid → path
  const newUid = new Map<string, string>(); // path → new uid
  const withUid = new Map<string, string>(); // path → content with the new uid
  for (const f of ordered) {
    if (!isForkText(f.path)) continue;
    const old = extractEmbeddedUid(f.content);
    if (!old) continue;
    const fresh = mintDocId();
    const out = remintEmbeddedUid(f.content, fresh);
    if (out === f.content) continue;
    withUid.set(f.path, out);
    newUid.set(f.path, fresh);
    if (!uidOwner.has(old)) uidOwner.set(old, f.path);
  }

  // 3. Rewrite references, outside code.
  const rewrite = (path: string, text: string): string => {
    const own = defs.get(path) ?? new Map<string, string>();
    // The uid re-mint may change lengths: recompute spans on the new text.
    const spans = withUid.has(path) ? codeSpans(text, path) : (spansOf.get(path) ?? []);
    const idIn = (file: string, id: string) => defs.get(file)?.get(id) ?? id;
    return text.replace(REF_RE, (match: string, ...g: unknown[]) => {
      const index = g[g.length - 2] as number;
      if (inSpans(spans, index, index + match.length)) return match;
      const [docId, pin, slash, query, docFrag, bare] = g as Array<string | undefined>;
      if (docId !== undefined) {
        const target = uidOwner.get(docId);
        if (!target || pin) return match; // another course's document, or a pinned version
        const frag = docFrag ? `#${idIn(target, docFrag)}` : "";
        return `/d/${newUid.get(target)!}${slash ?? ""}${query ?? ""}${frag}`;
      }
      if (bare === undefined) return match;
      if (index > 0 && text[index - 1] === "#") {
        // A fragment: read its file link backward (bounded).
        let s = index - 1;
        while (s > 0 && index - 1 - s < MAX_LINK && LINK_CHAR.test(text[s - 1]!)) s--;
        const link = text.slice(s, index - 1);
        if (link !== "") {
          const resolved = resolveRelative(path, link);
          const target = resolved === null ? null : findCopied(resolved, byPath);
          // A URL, or a file the fork does not copy: left alone.
          return target === null ? match : idIn(target, bare);
        }
      }
      return own.get(bare) ?? firstDef.get(bare) ?? bare;
    });
  };

  return {
    files: files.map((f) => {
      if (!isForkText(f.path)) return { repo: f.repo, path: f.path, content: f.content, ids: new Map() };
      const content = rewrite(f.path, withUid.get(f.path) ?? f.content);
      return { repo: f.repo, path: f.path, content, ids: defs.get(f.path) ?? new Map() };
    }),
  };
}
