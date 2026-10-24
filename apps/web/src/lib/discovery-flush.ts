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

/** The discovery queue's age, for operators (0030_loop_r3c_3, P5.A.1.t). */
export interface DiscoveryQueueHealth {
  pending: number;
  /** Entries first queued more than an hour ago (the scheduled drain should have taken them). */
  overdue: number;
  /** Entries whose last drain failed (backing off). */
  failing: number;
  oldestQueuedAt: string | null;
}

/**
 * Read the queue's health with the SERVICE client (the function is closed to
 * the API roles). Null when it cannot be read — before the migration, or
 * without the service key — so the admin page says "unavailable" rather
 * than "0".
 */
export async function discoveryQueueHealth(
  service: Pick<SupabaseClient, "rpc">,
): Promise<DiscoveryQueueHealth | null> {
  try {
    const { data, error } = await service.rpc("discovery_pending_health");
    const row = (Array.isArray(data) ? data[0] : data) as
      | { pending: number; overdue: number; failing: number; oldest_queued_at: string | null }
      | null
      | undefined;
    if (error || !row) return null;
    return {
      pending: Number(row.pending) || 0,
      overdue: Number(row.overdue) || 0,
      failing: Number(row.failing) || 0,
      oldestQueuedAt: row.oldest_queued_at ?? null,
    };
  } catch {
    return null;
  }
}
