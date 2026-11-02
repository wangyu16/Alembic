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
  info?: string;
  attrs?: Array<[string, string]> | null;
}

/** An attribute that can run script or load a page (set through orz-markdown's `{{attrs[...]}}`; round 3 audit). */
const unsafeAttr = ([k, v]: [string, string]) =>
  /^on/i.test(k) || /^(srcdoc|formaction|xlink:href)$/i.test(k) || (/^(href|src|action|data)$/i.test(k) && /^\s*(javascript|vbscript|data):/i.test(v));

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

/**
 * Pieces outside the list, in document order, with the lines they sit on:
 * - raw HTML blocks and inline HTML (table cells included: their inline tokens carry no lines of their own, so the
 *   enclosing block's are used; round 3 audit);
 * - `{{attrs[...]}}` that set an attribute able to run script (`attrs`);
 * - a container's title holding markup (`::: spoil <img …>` renders its title raw: `title`).
 */
type Piece = { lines: [number, number]; html: string; block: boolean; kind?: "attrs" | "title" | "span" };
function unsafePieces(tokens: readonly MdToken[]): Piece[] {
  const out: Piece[] = [];
  let around: [number, number] | null = null;
  for (const t of tokens) {
    if (t.map) around = t.map; // the nearest earlier token with lines (a table row for its cells)
    const lines = t.map ?? around;
    if (t.type === "html_block" && t.map && !safeHtml(t.content)) out.push({ lines: t.map, html: t.content, block: true });
    if (t.attrs?.some(unsafeAttr) && lines) out.push({ lines, html: "{{attrs[", block: false, kind: "attrs" });
    if (/^container_.*_open$/.test(t.type) && /[<>]/.test(t.info ?? "") && t.map) out.push({ lines: [t.map[0], t.map[0] + 1], html: "", block: false, kind: "title" });
    if (t.type === "inline" && lines && t.children) {
      for (const c of t.children) {
        if (c.type === "html_inline" && !safeHtml(c.content)) out.push({ lines, html: c.content, block: false });
        if (c.attrs?.some(unsafeAttr)) out.push({ lines, html: "{{attrs[", block: false, kind: "attrs" });
        // {{span …}} / {{sp …}} bodies are rendered on their own, with raw HTML on (round 4 audit): any "<" there is text.
        if (c.type === "plugin_inline" && (c.info === "span" || c.info === "sp") && /</.test(c.content)) out.push({ lines, html: "", block: false, kind: "span" });
      }
    }
  }
  return out;
}

export type CleanText = { ok: true; text: string; escaped: number } | { ok: false; reason: string };

/**
 * The text as Publish writes it: every raw HTML piece outside the list turned
 * into text (its "<" written as "&lt;"). `parse` is orz-markdown's `md.parse`.
 */
/** Decode every character reference (numeric and the named ones that matter for addresses). */
function decodeRefs(v: string): string {
  return v.replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16) % 0x110000))
    .replace(/&#(\d+);?/g, (_m, d: string) => String.fromCodePoint(Number(d) % 0x110000))
    .replace(/&(colon|tab|newline|lpar|rpar|amp|quot|apos|lt|gt);/gi, (_m, n: string) => ({ colon: ":", tab: "\t", newline: "\n", lpar: "(", rpar: ")", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" } as Record<string, string>)[n.toLowerCase()]!);
}

/** Elements the course text never needs and that can load or run things (YouTube's own player is the one exception). */
const REFUSED_TAGS = new Set(["script", "iframe", "object", "embed", "base", "meta", "link", "form", "frame", "frameset", "applet", "portal"]);
const YOUTUBE = /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com)\/embed\//i;

/**
 * Markup in rendered HTML that can run script or load a page, as a browser would read it (round 4 audit): tags with
 * attributes split by spaces or "/", every character reference decoded, the constructs browsers re-read
 * (`<?`, `<![CDATA[`, `--!>`) refused outright. The backstop for constructs the token walk doesn't know.
 */
export function liveMarkup(html: string): string | null {
  if (/<\?|<!\[CDATA\[|--!>/i.test(html)) return "a processing instruction or CDATA";
  for (const m of html.matchAll(/<([a-z][a-z0-9-]*)([^>]*)>/gi)) {
    const tag = m[1]!.toLowerCase();
    const attrs = [...m[2]!.matchAll(/[\s\/]+([^\s=>\/"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?/g)].map((a) => [a[1]!.toLowerCase(), decodeRefs((a[2] ?? "").replace(/^["']|["']$/g, ""))] as const);
    if (tag === "script") {
      // orz-markdown's own data blocks only (never executable).
      if (attrs.some(([k, v]) => k === "type" && /^application\/(ld\+)?json$/i.test(v))) continue;
      return "<script>";
    }
    if (REFUSED_TAGS.has(tag) && !(tag === "iframe" && attrs.some(([k, v]) => k === "src" && YOUTUBE.test(v)))) return `<${tag}>`;
    for (const [name, value] of attrs) {
      const v = value.replace(/[\s\u0000-\u001f]+/g, "").toLowerCase();
      if (/^on/.test(name) || name === "srcdoc" || name === "formaction") return `<${tag} ${name}=…>`;
      if (/^(href|src|action|xlink:href|data|poster|background)$/.test(name) && /^(javascript|vbscript|data):/.test(v) && !(tag === "img" && /^data:image\/(png|jpe?g|gif|webp);/.test(v))) return `<${tag} ${name}="${v.slice(0, 20)}">`;
    }
  }
  return null;
}

export function cleanRawHtml(text: string, parse: (src: string) => MdToken[], render?: (src: string) => string): CleanText {
  const found = unsafePieces(parse(text));
  // The backstop (overnight round 3): what the renderer makes of the result must hold no tag that can run script.
  const backstop = (t: string, escaped: number): CleanText => {
    const live = render ? liveMarkup(render(t)) : null;
    return live ? { ok: false, reason: `it contains markup that could run on the website (${live})` } : { ok: true, text: t, escaped };
  };
  if (!found.length) return backstop(text, 0);
  const lines = text.split("\n");
  const cursor = new Map<number, number>(); // per first line: where the next inline search starts
  for (const p of found) {
    if (p.kind === "attrs") {
      // Every attribute block on those lines becomes text (`{{` written as entities).
      for (let k = p.lines[0]; k < p.lines[1]; k++) lines[k] = lines[k]!.split("{{attrs[").join("&#123;&#123;attrs[");
      continue;
    }
    if (p.kind === "span") {
      for (let k = p.lines[0]; k < p.lines[1]; k++) lines[k] = lines[k]!.replace(/\{\{(span|sp)\b[\s\S]*?\}\}/g, (m) => m.replace(/</g, "&lt;"));
      continue;
    }
    if (p.kind === "title") {
      lines[p.lines[0]] = lines[p.lines[0]]!.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/^(\s*:{3,})\s*&gt;/, "$1 >");
      continue;
    }
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
  return backstop(cleaned, found.length);
}
