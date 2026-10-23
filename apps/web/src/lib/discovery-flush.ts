import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Drain this package's queued discovery refresh (correctness loop r2, M-D1,
 * P5.A.1.h; migration 0029_loop_r2c_1). A package-level change of a large
 * course (rename, licence, listing, publish, restore) refreshes the course
 * row inside the educator's write and queues its element rows; this call —
 * its OWN statement, after the write committed — re-projects them in
 * ≤ 1,000-element chunks for up to ~2 s and returns. Whatever is left is
 * drained by the next call (the next such write, or the next visit to the
 * course's edit page). A timeout or error here can never undo the write.
 *
 * Best-effort, like every discovery call: it never throws, and before the
 * migration is applied the RPC simply does not exist yet.
 */
export async function flushDiscovery(
  supabase: Pick<SupabaseClient, "rpc">,
  packageId: string,
): Promise<void> {
  try {
    const { error } = await supabase.rpc("discovery_flush_package", { p_package_id: packageId });
    if (error && !/discovery_flush_package/.test(error.message)) {
      console.warn(`[discovery] flush of ${packageId} failed:`, error.message);
    }
  } catch (err) {
    console.warn(`[discovery] flush of ${packageId} failed:`, err instanceof Error ? err.message : err);
  }
}
