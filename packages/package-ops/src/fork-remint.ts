/**
 * Identity re-mint for a whole-package fork (correctness loop r3, L3-3,
 * P5.B.1.z). Pure text operations — no markdown parser, no IO.
 *
 * A fork is a NEW course: every contract block id it copies gets a fresh id
 * (CLAUDE.md rule 7 — ids are never reused) and every embedded document uid a
 * fresh uid. References inside the copied files must then follow the ids of
 * the copy they point into. The rule:
 *
 *  1. **Definitions.** A contract block id is a `{{attrs[#blk-…]}}` marker
 *     (the canonical, well-formed form — `BLOCK_ID_PATTERN`) outside code in a
 *     `study-guide/`, `slides/` or `practice/` file (upload-contract H4).
 *     Each (file, id) pair gets its own fresh id: an id that two chapters
 *     share becomes two different ids, one per chapter, so the fork is valid
 *     across the whole course. `{#blk-…}` / `{#b-…}` heading attributes are not
 *     contract block ids and are left alone.
 *  2. **In the defining file**, every whole occurrence of the id outside code
 *     (heading marker, rendered `id="…"` anchor, `#blk-…` fragment) takes that
 *     file's new id.
 *  3. **Permalinks** `/d/doc-X#blk-…`: when doc-X is the uid of a copied file,
 *     the doc part takes that file's new uid and the fragment that file's new
 *     id for the block. A link to a document the fork does not copy (another
 *     course's) or a pinned `/d/doc-X@version…` link is left exactly as it was
 *     — it still names a real, unchanged document.
 *  4. **Relative links** `path/to/file.md.html#blk-…` resolve in the file they
 *     name (relative to the linking file); a URL or a path the fork does not
 *     copy is left alone.
 *  5. **Any other** `blk-…` / `#blk-…` (e.g. in a concept map or objectives
 *     file, or a chapter pointing at a block it does not define) takes the new
 *     id from the FIRST file, in path order, that defines it.
 *  6. **Never inside code**: fenced blocks (``` / ~~~), inline code spans, and
 *     `<code>` / `<pre>` elements keep their text verbatim — an example of a
 *     marker is documentation, not an identity.
 */

import { BLOCK_ID_PATTERN, newDocId } from "@alembic/package-contract";
import { extractEmbeddedUid, remintEmbeddedUid } from "./document-registry";
import type { PackageFile } from "./store";

/** The spaces whose `{{attrs[#blk-…]}}` markers are contract block ids. */
export const BLOCK_ID_SPACES = ["study-guide/", "slides/", "practice/"] as const;

export function definesBlockIds(path: string): boolean {
  return BLOCK_ID_SPACES.some((p) => path.startsWith(p));
}

