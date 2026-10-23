import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isRegistrableLocation,
  rebuildPackageRegistry,
  registerChangedFiles,
  registerFile,
  type RegistryChange,
} from "@alembic/package-ops";
import type { RegistrationRecord } from "@alembic/package-contract";
import { SupabaseSandboxStore } from "./sandbox-store";
import { SupabaseDocumentRegistryStore } from "./document-registry-store";

/** Log, never surface: the registry is a rebuildable projection, and a
 *  registry hiccup must never break an educator workflow (same rule as
 *  research events). A fully silent guard hid the v1-path bug once already. */
function warn(packageId: string, what: string, err: unknown): void {
  console.warn(
    `[registry] ${what} failed for ${packageId}:`,
    err instanceof Error ? err.message : err,
  );
}

/**
 * Register the files ONE write touched (Track B.1). Every workspace write
 * path knows its change set — pass it straight through (deletions as
 * `content: null`). Costs a couple of round-trips instead of a whole-package
 * read plus two or three per file (scale audit 2026-08-28). Call it after the
 * write has landed; best-effort, like every registry call.
 */
export async function registerChanges(
  supabase: SupabaseClient,
  packageId: string,
  changes: ReadonlyArray<RegistryChange>,
  origin: RegistrationRecord["origin"] = "created",
): Promise<void> {
  try {
    await registerChangedFiles(
      new SupabaseDocumentRegistryStore(supabase),
      new SupabaseSandboxStore(supabase),
      packageId,
      changes,
      origin,
    );
  } catch (err) {
    warn(packageId, "register", err);
  }
}

/**
 * Bring a package's `documents` registry in line with its current files (R2).
 *
 * - Default: a FULL rebuild — every file read, identity resolved in memory,
 *   only changed rows written in bulk. For the genuine bulk doors: populate
 *   (an upload of a whole course) and external-commit reconcile.
 * - `onlyIfPathsChanged` (page loads): a read registers nothing new; the only
 *   thing it can discover is that the SET OF PATHS moved underneath it (a
 *   file committed straight to GitHub, say). Compare paths — two cheap,
 *   content-free queries — and register just the difference.
 */
export async function syncPackageRegistry(
  supabase: SupabaseClient,
  packageId: string,
  origin: RegistrationRecord["origin"] = "created",
  opts: { onlyIfPathsChanged?: boolean } = {},
): Promise<void> {
  try {
    const packageStore = new SupabaseSandboxStore(supabase);
    const registry = new SupabaseDocumentRegistryStore(supabase);

    if (opts.onlyIfPathsChanged) {
      const [paths, records] = await Promise.all([
        packageStore.listPaths(packageId),
        registry.listLiveByPackage(packageId),
      ]);
      // Files no registration path accepts (unknown locations) never get a
      // row; leave them out or this comparison never settles.
      const live = new Map(
        paths
          .filter((f) => isRegistrableLocation(f.repo, f.path))
          .map((f) => [`${f.repo} ${f.path}`, f] as const),
      );
      const known = new Map(records.map((r) => [`${r.repo} ${r.path}`, r] as const));
      const added = [...live].filter(([loc]) => !known.has(loc)).map(([, f]) => f);
      const removed = [...known]
        .filter(([loc]) => !live.has(loc))
        .map(([, r]) => ({ repo: r.repo, path: r.path, content: null }));
      if (added.length === 0 && removed.length === 0) return;
      // A handful of new files: read just those. Many (a large external
      // commit): one whole read beats hundreds of single-row reads.
      if (added.length <= 50) {
        await registerChangedFiles(registry, packageStore, packageId, [...added, ...removed], origin);
        return;
      }
    }

    await rebuildPackageRegistry(registry, packageStore, packageId, origin);
  } catch (err) {
    warn(packageId, "sync", err);
  }
}

/**
 * Register a freshly-adapted file with its `adaptedFrom` lineage (P4), returning
 * the new file's docId (its permalink id) so the caller can hand the educator a
 * link. Unlike `syncPackageRegistry` this is a single targeted registration —
 * the lineage must be stamped here (a later projection rebuild passes no
 * adaptedFrom and would only preserve, never set it). Returns null on failure;
 * the file still exists and a later rebuild will register it (without lineage).
 */
export async function registerAdaptedFile(
  supabase: SupabaseClient,
  packageId: string,
  input: { repo: "public" | "private"; path: string; content: string; adaptedFrom: string; author?: string },
): Promise<string | null> {
  try {
    const registry = new SupabaseDocumentRegistryStore(supabase);
    const record = await registerFile(registry, {
      packageId,
      repo: input.repo,
      path: input.path,
      origin: "created",
      content: input.content,
      adaptedFrom: input.adaptedFrom,
      author: input.author,
    });
    return record.docId;
  } catch (err) {
    warn(packageId, `adapt-register ${input.path}`, err);
    return null;
  }
}
