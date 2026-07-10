"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";

/**
 * Admin user-management actions (UG4; docs/specs/user-governance.md §3).
 *
 * Disabling an account is Supabase's own ban — `auth.users.banned_until`, set
 * through the admin API. There is no `profiles.status` column to keep in sync.
 *
 * Every write here runs on the SERVICE client, behind `requireAdmin()`. That is
 * deliberate and required: migration 0016 revoked column UPDATE on `profiles`
 * from `authenticated`, precisely so that no user-scoped client — including an
 * admin's own — can flip `is_admin` or `ai_status`.
 *
 * A `"use server"` module may only export async functions, so the guardrail
 * helpers below stay module-private.
 */

export interface AdminUserActionResult {
  ok: boolean;
  error?: string;
}

/** Long enough to be permanent; `ban_duration: "none"` lifts it. */
const BAN_DURATION = "876000h"; // ~100 years

type Service = NonNullable<Awaited<ReturnType<typeof requireAdmin>>["service"]>;

/** Append to the audit trail. Never blocks the action it records — but a failed
 *  write IS surfaced, because an audit log with silent holes is worse than none. */
async function audit(
  service: Service,
  entry: {
    actorId: string;
    targetId: string;
    action: "disable_user" | "enable_user" | "approve_ai" | "revoke_ai";
    reason?: string;
  },
): Promise<void> {
  const { error } = await service.from("admin_audit").insert({
    actor_id: entry.actorId,
    target_id: entry.targetId,
    action: entry.action,
    reason: entry.reason ?? null,
  });
  if (error) console.error(`[admin] audit insert failed (${entry.action}): ${error.message}`);
}

/**
 * Refuse to act on a target that must not be touched. Returns an error string,
 * or null when the action may proceed.
 *
 * Both rules exist to stop an admin removing the only means of undoing the
 * action: `/admin` is gated on `is_admin`, and a disabled admin cannot sign in
 * to lift their own ban.
 */
async function guardTarget(
  service: Service,
  actorId: string,
  targetId: string,
): Promise<string | null> {
  if (actorId === targetId) return "You can't disable your own account.";
  const { data, error } = await service
    .from("profiles")
    .select("is_admin")
    .eq("id", targetId)
    .maybeSingle();
  if (error || !data) return "That account no longer exists.";
  if ((data as { is_admin: boolean }).is_admin) return "You can't disable another admin.";
  return null;
}

/** Suspend an account: it can no longer sign in, and its session cannot refresh. */
export async function disableUserAction(
  targetId: string,
  reason: string,
): Promise<AdminUserActionResult> {
  const { userId, service } = await requireAdmin();
  if (!service) return { ok: false, error: "Admin service is not configured." };
  if (!reason.trim()) return { ok: false, error: "A reason is required." };

  const blocked = await guardTarget(service, userId, targetId);
  if (blocked) return { ok: false, error: blocked };

  const { error } = await service.auth.admin.updateUserById(targetId, {
    ban_duration: BAN_DURATION,
  });
  if (error) return { ok: false, error: "Couldn't suspend that account." };

  await audit(service, { actorId: userId, targetId, action: "disable_user", reason: reason.trim() });
  revalidatePath("/admin/users");
  return { ok: true };
}

/** Lift a suspension. */
export async function enableUserAction(targetId: string): Promise<AdminUserActionResult> {
  const { userId, service } = await requireAdmin();
  if (!service) return { ok: false, error: "Admin service is not configured." };

  const { error } = await service.auth.admin.updateUserById(targetId, { ban_duration: "none" });
  if (error) return { ok: false, error: "Couldn't restore that account." };

  await audit(service, { actorId: userId, targetId, action: "enable_user" });
  revalidatePath("/admin/users");
  return { ok: true };
}

/** Grant the AI assistant to an account. */
export async function approveAiAction(targetId: string): Promise<AdminUserActionResult> {
  const { userId, service } = await requireAdmin();
  if (!service) return { ok: false, error: "Admin service is not configured." };

  const { error } = await service
    .from("profiles")
    .update({ ai_status: "approved", ai_decided_at: new Date().toISOString(), ai_decided_by: userId })
    .eq("id", targetId);
  if (error) return { ok: false, error: "Couldn't approve AI access." };

  await audit(service, { actorId: userId, targetId, action: "approve_ai" });
  revalidatePath("/admin/users");
  return { ok: true };
}

/**
 * Withdraw AI access. Returns to `none` rather than `requested`, so a revoked
 * account does not silently reappear in the pending queue as if it had just
 * asked; the educator must ask again.
 */
export async function revokeAiAction(targetId: string): Promise<AdminUserActionResult> {
  const { userId, service } = await requireAdmin();
  if (!service) return { ok: false, error: "Admin service is not configured." };

  const { error } = await service
    .from("profiles")
    .update({ ai_status: "none", ai_decided_at: new Date().toISOString(), ai_decided_by: userId })
    .eq("id", targetId);
  if (error) return { ok: false, error: "Couldn't withdraw AI access." };

  await audit(service, { actorId: userId, targetId, action: "revoke_ai" });
  revalidatePath("/admin/users");
  return { ok: true };
}
