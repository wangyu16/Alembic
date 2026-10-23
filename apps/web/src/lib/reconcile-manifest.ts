import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReconcileOutcome } from "@alembic/package-ops";

/**
 * After a reconcile (lib/github `reconcilePackage`): when the foreign change
 * included the course details file, refresh the derived `packages.manifest`
 * read cache from the manifest the write path returned — the same step every
 * `updateManifest` caller takes — so readers of the column (the discovery
 * projection, the workspace) see a licence or listing change made on GitHub
 * (P5.B.3.e). Never re-derived here; an absorb without alembic.json, an
 * up-to-date check or a quarantine leaves the column alone.
 */
export async function refreshManifestAfterReconcile(
  supabase: Pick<SupabaseClient, "from">,
  packageId: string,
  outcome: ReconcileOutcome,
): Promise<boolean> {
  if (outcome.status !== "absorbed" || outcome.manifest === undefined) return false;
  const { error } = await supabase
    .from("packages")
    .update({ manifest: outcome.manifest })
    .eq("id", packageId);
  if (error) throw new Error(`Couldn't refresh the course details cache: ${error.message}`);
  return true;
}
