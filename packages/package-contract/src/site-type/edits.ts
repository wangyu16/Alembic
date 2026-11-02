/**
 * How concurrent edits to a file are combined, read from the site type definition (SITE-TYPE-CONTRACT §5 `edits`):
 * `sections` (combined section by section), `whole` (one block: a concurrent change keeps both versions) or
 * `keep-both` (never combined). A file the definition doesn't describe is `whole`. This replaces the core's own list
 * of course folders (the bridge, contract §14; content logic out of the core, FD-10).
 */
import type { SiteType } from "./schema";

export type Edits = "sections" | "whole" | "keep-both";

export function editsFor(def: SiteType, path: string): Edits {
  for (const d of def.documents) {
    const edits = (d.edits ?? "whole") as Edits;
    if (d.scope === "site") { if (d.path === path) return edits; continue; }
    const [pre, post] = d.path.split("{unit}") as [string, string];
    if (path.startsWith(pre) && path.endsWith(post) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path.slice(pre.length, path.length - post.length))) return edits;
  }
  return "whole";
}
