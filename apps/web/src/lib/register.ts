import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rebuildPackageRegistry, registerFile } from "@alembic/package-ops";
import type { RegistrationRecord } from "@alembic/package-contract";
import { SupabaseSandboxStore } from "./sandbox-store";
import { SupabaseDocumentRegistryStore } from "./document-registry-store";

/**
 * Rebuild a package's `documents` registry from its current files (R2). The
 * registry is a rebuildable projection of repo content, so this is idempotent
 * and always-correct: it re-registers present files (identity-keyed, so docIds
 * are stable) and tombstones records whose path is gone. Best-effort — a
 * registry hiccup must never break an educator workflow (same rule as research
 * events), so failures are swallowed.
 *
 * Called at all three doors: package open / save (`origin: "created"`) and
 * external-commit reconcile (`origin: "external-commit"`). `rebuildPackageRegistry`
 * has the full file list, so it resolves the duplicate-content identity
 * tiebreaker (package-contract-v2.md §2).
 */
export async function syncPackageRegistry(
  supabase: SupabaseClient,
  packageId: string,
  origin: RegistrationRecord["origin"] = "created",
): Promise<void> {
  try {
    const packageStore = new SupabaseSandboxStore(supabase);
    const registry = new SupabaseDocumentRegistryStore(supabase);
    await rebuildPackageRegistry(registry, packageStore, packageId, origin);
  } catch (err) {
    // Rebuildable projection — never surface a registry error to the educator,
    // but DO leave a trace in the server logs (a fully silent guard hid the
    // v1-path registration bug once already).
    console.warn(
      `[registry] sync failed for ${packageId}:`,
      err instanceof Error ? err.message : err,
    );
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
    console.warn(
      `[registry] adapt-register failed for ${packageId} ${input.path}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
