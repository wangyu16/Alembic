/**
 * The synced pointer (`packages.last_synced_sha`): the public-repo head
 * Alembic last knew to contain nothing it had not seen. Reconcile ("Check for
 * outside changes") compares the repo against it to find foreign commits, so
 * it must NEVER move past a commit Alembic did not make (loop r2, MEDIUM-4,
 * P5.B.3.f). Re-exported from `lib/github.ts`; kept free of `server-only`
 * imports so tests can run it as-is.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Persist the synced pointer unconditionally (M20). Only for a point that is
 * known clean: the publish baseline, and reconcile after a clean absorb.
 * After an ordinary commit use `recordOwnCommit`.
 */
export async function recordSyncedSha(
  supabase: SupabaseClient,
  packageId: string,
  sha: string,
): Promise<void> {
  await supabase.from("packages").update({ last_synced_sha: sha }).eq("id", packageId);
}

/**
 * The last SHA Alembic synced, or null if never synced. A failed read THROWS
 * (loop r2): a null here switches off the outside-change guard, so a database
 * hiccup must not pass for "never synced".
 */
export async function syncedShaFor(
  supabase: SupabaseClient,
  packageId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("packages")
    .select("last_synced_sha")
    .eq("id", packageId)
    .maybeSingle();
  if (error) throw new Error(`last_synced_sha read failed: ${error.message}`);
  return (data?.last_synced_sha as string | null) ?? null;
}

/**
 * Move the pointer `from` → `to` atomically: only if it still holds `from`
 * (compare-and-set). Returns whether it moved.
 */
export async function advanceSyncedSha(
  supabase: SupabaseClient,
  packageId: string,
  from: string | null,
  to: string,
): Promise<boolean> {
  const q = supabase.from("packages").update({ last_synced_sha: to }).eq("id", packageId);
  const guarded = from === null ? q.is("last_synced_sha", null) : q.eq("last_synced_sha", from);
  const { data, error } = await guarded.select("id");
  if (error) throw new Error(`last_synced_sha update failed: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/**
 * After Alembic's own commit to the public repo: advance the pointer
 * `parentSha` → `commitSha` by compare-and-set — it moves only when it still
 * holds the commit's PARENT (or, never synced, null). So:
 *
 *  - a commit built on the synced point advances it (as always);
 *  - a commit built on Alembic's OWN previous commit advances it too, once
 *    that commit's pointer write has landed (loop r3, P5.B.3.g: two tabs
 *    saving at once used to strand the pointer one commit behind, and the
 *    second tab's files were then refused forever);
 *  - a commit built on a change made outside Alembic never moves it past
 *    that change (MEDIUM-4, P5.B.3.f): the pointer holds the point before
 *    the outside commit, not its parent, so the swap does not apply and
 *    reconcile still sees the outside change.
 *
 * Best-effort: the commit already landed, so a bookkeeping failure is
 * retried once and then logged, never reported as a failed save. A pointer
 * left behind is repaired by the next save (the committer reconciles, finds
 * nothing new in Alembic's own commit, and retries).
 */
export async function recordOwnCommit(
  supabase: SupabaseClient,
  packageId: string,
  synced: string | null,
  result: { commitSha: string; parentSha: string },
): Promise<void> {
  if (result.commitSha === result.parentSha) return; // nothing new was committed
  const from = synced === null ? null : result.parentSha;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const moved = await advanceSyncedSha(supabase, packageId, from, result.commitSha);
      if (!moved) {
        console.warn(
          `[sync] ${packageId}: synced pointer not at ${from?.slice(0, 7) ?? "(none)"} (outside change or concurrent save); left for reconcile`,
        );
      }
      return;
    } catch (err) {
      console.warn(
        `[sync] ${packageId}: pointer update failed (attempt ${attempt}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
