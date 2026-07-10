"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * The educator asks an admin to turn on the AI assistant for their account
 * (docs/specs/user-governance.md §1, §4). This is the only privileged write on
 * `profiles.ai_status` an ordinary user may trigger, and it is deliberately
 * narrow:
 *
 *  - It runs through the SERVICE client because migration 0016 revoked UPDATE on
 *    `ai_status` from `authenticated` — a user client cannot write the column at
 *    all (that is the point; a user must never be able to grant themselves AI).
 *  - The `none` → `requested` transition is the ONLY move it makes. The guard is
 *    pushed into the query (`.eq("ai_status", "none")`) so it is atomic: a row
 *    already `approved` (or `requested`) is not matched, so this can never
 *    overwrite an admin's approval or re-stamp the request time.
 *
 * No active-account check is needed: a banned account cannot hold a session to
 * reach this action, and the residual-token window is closed by middleware and
 * the `is_active_user()` RLS backstop.
 */
export async function requestAiAccessAction(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const service = createServiceClient();
  if (!service) {
    return { ok: false, error: "AI access requests aren't available on this deployment yet." };
  }

  const { error } = await service
    .from("profiles")
    .update({ ai_status: "requested", ai_requested_at: new Date().toISOString() })
    // Atomic guard: only a row still at 'none' is touched, so an existing
    // 'approved' or 'requested' status is never overwritten.
    .eq("id", user.id)
    .eq("ai_status", "none");

  if (error) {
    console.error(`[ai-access] request write failed: ${error.message}`);
    return { ok: false, error: "Couldn't send your request. Please try again." };
  }

  revalidatePath("/workspace", "layout");
  return { ok: true };
}
