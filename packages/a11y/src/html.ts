// Tiny HTML text helpers used by the accessibility rules.
//
// IMPORTANT: this is NOT a markdown parser and NOT a full HTML parser. It is a
// set of targeted string utilities that operate on already-rendered HTML. We
// only need to (a) strip nested tags to recover visible text and (b) decode a
// handful of common entities so educator-facing snippets read naturally.

/** Decode the few HTML entities that commonly appear in rendered prose. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Ampersand must be decoded last so we don't turn "&amp;lt;" into "<".
    .replace(/&amp;/g, "&");
}

/**
 * Recover the visible text of an HTML fragment: remove all tags, collapse
 * whitespace, and decode common entities. Returns a trimmed string.
 */
export function visibleText(innerHtml: string): string {
  const withoutTags = innerHtml.replace(/<[^>]*>/g, "");
  const decoded = decodeEntities(withoutTags);
  return decoded.replace(/\s+/g, " ").trim();
}

/**
 * Read the value of a given attribute from a single tag's source text.
 * Tolerant of single/double quotes, unquoted values, and attribute order.
 * Returns `undefined` if the attribute is absent.
 *
 * `tag` should be the raw tag text WITHOUT the surrounding angle brackets is
 * fine too — we only look at attribute syntax.
 */
export function getAttr(tag: string, name: string): string | undefined {
  // Double- or single-quoted value.
  const quoted = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const q = quoted.exec(tag);
  if (q) {
    // Group 2 = double-quoted body, group 3 = single-quoted body.
    return q[2] !== undefined ? q[2] : (q[3] ?? "");
  }
  // Unquoted value (e.g. <img src=x>): stop at whitespace or tag end.
  const unquoted = new RegExp(`\\b${name}\\s*=\\s*([^\\s"'>]+)`, "i");
  const u = unquoted.exec(tag);
  if (u) return u[1] ?? "";
  // Present as a bare boolean attribute (e.g. `hidden`)?
  const bare = new RegExp(`\\b${name}\\b(?![\\w-])`, "i");
  if (bare.test(tag)) return "";
  return undefined;
}

/** True if the attribute is present at all (regardless of value). */
export function hasAttr(tag: string, name: string): boolean {
  return getAttr(tag, name) !== undefined;
}
