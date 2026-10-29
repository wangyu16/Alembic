/**
 * Files that aren't text (package-contract-v3 §11): what kind a path is, and
 * whether its bytes really are that kind. Which kinds a project may hold is
 * the content profile's; these checks are Alembic's (FD-09). Pure.
 */
import { activeProfile, type MediaKind } from "./profile";

/** Largest file the web app takes in one upload (the host refuses bigger request bodies). */
export const MAX_UPLOAD_BYTES = 4_000_000;

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

/** Problems that make an SVG unsafe to serve or publish (§11.4); empty = safe. */
export function svgProblems(text: string): string[] {
  const out: string[] = [];
  const body = text.replace(/<!--[\s\S]*?-->/g, "");
  if (!/^\s*(?:<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(body)) out.push("it isn't an SVG picture");
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) out.push("it declares a document type");
  if (/<script[\s>/]/i.test(body)) out.push("it contains a script");
  if (/<foreignObject[\s>/]/i.test(body)) out.push("it embeds other content");
  if (/\son[a-z]+\s*=/i.test(body)) out.push("it has an event handler");
  if (/(?:href|src)\s*=\s*["']?\s*(?:javascript|data|vbscript):/i.test(body)) out.push("it links to a script or embedded data");
  if (/(?:href|src)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(body) || /url\(\s*["']?\s*(?:https?:)?\/\//i.test(body)) out.push("it refers to something outside the course");
  return out;
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
