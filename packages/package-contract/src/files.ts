/**
 * Files that aren't text (package-contract-v3 §11): what kind a path is, and
 * whether its bytes really are that kind. Which kinds a project may hold is
 * the content profile's; these checks are Alembic's (FD-09). Pure.
 */
import { activeProfile, type MediaKind } from "./profile";

/** Largest file the web app takes in one upload (the host refuses bigger request bodies). */
export const MAX_UPLOAD_BYTES = 4_000_000;

/** Non-text kinds the profile doesn't allow (refused as files, never treated as text). */
const BINARY_EXTENSIONS = new Set(["pdf", "zip", "gz", "tar", "7z", "rar", "exe", "dll", "bin", "dmg", "iso", "mp3", "mp4", "mov", "avi", "wav", "ogg", "webm", "woff", "woff2", "ttf", "otf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "bmp", "tif", "tiff", "ico", "heic", "psd", "ai", "eps"]);

/** Text files the core stores as text (synced, merged by the version rule). */
const TEXT_EXTENSIONS = new Set(["md", "json", "cff", "txt", "yml", "yaml", "csv", "html", "css", "gitignore"]);

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
  const media = activeProfile.media[ext];
  if (media) return media;
  // Known non-text kinds a course can't hold; anything else is text (.bib, .tex, .xml…; round 1 audit L4).
  return BINARY_EXTENSIONS.has(ext) ? null : "text";
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
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&(lt|gt|quot|apos|amp);/g, (_, n: string) => ({ lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" })[n]!);
}

/** What a link-like value really points at: entities decoded, whitespace and control characters gone, lower case. */
const linkOf = (v: string) => decodeRefs(v).replace(/[\u0000- \u007f-\u009f]+/g, "").replace(/\\/g, "/").toLowerCase();

function cssProblems(css: string): string[] {
  const c = decodeRefs(css).replace(/\\/g, "").toLowerCase();
  const out: string[] = [];
  if (/@import/.test(c)) out.push("it imports outside styles");
  if (/expression\s*\(|javascript:|behaviou?r\s*:/.test(c)) out.push("it contains a script");
  for (const m of c.matchAll(/url\(\s*["']?([^"')]*)/g)) if (!m[1]!.startsWith("#")) out.push("it refers to something outside the course");
  return out;
}

/**
 * Problems that make an SVG unsafe to serve or publish (contract v3 §11.4); empty = safe. An allowlist over every
 * tag in the text — comments and CDATA included, so nothing can hide a tag — on local names, so a namespace prefix
 * can't disguise one; link values are checked after decoding entities and dropping whitespace. Checked against
 * 128 real course figures and a set of known payloads (G-foundations audit r1 H1).
 */
export function svgProblems(text: string): string[] {
  const out = new Set<string>();
  if (!/^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE\s+svg\b[^>[]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:[\w.-]+:)?svg[\s>/]/i.test(text)) out.add("it isn't an SVG picture");
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text)) out.add("it declares its own entities");
  for (const m of text.matchAll(/<\s*\/?\s*([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const local = m[1]!.split(":").pop()!.toLowerCase();
    if (!SVG_ELEMENTS.has(local)) {
      out.add(local === "script" ? "it contains a script" : local === "foreignobject" ? "it embeds other content" : /^(animate|animatemotion|animatetransform|set)$/.test(local) ? "it animates a link" : `it contains a <${local}> element`);
      continue;
    }
    for (const a of m[2]!.matchAll(/([^\s=/"']+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g)) {
      const name = a[1]!.toLowerCase();
      const attr = name.split(":").pop()!;
      const value = a[2]!.replace(/^["']|["']$/g, "");
      if (name === "xmlns" || name.startsWith("xmlns:")) continue;
      if (attr.startsWith("on")) { out.add("it has an event handler"); continue; }
      if (attr === "style") { for (const p of cssProblems(value)) out.add(p); continue; }
      if (!LINK_ATTRS.has(attr)) continue;
      const link = linkOf(value);
      if (/^(?:javascript|vbscript):/.test(link) || /(?:^|;)\s*(?:javascript|vbscript):/.test(link)) out.add("it links to a script");
      else if (/^data:/.test(link) && !/^data:image\/(?:png|jpeg|gif|webp)[;,]/.test(link)) out.add("it links to embedded data");
      else if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//.test(link) || /^(?:https?|ftp|file):/.test(link)) out.add("it refers to something outside the course");
    }
  }
  // Style sheets inside <style>: no imports, no outside URLs, no scripts.
  for (const m of text.matchAll(/<\s*(?:[\w.-]+:)?style\b[^>]*>([\s\S]*?)<\s*\/\s*(?:[\w.-]+:)?style\s*>/gi)) for (const p of cssProblems(m[1]!)) out.add(p);
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
