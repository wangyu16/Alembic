// @alembic/carriers — carrier codec + kind registry (future orz-artifacts).
//
// A "carrier" is a renderable file (SVG or HTML) that embeds its own editable
// source plus `kind` / `format` markers, so it renders anywhere, round-trips
// losslessly, and stays self-describing forever (old format versions remain
// extractable). See docs/specs/carriers-and-assets.md §1, §3, §4.
//
// PURE package: no IO, no filesystem, no network, no Node built-ins, no
// framework imports. Runs in Node and the browser. Never parses markdown — it
// only manipulates the carrier envelope and the embedded source island.

import { detectHtmlVersion, embedHtml, extractHtml } from "./html";
import { detectSvgVersion, embedSvg, extractSvg } from "./svg";
import {
  CarrierError,
  type CarrierPayload,
  type CarrierRole,
  type CarrierKind,
  type EmbedInput,
  type ExtractResult,
} from "./types";

export type { CarrierPayload, CarrierRole, CarrierKind, EmbedInput, ExtractResult };
export { CarrierError };

export {
  BUILTIN_KINDS,
  getKind,
  getKindByExtension,
  listKinds,
  registerKind,
} from "./registry";

/**
 * Embed `source` into `rendered`, producing a carrier file. Dispatches by
 * `payload`: SVG injects a <metadata> first-child island; HTML injects a
 * non-executable <script> before </body>.
 */
export function embedSource(input: EmbedInput): string {
  switch (input.payload) {
    case "svg":
      return embedSvg(input);
    case "html":
      return embedHtml(input);
    default:
      throw new CarrierError(`embedSource: unsupported payload "${input.payload as string}"`);
  }
}

/**
 * Extract the embedded source from a carrier file. Tries the SVG island first,
 * then the HTML island. Throws CarrierError if neither is present.
 * Legacy (format 0) SVG islands are recovered too (kind defaults to "plot").
 */
export function extractSource(file: string): ExtractResult {
  const svg = extractSvg(file);
  if (svg) return svg;
  const html = extractHtml(file);
  if (html) return html;
  throw new CarrierError("extractSource: no carrier source island found");
}

/**
 * Report the carrier format version of a file:
 * - a current marker (`data-orz-format`) → that integer N (>= 1)
 * - a legacy island lacking the marker → 0
 * - no island at all → null
 * Checks both payload shapes (SVG metadata, then HTML script).
 */
export function detectFormatVersion(file: string): number | null {
  const svg = detectSvgVersion(file);
  if (svg !== null) return svg;
  return detectHtmlVersion(file);
}

/** True iff the file contains any (current or legacy) carrier source island. */
export function hasCarrier(file: string): boolean {
  return detectFormatVersion(file) !== null;
}
