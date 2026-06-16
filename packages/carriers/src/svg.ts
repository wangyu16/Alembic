// SVG carrier envelope.
//
// The source island is a single <metadata id="orz-carrier"> element injected as
// the FIRST CHILD of the root <svg> element, wrapping a CDATA section:
//
//   <metadata id="orz-carrier" data-orz-kind="K" data-orz-format="N"><![CDATA[SOURCE]]></metadata>
//
// A literal "]]>" inside SOURCE would prematurely close the CDATA section, so it
// is split across two CDATA sections on embed ("]]]]><![CDATA[>") and rejoined
// on extract. This keeps the SVG well-formed for any source bytes.
//
// PURE: regex/string manipulation only, no DOM, no XML parser (this must run in
// Node and the browser, and we must not pull a parser dependency).

import {
  ATTR_FORMAT,
  ATTR_KIND,
  CARRIER_ELEMENT_ID,
  CarrierError,
  LEGACY_SVG_METADATA_ID,
  type EmbedInput,
  type ExtractResult,
} from "./types";

/** Encode "]]>" so it cannot close the CDATA section prematurely. */
function encodeCdata(source: string): string {
  return source.split("]]>").join("]]]]><![CDATA[>");
}

/** Reverse of {@link encodeCdata}: a CDATA-split "]]>" is simply the raw text
 * with adjacent CDATA boundaries removed. Because we read the *concatenation*
 * of all CDATA sections inside the element, the split is undone for free. */

/**
 * Insert the carrier <metadata> element as the first child of the root <svg>.
 * We locate the root <svg> start tag and its closing ">", handling self-closing
 * roots (<svg ... />) by reopening them — a self-closing root cannot have a
 * child, so we never expect a renderable carrier to be self-closing, but we
 * stay robust.
 */
export function embedSvg(input: EmbedInput): string {
  const island =
    `<metadata id="${CARRIER_ELEMENT_ID}" ${ATTR_KIND}="${input.kind}" ` +
    `${ATTR_FORMAT}="${input.format}"><![CDATA[${encodeCdata(input.source)}]]></metadata>`;

  // Find the root <svg ...> opening tag (first "<svg" not in a comment is good
  // enough for trusted-editor output; we don't parse comments).
  const openMatch = /<svg\b[^>]*>/i.exec(input.rendered);
  if (!openMatch) {
    throw new CarrierError("embedSvg: no <svg> root element found in rendered output");
  }

  const tag = openMatch[0];
  const insertAt = openMatch.index + tag.length;

  // Self-closing root (<svg ... />): convert to <svg ...></svg> so the island
  // can be a child. Detect by a trailing "/>" on the matched tag.
  if (/\/>\s*$/.test(tag)) {
    const reopened = tag.replace(/\/>\s*$/, ">");
    const before = input.rendered.slice(0, openMatch.index);
    const after = input.rendered.slice(openMatch.index + tag.length);
    return `${before}${reopened}${island}</svg>${after}`;
  }

  return input.rendered.slice(0, insertAt) + island + input.rendered.slice(insertAt);
}

/** Read all CDATA bodies inside a metadata element body and concatenate them.
 * Concatenation transparently rejoins a "]]>" that embed split across two
 * sections. */
function readCdata(elementBody: string): string {
  const parts: string[] = [];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(elementBody)) !== null) {
    parts.push(m[1] ?? "");
  }
  return parts.join("");
}

/**
 * Extract the source from an SVG carrier.
 * - Current format: <metadata id="orz-carrier" ...> with kind/format attributes.
 * - Legacy format 0: <metadata id="orz-chart-meta"> ... CDATA ... </metadata>
 *   (the old orz-plot extension). Kind defaults to "plot", format 0.
 * Returns null if no recognizable island is present (caller decides whether to
 * throw or fall through to HTML).
 */
export function extractSvg(file: string): ExtractResult | null {
  // Current carrier metadata element.
  const current = matchMetadataById(file, CARRIER_ELEMENT_ID);
  if (current) {
    const kind = readAttr(current.openTag, ATTR_KIND) ?? "";
    const formatRaw = readAttr(current.openTag, ATTR_FORMAT);
    const format = formatRaw !== null ? Number.parseInt(formatRaw, 10) : 0;
    return {
      kind,
      format: Number.isFinite(format) ? format : 0,
      source: readCdata(current.body),
    };
  }

  // Legacy orz-plot metadata (format 0).
  const legacy = matchMetadataById(file, LEGACY_SVG_METADATA_ID);
  if (legacy) {
    return { kind: "plot", format: 0, source: readCdata(legacy.body) };
  }

  return null;
}

/** Return the inner body + opening tag of the first <metadata> whose id matches. */
function matchMetadataById(
  file: string,
  id: string,
): { openTag: string; body: string } | null {
  // Match a <metadata ...> ... </metadata> whose attributes include id="<id>".
  const re = /<metadata\b([^>]*)>([\s\S]*?)<\/metadata>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(file)) !== null) {
    const attrs = m[1] ?? "";
    if (readAttr(attrs, "id") === id) {
      return { openTag: `<metadata${attrs}>`, body: m[2] ?? "" };
    }
  }
  return null;
}

/** Read a double- or single-quoted attribute value from a tag/attr string. */
function readAttr(tagOrAttrs: string, name: string): string | null {
  const re = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const m = re.exec(tagOrAttrs);
  if (!m) return null;
  return m[2] ?? m[3] ?? "";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Detect the carrier format version of an SVG file.
 * - current marker (data-orz-format present) → that integer (>= 1)
 * - a known island without the marker (orz-carrier metadata sans format, or the
 *   legacy orz-chart-meta metadata) → 0
 * - no island → null
 */
export function detectSvgVersion(file: string): number | null {
  const current = matchMetadataById(file, CARRIER_ELEMENT_ID);
  if (current) {
    const formatRaw = readAttr(current.openTag, ATTR_FORMAT);
    if (formatRaw !== null) {
      const n = Number.parseInt(formatRaw, 10);
      return Number.isFinite(n) ? n : 0;
    }
    return 0; // island present but no marker → legacy/format 0
  }
  if (matchMetadataById(file, LEGACY_SVG_METADATA_ID)) {
    return 0;
  }
  return null;
}
