// The kind registry — the extension point.
//
// Adding a new carrier kind is one registration, no consumer changes. The
// registry is pure and in-module (a process-local map). Consumers iterate it
// instead of hardcoding file types.

import type { CarrierKind } from "./types";

/** Built-in kinds, pre-registered at module load. */
export const BUILTIN_KINDS: CarrierKind[] = [
  { id: "ketcher", role: "asset", extension: ".ketcher.svg", payload: "svg", formatVersion: 1 },
  { id: "plot", role: "asset", extension: ".plot.svg", payload: "svg", formatVersion: 1 },
  { id: "md", role: "document", extension: ".md.html", payload: "html", formatVersion: 1 },
  { id: "slides", role: "document", extension: ".slides.html", payload: "html", formatVersion: 1 },
];

/**
 * Contract-v2 built-in (Roadmap R1): the orz-paged print-layout document.
 * Kept out of BUILTIN_KINDS so that v1 constant stays byte-for-byte
 * unchanged; pre-registered at module load all the same.
 */
export const PAGED_KIND: CarrierKind = {
  id: "paged",
  role: "document",
  extension: ".paged.html",
  payload: "html",
  formatVersion: 1,
};

/**
 * Plain-media fallback kinds (contract v2 / Roadmap R1): ordinary media files
 * register as generic assets instead of failing classification. These are not
 * carriers — payload "binary" means opaque bytes, no embedded source
 * (formatVersion 0: there is no format to version). Dual-extension carriers
 * still win by longest-suffix match: ".ketcher.svg" resolves to "ketcher",
 * never to the plain "svg" media kind.
 */
export const MEDIA_KINDS: CarrierKind[] = [
  { id: "png", role: "asset", extension: ".png", payload: "binary", formatVersion: 0 },
  { id: "jpg", role: "asset", extension: ".jpg", payload: "binary", formatVersion: 0 },
  { id: "jpeg", role: "asset", extension: ".jpeg", payload: "binary", formatVersion: 0 },
  { id: "gif", role: "asset", extension: ".gif", payload: "binary", formatVersion: 0 },
  { id: "webp", role: "asset", extension: ".webp", payload: "binary", formatVersion: 0 },
  { id: "svg", role: "asset", extension: ".svg", payload: "binary", formatVersion: 0 },
  { id: "mp3", role: "asset", extension: ".mp3", payload: "binary", formatVersion: 0 },
  { id: "wav", role: "asset", extension: ".wav", payload: "binary", formatVersion: 0 },
  { id: "m4a", role: "asset", extension: ".m4a", payload: "binary", formatVersion: 0 },
  { id: "pdf", role: "asset", extension: ".pdf", payload: "binary", formatVersion: 0 },
];

const registry = new Map<string, CarrierKind>();

export function registerKind(kind: CarrierKind): void {
  registry.set(kind.id, kind);
}

export function getKind(id: string): CarrierKind | undefined {
  return registry.get(id);
}

/**
 * Resolve a kind by file extension using a LONGEST-SUFFIX match, so a path
 * ending in ".plot.svg" resolves to the "plot" kind rather than a hypothetical
 * ".svg" kind. The match is case-insensitive on the extension.
 */
export function getKindByExtension(ext: string): CarrierKind | undefined {
  const lower = ext.toLowerCase();
  let best: CarrierKind | undefined;
  let bestLen = -1;
  for (const kind of registry.values()) {
    const e = kind.extension.toLowerCase();
    if (lower.endsWith(e) && e.length > bestLen) {
      best = kind;
      bestLen = e.length;
    }
  }
  return best;
}

export function listKinds(): CarrierKind[] {
  return [...registry.values()];
}

// Pre-register the built-ins at module load.
for (const kind of [...BUILTIN_KINDS, PAGED_KIND, ...MEDIA_KINDS]) {
  registerKind(kind);
}
