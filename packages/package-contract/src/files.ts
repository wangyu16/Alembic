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
/** Attributes whose value is a link the browser may follow or fetch. */
const LINK_ATTRS = new Set(["href", "src", "action", "formaction", "values", "from", "to", "by"]);

/** Decode the XML character references a browser would decode in an attribute value. */
function decodeRefs(v: string): string {
  return v
    .replace(/&#x([0-9a-f]{1,6});?/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d{1,7});?/g, (_, d: string) => safeChar(Number(d)))
    .replace(/&(lt|gt|quot|apos|amp);/g, (_, n: string) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[n]!);
}
const safeChar = (n: number) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "�");

/** What a link-like value really points at: entities decoded, whitespace and control characters gone, lower case. */
const linkOf = (v: string) => decodeRefs(v).replace(/[\u0000- \u007f-\u009f]+/g, "").replace(/\\/g, "/").toLowerCase();

/**
 * CSS problems (a style attribute, a <style> element, or a presentation attribute holding url()). A backslash is
 * refused outright: CSS escapes (`@\69mport`, `u\72l(`) are the way past any keyword check, and figures don't need them.
 */
function cssProblems(css: string): string[] {
  const c = decodeRefs(css).toLowerCase();
  const out: string[] = [];
  if (c.includes("\\")) out.push("its styles contain escapes");
  if (/@import/.test(c)) out.push("it imports outside styles");
  if (/expression\s*\(|javascript:|behaviou?r\s*:|-moz-binding/.test(c)) out.push("it contains a script");
  if (/image-set\s*\(|(?:^|[^-\w])image\s*\(/.test(c)) out.push("it refers to something outside the course");
  for (const m of c.matchAll(/url\(\s*["']?([^"')]*)/g)) if (!m[1]!.trim().startsWith("#")) out.push("it refers to something outside the course");
  return out;
}

/**
 * Problems that make an SVG unsafe to serve or publish (contract v3 §11.4); empty = safe.
 *
 * One left-to-right pass over the text, the way an XML reader sees it (foundations audit r2: regexes missed tags
 * whose prefix starts with a non-ASCII letter, and backtracked for hours on crafted input). Linear time. Every
 * element and end tag is checked against an allowlist of local names (a prefix can't disguise `script`); comments
 * and CDATA are skipped as XML skips them; processing instructions other than the opening `<?xml …?>`, entity and
 * attribute-list declarations, and an internal DOCTYPE subset are refused; attribute values are decoded before
 * their links are checked, and any url() must point inside the figure.
 */
export function svgProblems(text: string): string[] {
  const out = new Set<string>();
  const n = text.length;
  let i = 0;
  let sawRoot = false;
  let inStyle = false;
  let styleText = "";
  const fail = (why: string) => { out.add(why); };
  const isSpace = (c: string) => c === " " || c === "\n" || c === "\r" || c === "\t";
  while (i < n) {
    const lt = text.indexOf("<", i);
    if (lt < 0) { if (inStyle) styleText += text.slice(i); break; }
    if (inStyle) styleText += text.slice(i, lt);
    i = lt;
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      if (end < 0) { fail("it isn't well formed"); break; }
      i = end + 3;
      continue;
    }
    if (text.startsWith("<![CDATA[", i)) {
      const end = text.indexOf("]]>", i + 9);
      if (end < 0) { fail("it isn't well formed"); break; }
      if (inStyle) styleText += text.slice(i + 9, end);
      i = end + 3;
      continue;
    }
    if (text.startsWith("<?", i)) {
      const end = text.indexOf("?>", i + 2);
      if (end < 0) { fail("it isn't well formed"); break; }
      // Only the XML declaration, and only before anything else.
      if (!(/^<\?xml[\s?]/.test(text.slice(i, i + 6)) && !sawRoot && text.slice(0, i).trim() === "")) fail("it has a processing instruction");
      i = end + 2;
      continue;
    }
    if (text.startsWith("<!", i)) {
      const end = text.indexOf(">", i + 2);
      if (end < 0) { fail("it isn't well formed"); break; }
      const decl = text.slice(i, end + 1);
      if (/^<!DOCTYPE\s+svg\b/i.test(decl) && !decl.includes("[") && !sawRoot) { i = end + 1; continue; }
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
    if (!name) { fail("it isn't well formed"); i = j; continue; }
    const local = name.slice(name.lastIndexOf(":") + 1).toLowerCase();
    if (!SVG_ELEMENTS.has(local)) {
      fail(local === "script" ? "it contains a script" : local === "foreignobject" ? "it embeds other content" : /^(animate|animatemotion|animatetransform|set)$/.test(local) ? "it animates a link" : `it contains a <${local}> element`);
    }
    if (!closing && !sawRoot) {
      sawRoot = true;
      if (local !== "svg") fail("it isn't an SVG picture");
    }
    // Attributes, until ">" (quoted values may hold ">").
    let ended = false;
    while (j < n) {
      const c = text[j]!;
      if (isSpace(c) || c === "/") { j++; continue; }
      if (c === ">") { ended = true; j++; break; }
      if (c === "<") break; // a new tag before this one ended: malformed (checked below)
      const aStart = j;
      while (j < n && !isSpace(text[j]!) && text[j] !== "=" && text[j] !== ">" && text[j] !== "/" && text[j] !== "<") j++;
      const aName = text.slice(aStart, j).toLowerCase();
      while (j < n && isSpace(text[j]!)) j++;
      let value = "";
      if (text[j] === "=") {
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
      if (!aName || aName === "xmlns" || aName.startsWith("xmlns:")) continue;
      const attr = aName.slice(aName.lastIndexOf(":") + 1);
      if (attr.startsWith("on")) { fail("it has an event handler"); continue; }
      if (attr === "style" || /url\s*\(/i.test(value)) { for (const p of cssProblems(value)) fail(p); if (attr === "style") continue; }
      if (!LINK_ATTRS.has(attr)) continue;
      const link = linkOf(value);
      if (/(?:^|;)(?:javascript|vbscript):/.test(link)) fail("it links to a script");
      else if (link.startsWith("data:") && !/^data:image\/(?:png|jpeg|gif|webp)[;,]/.test(link)) fail("it links to embedded data");
      else if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//.test(link) || /^(?:https?|ftp|file):/.test(link)) fail("it refers to something outside the course");
    }
    if (!ended) { fail("it isn't well formed"); i = Math.max(j, i + 1); continue; }
    const selfClosing = text[j - 2] === "/";
    if (local === "style") {
      if (closing) { for (const p of cssProblems(styleText)) fail(p); inStyle = false; styleText = ""; }
      else if (!selfClosing) inStyle = true;
    }
    i = j;
  }
  if (!sawRoot) fail("it isn't an SVG picture");
  return [...out];
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
