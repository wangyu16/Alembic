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
for (const kind of BUILTIN_KINDS) {
  registerKind(kind);
}
