import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  rebuildPackageRegistry,
  registerChangedFiles,
  registerFile,
  registryDrift,
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
 * Register the files ONE change set touched (Track B.1) — for the doors that
 * do NOT go through `writeThrough` (reconcile absorbing a foreign commit,
 * the upload's permalink rounds). Writes through `writeThrough` /
 * `updateManifest` are registered by the write path itself (loop r1b) and
 * must not call this. Best-effort, like every registry call.
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
 * - `onlyIfPathsChanged` (page loads): a read registers nothing new; what it
 *   can discover is that the files moved underneath the registry (a file
 *   committed straight to GitHub, a write that failed to register). Compare
 *   locations AND content digests — two cheap, content-free queries (the
 *   database computes `sandbox_files.content_sha256`; the registry recorded
 *   the digest it registered) — and register just the difference (loop r1b,
 *   P5.B.1.m: before, a content change with an unchanged path set was never
 *   seen, so `source_hash` stayed stale indefinitely).
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
      // row; registryDrift leaves them out or this never settles.
      const { added, stale, removed } = registryDrift(paths, records);
      const toRead = added.length + stale.length;
      if (toRead === 0 && removed.length === 0) return;
      // A handful of files: read just those. Many (a large external commit,
      // or the first visit after r1b, when no row has a digest yet): one
      // whole read beats hundreds of single-row reads.
      if (toRead <= 50) {
        await registerChangedFiles(registry, packageStore, packageId, [...added, ...stale, ...removed], origin);
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