interface Span {
  start: number;
  end: number;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/**
 * The regions of `text` that are code: fenced blocks, single-line inline code
 * spans, and HTML `<code>`/`<pre>` elements. A fence also ends at a line that
 * closes a `<script>` island, so an unclosed fence inside a carrier's source
 * never swallows the rendered page after it. Sorted, may overlap.
 */
export function codeSpans(text: string): Span[] {
  const spans: Span[] = [];
  let offset = 0;
  let fence: { char: string; len: number; start: number } | null = null;
  for (const line of text.split("\n")) {
    const lineEnd = offset + line.length;
    if (fence) {
      const m = FENCE_OPEN.exec(line);
      const scriptEnd = line.indexOf("</script");
      if (m && m[1]![0] === fence.char && m[1]!.length >= fence.len) {
        spans.push({ start: fence.start, end: lineEnd });
        fence = null;
      } else if (scriptEnd !== -1) {
        spans.push({ start: fence.start, end: offset + scriptEnd });
        fence = null;
      }
    } else {
      const m = FENCE_OPEN.exec(line);
      if (m) {
        fence = { char: m[1]![0]!, len: m[1]!.length, start: offset };
      } else {
        // Inline code: a run of N backticks up to the next run of exactly N.
        const runs = [...line.matchAll(/`+/g)];
        for (let i = 0; i < runs.length; i++) {
          const open = runs[i]!;
          const close = runs.slice(i + 1).findIndex((r) => r[0].length === open[0].length);
          if (close === -1) continue;
          const end = runs[i + 1 + close]!;
          spans.push({ start: offset + open.index!, end: offset + end.index! + end[0].length });
          i = i + 1 + close;
        }
      }
    }
    offset = lineEnd + 1;
  }
  if (fence) spans.push({ start: fence.start, end: text.length });
  for (const m of text.matchAll(/<(code|pre)\b[^>]*>[\s\S]*?<\/\1\s*>/gi)) {
    spans.push({ start: m.index!, end: m.index! + m[0].length });
  }
  return spans.sort((a, b) => a.start - b.start);
}

function inSpans(spans: Span[], start: number, end: number): boolean {
  return spans.some((s) => start < s.end && end > s.start);
}

/** Code spans for a file: none for data files (JSON), where backticks are text. */
function spansFor(path: string, text: string): Span[] {
  return /\.json$/i.test(path) ? [] : codeSpans(text);
}

const MARKER_RE = /\{\{attrs\[#(blk-[a-z0-9]+)\]\}\}/g;

/** Contract block ids defined (outside code) in a file, in first-seen order. */
export function definedBlockIds(path: string, text: string): string[] {
  if (!definesBlockIds(path)) return [];
  const spans = spansFor(path, text);
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
 * One alternation, scanned left to right:
 *   1-3  a permalink `/d/doc-X[@ver][#blk-…]`
 *   4-5  a relative/absolute file link `…/file.md(.html)#blk-…`
 *   6    a bare block id
 */
const REF_RE =
  /\/d\/(doc-[0-9a-z]{1,64})(?![0-9a-z])(@[A-Za-z0-9._-]+)?(?:#(blk-[a-z0-9]{8,})(?![a-z0-9]))?|([^\s()[\]"'<>#{}|`]+?\.(?:md|html))#(blk-[a-z0-9]{8,})(?![a-z0-9])|(?<![A-Za-z0-9_-])(blk-[a-z0-9]{8,})(?![a-z0-9])/g;

function resolveRelative(from: string, link: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith("//")) return null; // a URL
  const parts = link.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const seg of link.replace(/^\/+/, "").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
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
  const defs = new Map<string, Map<string, string>>();
  const firstDef = new Map<string, string>();
  for (const f of ordered) {
    const ids = new Map<string, string>();
    for (const id of definedBlockIds(f.path, f.content)) {
      const fresh = mint();
      ids.set(id, fresh);
      if (!firstDef.has(id)) firstDef.set(id, fresh);
    }
    defs.set(f.path, ids);
  }

  // 2. Per-file uids (only where an embedded uid is actually re-minted).
  const uidOwner = new Map<string, string>(); // old uid → path
  const newUid = new Map<string, string>(); // path → new uid
  const withUid = new Map<string, string>(); // path → content with the new uid
  for (const f of ordered) {
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
    const spans = spansFor(path, text);
    return text.replace(REF_RE, (match: string, ...g: unknown[]) => {
      const index = g[g.length - 2] as number;
      if (inSpans(spans, index, index + match.length)) return match;
      const [docId, pin, docFrag, link, linkFrag, bare] = g as Array<string | undefined>;
      if (docId !== undefined) {
        const target = uidOwner.get(docId);
        if (!target || pin) return match; // another course's document, or a pinned version
        const uid = newUid.get(target)!;
        const frag = docFrag ? `#${defs.get(target)?.get(docFrag) ?? docFrag}` : "";
        return `/d/${uid}${frag}`;
      }
      if (link !== undefined && linkFrag !== undefined) {
        const target = resolveRelative(path, link);
        if (!target || !byPath.has(target)) return match;
        return `${link}#${defs.get(target)?.get(linkFrag) ?? linkFrag}`;
      }
      if (bare !== undefined) return own.get(bare) ?? firstDef.get(bare) ?? bare;
      return match;
    });
  };

  return {
    files: files.map((f) => {
      const content = rewrite(f.path, withUid.get(f.path) ?? f.content);
      return { repo: f.repo, path: f.path, content, ids: defs.get(f.path) ?? new Map() };
    }),
  };
}
