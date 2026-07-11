/**
 * Term operations for the Current collection (package-ops).
 *
 * A term is a two-segment space prefix `current/<term-id>` (contract
 * `currentSpaceDir`); the whole collection framework (listing, tree, write
 * door, registry) is reused verbatim with that as the `spaceDir`. This module
 * adds only the two things the framework can't derive on its own: enumerating
 * the terms that exist in the repo, and planning a carry-over copy into a new
 * term. Pure over the injected `PackageStore` — no framework imports.
 */

import { currentSpaceDir, termIdForPath } from "@alembic/package-contract";
import type { PackageStore } from "./store";

/** One term present in a package's `current/` space. */
export interface TermInfo {
  /** Immutable, URL-safe id (`2026-fall`). */
  id: string;
  /** Display label from the manifest, when this is the current term. */
  label?: string;
  /** True for the term the manifest points at (`manifest.currentTerm`). */
  isCurrent: boolean;
  /** How many files live under `current/<id>/…` (public repo). */
  fileCount: number;
}

/**
 * Every term that exists in a package, newest id first (ids sort lexically;
 * `2026-*` conventions keep that chronological), with the manifest's current
 * term flagged and hoisted to the front. A term the manifest points at but that
 * has no files yet still appears (a freshly-started, empty term), so the
 * switcher can show it immediately after rollover.
 */
export async function listTerms(
  store: PackageStore,
  packageId: string,
): Promise<TermInfo[]> {
  const record = await store.getPackage(packageId);
  const currentId = record?.manifest.currentTerm;
  const currentLabel = record?.manifest.currentTermLabel;

  const counts = new Map<string, number>();
  for (const f of await store.listFiles(packageId)) {
    if (f.repo !== "public") continue;
    const termId = termIdForPath(f.path);
    if (!termId) continue;
    counts.set(termId, (counts.get(termId) ?? 0) + 1);
  }
  // A current term with no files yet must still be listed.
  if (currentId && !counts.has(currentId)) counts.set(currentId, 0);

  const terms: TermInfo[] = [...counts.entries()].map(([id, fileCount]) => ({
    id,
    label: id === currentId ? currentLabel : undefined,
    isCurrent: id === currentId,
    fileCount,
  }));

  // Current first, then remaining ids newest-first (descending lexical).
  terms.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return b.id.localeCompare(a.id);
  });
  return terms;
}

/** One file to copy in a carry-over, from a source path to its new-term path. */
export interface CarryOverEntry {
  fromPath: string;
  toPath: string;
  content: string;
}

/**
 * Plan a carry-over copy of every file under `fromTermId` into `toTermId`,
 * preserving the relative layout (scope + folders + section). Pure path
 * remapping — the source term prefix is swapped for the target's; the caller
 * writes the returned entries through the one validated write door. Announcement
 * files are EXCLUDED (dated notes belong to the term that made them, never the
 * next one); everything else — assignments, misc, and any chapter-scoped
 * materials — carries over. Skips a no-op copy onto itself.
 */
export async function planCarryOver(
  store: PackageStore,
  packageId: string,
  fromTermId: string,
  toTermId: string,
): Promise<CarryOverEntry[]> {
  if (fromTermId === toTermId) return [];
  const fromDir = currentSpaceDir(fromTermId); // validates ids (fail-closed)
  const toDir = currentSpaceDir(toTermId);

  const entries: CarryOverEntry[] = [];
  for (const f of await store.listFiles(packageId)) {
    if (f.repo !== "public") continue;
    if (f.path !== fromDir && !f.path.startsWith(`${fromDir}/`)) continue;
    const rest = f.path.slice(fromDir.length + 1); // path beyond `current/<id>/`
    // Announcements are term-specific; never carry them into the new term.
    if (rest.startsWith("announcements/")) continue;
    entries.push({
      fromPath: f.path,
      toPath: `${toDir}/${rest}`,
      content: f.content,
    });
  }
  return entries;
}
