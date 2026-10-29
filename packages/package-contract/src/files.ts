/**
 * Files that aren't text (package-contract-v3 §11): what kind a path is, and
 * whether its bytes really are that kind. Which kinds a project may hold is
 * the content profile's; these checks are Alembic's (FD-09). Pure.
 */
import { activeProfile, type MediaKind } from "./profile";

/** Largest file the web app takes in one upload (the host refuses bigger request bodies). */
export const MAX_UPLOAD_BYTES = 4_000_000;

/** Text files the core stores as text (synced, merged by the version rule). */
// An explicit list (foundations audit r2: "unknown = text" let .xhtml/.xml/.js through, which run scripts on Pages).
// Plain HTML is a later, deliberate addition (FD-10), not a default.
const TEXT_EXTENSIONS = new Set(["md", "json", "cff", "txt", "yml", "yaml", "csv", "bib", "tex", "gitignore"]);

/**
 * `"text"`, a media kind the profile allows, or null (not allowed). Editor-made
 * SVGs (`.ketcher.svg`, `.plot.svg`) are text, written by their editors, but
 * are checked as SVG like any other.
 */
export function fileKind(path: string): "text" | MediaKind | null {
  const name = path.split("/").pop() ?? "";
  if (/\.(ketcher|plot)\.svg$/i.test(name)) return "text";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : name.toLowerCase();
  if (TEXT_EXTENSIONS.has(ext) || name === "LICENSE") return "text";
  return activeProfile.media[ext] ?? null;
}

/** True when the path is an SVG of any origin (uploaded or editor-made): never merged, always checked. */
export const isSvgPath = (path: string): boolean => /\.svg$/i.test(path);

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);

/** Valid UTF-8 with no NUL: what "text" means for bytes (§11.4). */
export function isTextBytes(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** SVG elements a figure may use (local names, whatever their namespace prefix: `<x:script>` is still `script`). */
const SVG_ELEMENTS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "textpath",
  "defs", "use", "symbol", "clippath", "mask", "pattern", "lineargradient", "radialgradient", "stop", "image",
  "title", "desc", "metadata", "style", "marker", "filter", "switch",
  "feblend", "fecolormatrix", "fecomponenttransfer", "fecomposite", "feconvolvematrix", "fediffuselighting",
  "fedisplacementmap", "fedistantlight", "fedropshadow", "feflood", "fefunca", "fefuncb", "fefuncg", "fefuncr",
  "fegaussianblur", "femerge", "femergenode", "femorphology", "feoffset", "fepointlight", "fespecularlighting",
  "fespotlight", "fetile", "feturbulence",
  // Metadata drawing tools write (RDF/Dublin Core/Creative Commons, Inkscape): never rendered.
  "rdf", "work", "agent", "type", "format", "date", "creator", "description", "li", "bag", "seq", "alt", "rights",
  "license", "permits", "requires", "prohibits", "publisher", "contributor", "language", "subject", "source",
  "relation", "coverage", "identifier", "namedview", "guide", "grid", "perspective", "path-effect", "page",
]);
/** The XML declaration: version, encoding and standalone only, plain values. */
const STD_XMLDECL = /<\?xml(?:[ \t\r\n]+(?:version|encoding|standalone)[ \t\r\n]*=[ \t\r\n]*(?:"[\w.:-]*"|'[\w.:-]*'))*[ \t\r\n]*\?>/y;
/** The DOCTYPE forms drawing tools write: `<!DOCTYPE svg>` or `PUBLIC "id" "dtd"`, ids with no markup characters. */
const STD_DOCTYPE = /<!DOCTYPE[ \t\r\n]+svg(?:[ \t\r\n]+PUBLIC[ \t\r\n]+"[^"<>\[\]]*"[ \t\r\n]+"[^"<>\[\]]*")?[ \t\r\n]*>/iy;

/** Attributes whose value is a link the browser may follow or fetch. */
const LINK_ATTRS = new Set(["href", "src", "action", "formaction", "values", "from", "to", "by"]);

