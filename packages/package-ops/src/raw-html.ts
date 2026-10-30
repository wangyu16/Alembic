/**
 * Raw HTML in published course text (foundations round 5 H1, owner 2026-10-29):
 * orz-markdown renders an author's own raw HTML as it is, by family design
 * ("the author is trusted", FC-07/FC-19). In a shared workspace the person who
 * publishes didn't write every line, so Publish writes a clean copy of each
 * Markdown text: raw HTML outside a short list of harmless tags, with no
 * attributes, is turned into text (readers see it as written, it never runs).
 * The working copy is untouched.
 *
 * The HTML is found with orz-markdown's own parse (`parse`, the same version
 * the site renders with), so the cleaner and the renderer agree on what is HTML;
 * the cleaned text is parsed again and must hold nothing outside the list, or
 * the result is refused (fail closed). Pure.
 */

/** Tags a course text may use raw, with no attributes (GenChem uses only <br>). */
const SAFE_TAG = /^<\/?(?:br|sub|sup|b|i|em|strong|u|s|small|mark|kbd)\s*\/?>$/i;
/** An HTML comment a browser can't end early (slides use <!-- slide --> markers). */
const SAFE_COMMENT = /^<!--(?!-?>)[^<>]*?-->$/;

/** The token shape of markdown-it (orz-markdown's parser). */
export interface MdToken {
  type: string;
  content: string;
  map: [number, number] | null;
  children: MdToken[] | null;
}

/** Is this piece of raw HTML (one or more tags and comments) all on the list? */
function safeHtml(html: string): boolean {
  const pieces = html.trim().split(/(?=<)/).map((p) => p.trim()).filter(Boolean);
  if (!pieces.length) return true;
  return pieces.every((p) => {
    const tag = p.match(/^<[^>]*>/)?.[0];
    if (!tag) return false;
    const rest = p.slice(tag.length);
    if (/[<>]/.test(rest)) return false; // text after the tag must be plain
    return SAFE_TAG.test(tag) || (tag.startsWith("<!--") ? SAFE_COMMENT.test(p.trim()) : false);
  }) && !/<!--/.test(html.replace(/<!--(?!-?>)[^<>]*?-->/g, ""));
}

/** Raw HTML pieces outside the list, in document order, with the lines they sit on. */
function unsafePieces(tokens: readonly MdToken[]): Array<{ lines: [number, number]; html: string; block: boolean }> {
  const out: Array<{ lines: [number, number]; html: string; block: boolean }> = [];
  for (const t of tokens) {
    if (t.type === "html_block" && t.map && !safeHtml(t.content)) out.push({ lines: t.map, html: t.content, block: true });
    if (t.type === "inline" && t.map && t.children) {
      for (const c of t.children) if (c.type === "html_inline" && !safeHtml(c.content)) out.push({ lines: t.map, html: c.content, block: false });
    }
  }
  return out;
}

export type CleanText = { ok: true; text: string; escaped: number } | { ok: false; reason: string };

/**
 * The text as Publish writes it: every raw HTML piece outside the list turned
 * into text (its "<" written as "&lt;"). `parse` is orz-markdown's `md.parse`.
 */
export function cleanRawHtml(text: string, parse: (src: string) => MdToken[]): CleanText {
  const found = unsafePieces(parse(text));
  if (!found.length) return { ok: true, text, escaped: 0 };
  const lines = text.split("\n");
  const cursor = new Map<number, number>(); // per first line: where the next inline search starts
  for (const p of found) {
    if (p.block) {
      for (let k = p.lines[0]; k < p.lines[1]; k++) lines[k] = lines[k]!.replace(/</g, "&lt;");
      continue;
    }
    // Inline: find the piece in its paragraph's lines, after the previous one found there.
    const [a, b] = p.lines;
    const para = lines.slice(a, b).join("\n");
    const at = para.indexOf(p.html, cursor.get(a) ?? 0);
    if (at < 0) continue; // left for the re-parse below to refuse
    const fixed = para.slice(0, at) + "&lt;" + para.slice(at + 1);
    cursor.set(a, at + 4);
    lines.splice(a, b - a, ...fixed.split("\n"));
  }
  const cleaned = lines.join("\n");
  // Fail closed: the cleaned text, read again, must hold nothing outside the list.
  const left = unsafePieces(parse(cleaned));
  if (left.length) return { ok: false, reason: `it contains raw HTML that can't be published safely (${left[0]!.html.trim().slice(0, 60)})` };
  return { ok: true, text: cleaned, escaped: found.length };
}
