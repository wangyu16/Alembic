// Shared types for the carrier codec + kind registry.
//
// PURE module: no IO, no Node built-ins, no framework imports. Runs in Node and
// the browser. This package only manipulates the carrier *envelope* (the SVG /
// HTML wrapper) and the embedded source island — it NEVER parses or interprets
// the source itself (and never parses markdown).

/** How a carrier renders. "pdf" is reserved for v2 and not implemented here. */
export type CarrierPayload = "svg" | "html";

/** Source-of-truth role. Assets are authored once and reused; documents are
 * derived from blocks. The codec mechanics are identical for both. */
export type CarrierRole = "asset" | "document";

export interface CarrierKind {
  /** Stable kind id, e.g. "ketcher" | "plot" | "md" | "slides". */
  id: string;
  role: CarrierRole;
  /** Full dual extension, e.g. ".ketcher.svg". */
  extension: string;
  payload: CarrierPayload;
  /** The current format version this kind writes. */
  formatVersion: number;
}

export interface EmbedInput {
  /** CarrierKind.id */
  kind: string;
  format: number;
  payload: CarrierPayload;
  /** The SVG or HTML the file should visibly display. */
  rendered: string;
  /** The editable source to embed inside the carrier. */
  source: string;
}

export interface ExtractResult {
  kind: string;
  format: number;
  source: string;
}

/** Thrown when a carrier operation fails (e.g. no source island found). */
export class CarrierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CarrierError";
  }
}

/** Shared envelope markers (consumers depend on these literal strings). */
export const CARRIER_ELEMENT_ID = "orz-carrier";
export const ATTR_KIND = "data-orz-kind";
export const ATTR_FORMAT = "data-orz-format";
export const HTML_SCRIPT_TYPE = "application/orz-carrier+json";

/** Legacy (format 0) markers from the old orz-plot VS Code extension. */
export const LEGACY_SVG_METADATA_ID = "orz-chart-meta";