/** Decode the XML character references a browser would decode in an attribute value. */
function decodeRefs(v: string): string {
  return v
    // Any number of digits (XML allows leading zeros: &#00000106; is "j"; audit r3 MEDIUM-1).
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => safeChar(Number(d)))
    .replace(/&(lt|gt|quot|apos|amp);/g, (_, n: string) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[n]!);
}
// A reference too large to be a character decodes to a mark the checks refuse.
const safeChar = (n: number) => (Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "\u0000BADREF");

/** What a link-like value really points at: entities decoded, whitespace and control characters gone, lower case. */
const linkOf = (v: string) => decodeRefs(v).replace(/[\u0000- \u007f-\u009f]+/g, "").replace(/\\/g, "/").toLowerCase();

/**
 * CSS problems (a style attribute, a <style> element, or a presentation attribute holding url()). A backslash is
 * refused outright: CSS escapes (`@\69mport`, `u\72l(`) are the way past any keyword check, and figures don't need them.
 */
function cssProblems(css: string): string[] {
  const c = decodeRefs(css).toLowerCase();
  const out: string[] = [];
  if (c.includes("badref")) out.push("it has a malformed character reference");
  if (c.includes("\\")) out.push("its styles contain escapes");
  if (/@import/.test(c)) out.push("it imports outside styles");
  if (/expression\s*\(|javascript:|behaviou?r\s*:|-moz-binding/.test(c)) out.push("it contains a script");
  if (/image-set\s*\(|(?:^|[^-\w])image\s*\(/.test(c)) out.push("it refers to something outside the course");
  for (const m of c.matchAll(/url\(\s*["']?([^"')]*)/g)) if (!m[1]!.trim().startsWith("#")) out.push("it refers to something outside the course");
  return out;
}

/**
 * Problems that make an SVG unsafe to serve or publish (contract v3 §11.4); empty = safe. See `readSvg`.
 */
export function svgProblems(text: string): string[] {
  return readSvg(text).problems;
}

/**
 * The SVG as Publish writes it (contract v3 §11.4, foundations loop round 4): rebuilt from what the check read —
 * allowlisted elements and attributes only, every value re-escaped, comments and declarations dropped — so a
 * browser reads exactly what the check read and no disagreement between them can carry anything through.
 * Null when the SVG isn't safe.
 */
export function cleanSvg(text: string): string | null {
  const r = readSvg(text);
  return r.problems.length ? null : r.svg;
}

/** Both at once (one read): the problems, and the clean copy when there are none. */
export function checkSvg(text: string): { problems: string[]; svg: string | null } {
  const r = readSvg(text);
  return { problems: r.problems, svg: r.problems.length ? null : r.svg };
}

const NAME = /^[A-Za-z_][\w.:-]*$/;
const escText = (t: string) => t.replace(/&(?!(?:#\d+|#x[0-9a-fA-F]+|lt|gt|amp|quot|apos);)/g, "&amp;").replace(/>/g, "&gt;");
const escAttr = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * One left-to-right pass over the text, the way an XML reader sees it (foundations audit r2: regexes missed tags
 * whose prefix starts with a non-ASCII letter, and backtracked for hours on crafted input). Linear time. Every
 * element and end tag is checked against an allowlist of local names (a prefix can't disguise `script`); comments
 * and CDATA are read as XML reads them; only the standard XML declaration and DOCTYPE forms are accepted, matched
 * in full; attribute values are decoded before their links are checked, and any url() must point inside the
 * figure. Alongside, it writes the clean copy `cleanSvg` returns.
 */
function readSvg(text: string): { problems: string[]; svg: string } {
  const out = new Set<string>();
  const parts: string[] = [];
  const n = text.length;
  const lead = text.search(/\S/); // where the document starts: the only place for <?xml …?> (computed once: audit r3 HIGH-2)
  let styleDepth = 0;
  let i = 0;
  let sawRoot = false;
  let rootClosed = false;
  const stack: string[] = []; // open elements: the clean copy is always well formed (audit r5 L1)
  let inStyle = false;
  let styleText = "";
  const fail = (why: string) => { out.add(why); };
  const isSpace = (c: string) => c === " " || c === "\n" || c === "\r" || c === "\t";
  const textRun = (t: string) => {
    if (inStyle) styleText += t;
    if (!t.trim()) { if (sawRoot && !rootClosed) parts.push(t); return; }
    if (!sawRoot || rootClosed) { fail("it has text outside the picture"); return; }
    if (decodeRefs(t).includes("BADREF") || /&#0*;|&#x0*;|&#0+(?!\d)/i.test(t)) { fail("it has a malformed character reference"); return; }
    parts.push(escText(t));
  };
  while (i < n) {
    const lt = text.indexOf("<", i);
    if (lt < 0) { textRun(text.slice(i)); break; }
    textRun(text.slice(i, lt));
    i = lt;
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      if (end < 0) { fail("it isn't well formed"); break; }
      i = end + 3; // comments are dropped from the clean copy
      continue;
    }
    if (text.startsWith("<![CDATA[", i)) {
      const end = text.indexOf("]]>", i + 9);
      if (end < 0) { fail("it isn't well formed"); break; }
      const inner = text.slice(i + 9, end);
      if (!sawRoot || rootClosed) fail("it has text outside the picture");
      if (inStyle) styleText += inner;
      parts.push(inner.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
      i = end + 3;
      continue;
    }
    if (text.startsWith("<?", i)) {
      const end = text.indexOf("?>", i + 2);
      if (end < 0) { fail("it isn't well formed"); break; }
      // Only the XML declaration, before anything else, and only in its standard form, matched in full (a quote
      // can't move where it ends; audit r4).
      STD_XMLDECL.lastIndex = i;
      const decl = i === lead ? STD_XMLDECL.exec(text) : null;
      if (!decl) { fail("it has a processing instruction"); i = end + 2; continue; }
      i += decl[0].length;
      continue;
    }
    if (text.startsWith("<!", i)) {
      const end = text.indexOf(">", i + 2);
      if (end < 0) { fail("it isn't well formed"); break; }
      // Only the standard forms, matched in full (audit r4 HIGH-A: a ">" inside a quoted id ended the declaration
      // early, so the check and a browser disagreed about where a comment began, hiding a script).
      STD_DOCTYPE.lastIndex = i;
      const std = STD_DOCTYPE.exec(text);
      if (std && !sawRoot) { i += std[0].length; continue; }
      const decl = text.slice(i, end + 1);
      fail(/^<!(ENTITY|ATTLIST|ELEMENT)/i.test(decl) || decl.includes("[") ? "it declares its own entities" : "it has a declaration a picture doesn't need");
      i = end + 1;
      continue;
    }
    // A tag: <name …> or </name>. The name runs to whitespace, "/" or ">".
    let j = i + 1;
    const closing = text[j] === "/";
    if (closing) j++;
    const nameStart = j;
    while (j < n && !isSpace(text[j]!) && text[j] !== "/" && text[j] !== ">" && text[j] !== "<") j++;
    const name = text.slice(nameStart, j);
    if (!name || !NAME.test(name)) { fail("it isn't well formed"); i = Math.max(j, i + 1); continue; }
    const local = name.slice(name.lastIndexOf(":") + 1).toLowerCase();
    if (!SVG_ELEMENTS.has(local)) {
      fail(local === "script" ? "it contains a script" : local === "foreignobject" ? "it embeds other content" : /^(animate|animatemotion|animatetransform|set)$/.test(local) ? "it animates a link" : `it contains a <${local}> element`);
    }
    if (!closing && rootClosed) fail("it has more than one picture in it");
    if (!closing && !sawRoot) {
      sawRoot = true;
      if (local !== "svg") fail("it isn't an SVG picture");
    }
    // Attributes, until ">" (quoted values may hold ">").
    const attrs: string[] = [];
    const seen = new Set<string>();
    let ended = false;
    while (j < n) {
      const c = text[j]!;
      if (isSpace(c) || c === "/") { j++; continue; }
      if (c === ">") { ended = true; j++; break; }
      if (c === "<") break; // a new tag before this one ended: malformed (checked below)
      const aStart = j;
      while (j < n && !isSpace(text[j]!) && text[j] !== "=" && text[j] !== ">" && text[j] !== "/" && text[j] !== "<") j++;
      const aRaw = text.slice(aStart, j);
      const aName = aRaw.toLowerCase();
      while (j < n && isSpace(text[j]!)) j++;
      let value = "";
      let hasValue = false;
      if (text[j] === "=") {
        hasValue = true;
        j++;
        while (j < n && isSpace(text[j]!)) j++;
        const q = text[j];
        if (q === '"' || q === "'") {
          const end = text.indexOf(q, j + 1);
          if (end < 0) { j = n; break; }
          value = text.slice(j + 1, end);
          j = end + 1;
        } else {
          const vStart = j;
          while (j < n && !isSpace(text[j]!) && text[j] !== ">" && text[j] !== "<") j++;
          value = text.slice(vStart, j);
        }
      }
      if (!aRaw || !NAME.test(aRaw) || !hasValue) { fail("it isn't well formed"); continue; }
      if (seen.has(aRaw)) { fail("it isn't well formed"); continue; }
      seen.add(aRaw);
      const decoded = decodeRefs(value);
      if (decoded.includes("BADREF")) { fail("it has a malformed character reference"); continue; }
      if (aName === "xmlns" || aName.startsWith("xmlns:")) { attrs.push(` ${aRaw}="${escAttr(decoded)}"`); continue; }
      const attr = aName.slice(aName.lastIndexOf(":") + 1);
      if (attr.startsWith("on")) { fail("it has an event handler"); continue; }
      // Decoded first: u&#114;l( is url( to a browser (audit r3 MEDIUM-1).
      // Every value, not only those that read "url(": a CSS escape spells url( in fill, mask, filter… (audit r5 M2).
      for (const p of cssProblems(value)) fail(p);
      if (LINK_ATTRS.has(attr)) {
        const link = linkOf(value);
        if (/(?:^|;)(?:javascript|vbscript):/.test(link)) fail("it links to a script");
        else if (link.startsWith("data:") && !/^data:image\/(?:png|jpeg|gif|webp)[;,]/.test(link)) fail("it links to embedded data");
        else if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//.test(link) || /^(?:https?|ftp|file):/.test(link)) fail("it refers to something outside the course");
      }
      attrs.push(` ${aRaw}="${escAttr(decoded)}"`);
    }
    if (!ended) { fail("it isn't well formed"); i = Math.max(j, i + 1); continue; }
    const selfClosing = !closing && text[j - 2] === "/";
    if (closing && attrs.length) fail("it isn't well formed");
    if (closing) {
      if (stack.pop() !== name) fail("it isn't well formed");
      if (stack.length === 0) rootClosed = true;
    } else if (!selfClosing) stack.push(name);
    else if (stack.length === 0) rootClosed = true;
    parts.push(closing ? `</${name}>` : `<${name}${attrs.join("")}${selfClosing ? "/>" : ">"}`);
    if (local === "style") {
      // No style inside a style (audit r3 MEDIUM-1: an inner close used to end the check early).
      if (closing) { styleDepth--; if (styleDepth <= 0) { styleDepth = 0; for (const p of cssProblems(styleText)) fail(p); inStyle = false; styleText = ""; } }
      else if (!selfClosing) { if (inStyle) fail("it nests styles"); styleDepth++; inStyle = true; }
    }
    i = j;
  }
  if (!sawRoot) fail("it isn't an SVG picture");
  if (stack.length) fail("it isn't well formed");
  return { problems: [...out], svg: `<?xml version="1.0" encoding="UTF-8"?>\n${parts.join("").trim()}\n` };
}

/** Problems with bytes declared as `kind` (§11.4); empty = they are what they claim. */
export function mediaProblems(kind: MediaKind, bytes: Uint8Array): string[] {
  switch (kind) {
    case "png": return starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? [] : ["it isn't a PNG picture"];
    case "jpeg": return starts(bytes, [0xff, 0xd8, 0xff]) ? [] : ["it isn't a JPEG picture"];
    case "gif": return starts(bytes, [0x47, 0x49, 0x46, 0x38]) ? [] : ["it isn't a GIF picture"];
    case "webp": return starts(bytes, [0x52, 0x49, 0x46, 0x46]) && starts(bytes, [0x57, 0x45, 0x42, 0x50], 8) ? [] : ["it isn't a WebP picture"];
    case "svg": return isTextBytes(bytes) ? svgProblems(new TextDecoder().decode(bytes)) : ["it isn't an SVG picture"];
  }
}
