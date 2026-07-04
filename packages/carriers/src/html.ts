// HTML carrier envelope.
//
// The source island is a single <script> with a non-executable type, injected
// immediately before </body> (or appended if there is no </body>):
//
//   <script type="application/orz-carrier+json" id="orz-carrier"
//           data-orz-kind="K" data-orz-format="N">SOURCE</script>
//
// The non-executable `type` prevents the browser from running the source. To
// keep a literal "</script>" (or any "</...") in the source from breaking out of
// the script context — and to survive copy/paste — every "</" is escaped as
// "<\/" on embed and restored on extract.
//
// PURE: string manipulation only, no DOM, no HTML parser.

import {
  ATTR_FORMAT,
  ATTR_KIND,
  CARRIER_ELEMENT_ID,
  CarrierError,
  HTML_SCRIPT_TYPE,
  ORZ_SELF_DECK_ID,
  ORZ_SELF_SRC_ID,
  type EmbedInput,
  type ExtractResult,
} from "./types";

/** Escape "</" so the source cannot terminate the host <script> element. */
function escapeForScript(source: string): string {
  return source.split("</").join("<\\/");
}

/** Reverse of {@link escapeForScript} (the `orz-carrier` island). */
function unescapeFromScript(source: string): string {
  return source.split("<\\/").join("</");
}

/**
 * Reverse of the `</script>`-only escaping used by the legacy `md-source`
 * island AND the orz-family self-contained files (`orz-src` / `orz-deck`),
 * which escape only the dangerous `</script>` sequence, leaving other `</`
 * (e.g. `</div>`) raw. Restoring only `<\/script>` avoids corrupting a
 * literal backslash-slash in the source.
 */
function unescapeScriptOnly(source: string): string {
  return source.replace(/<\\\/script>/gi, "</script>");
}

export function embedHtml(input: EmbedInput): string {
  const island =
    `<script type="${HTML_SCRIPT_TYPE}" id="${CARRIER_ELEMENT_ID}" ` +
    `${ATTR_KIND}="${input.kind}" ${ATTR_FORMAT}="${input.format}">` +
    `${escapeForScript(input.source)}</script>`;

  // Inject before the LAST </body> (case-insensitive); else append.
  const re = /<\/body\s*>/gi;
  let lastMatch: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input.rendered)) !== null) {
    lastMatch = m;
  }
  if (lastMatch) {
    const at = lastMatch.index;
    return input.rendered.slice(0, at) + island + input.rendered.slice(at);
  }
  return input.rendered + island;
}

/** Read a double- or single-quoted attribute value from a tag string. */
function readAttr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${escapeRegExp(name)}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const mm = re.exec(tag);
  if (!mm) return null;
  return mm[2] ?? mm[3] ?? "";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Legacy `.md.html` island id (pre-carrier-codec); always read as format 0,
// kind "md", so files exported before the unification stay openable forever.
const LEGACY_MD_HTML_ID = "md-source";

/** Find a <script id="..."> opening tag + body. Because the source's
 * "</script>" is escaped to "<\/script>", the first literal "</script>" we hit
 * really is the island's closing tag. */
function matchScriptById(file: string, id: string): { openTag: string; body: string } | null {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(file)) !== null) {
    const attrs = m[1] ?? "";
    if (readAttr(attrs, "id") === id) {
      return { openTag: `<script${attrs}>`, body: m[2] ?? "" };
    }
  }
  return null;
}

/**
 * Extract the source from an HTML carrier. Tries, in order: the current
 * `orz-carrier` island (native, reverse-all unescape); the legacy `md-source`
 * island; and the orz-family self-contained files' own islands `orz-src`
 * (kind "md" — may be `.md.html` or `.paged.html`; the extension decides) and
 * `orz-deck` (kind "slides"). The latter three use `</script>`-only escaping.
 * Returns null if no island is present.
 */
export function extractHtml(file: string): ExtractResult | null {
  const current = matchScriptById(file, CARRIER_ELEMENT_ID);
  if (current) {
    const formatRaw = readAttr(current.openTag, ATTR_FORMAT);
    const format = formatRaw !== null ? Number.parseInt(formatRaw, 10) : 0;
    return {
      kind: readAttr(current.openTag, ATTR_KIND) ?? "",
      format: Number.isFinite(format) ? format : 0,
      source: unescapeFromScript(current.body),
    };
  }
  // Script-only-escaped islands: legacy Alembic (`md-source`) + the orz-family
  // self-contained files. Format 0 (they carry no `data-orz-format` marker).
  const scriptOnly: Array<[id: string, kind: string]> = [
    [LEGACY_MD_HTML_ID, "md"],
    [ORZ_SELF_SRC_ID, "md"],
    [ORZ_SELF_DECK_ID, "slides"],
  ];
  for (const [id, kind] of scriptOnly) {
    const found = matchScriptById(file, id);
    if (found) {
      const formatRaw = readAttr(found.openTag, ATTR_FORMAT);
      const format = formatRaw !== null ? Number.parseInt(formatRaw, 10) : 0;
      return {
        kind,
        format: Number.isFinite(format) ? format : 0,
        source: unescapeScriptOnly(found.body),
      };
    }
  }
  return null;
}

/**
 * Detect the carrier format version of an HTML file.
 * - `orz-carrier` <script> with data-orz-format → that integer (>= 1)
 * - any recognized island without the marker (`orz-carrier`, legacy
 *   `md-source`, orz-family `orz-src` / `orz-deck`) → 0
 * - no island → null
 */
export function detectHtmlVersion(file: string): number | null {
  const found =
    matchScriptById(file, CARRIER_ELEMENT_ID) ??
    matchScriptById(file, LEGACY_MD_HTML_ID) ??
    matchScriptById(file, ORZ_SELF_SRC_ID) ??
    matchScriptById(file, ORZ_SELF_DECK_ID);
  if (!found) return null;
  const formatRaw = readAttr(found.openTag, ATTR_FORMAT);
  if (formatRaw !== null) {
    const n = Number.parseInt(formatRaw, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
