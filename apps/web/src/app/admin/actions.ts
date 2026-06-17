"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";

export interface AdminActionResult {
  ok: boolean;
  error?: string;
}

/** Flag/unflag a user as a study participant (portal listing eligibility). */
export async function setPortalEligibleAction(
  userId: string,
  on: boolean,
): Promise<AdminActionResult> {
  const { service } = await requireAdmin();
  if (!service) return { ok: false, error: "Admin service is not configured." };
  const { error } = await service.from("profiles").update({ portal_eligible: on }).eq("id", userId);
  if (error) return { ok: false, error: "Couldn't update eligibility." };
  revalidatePath("/admin");
  return { ok: true };
}

/** Resolve or dismiss a report. */
export async function resolveReportAction(
  reportId: number,
  status: "resolved" | "dismissed",
): Promise<AdminActionResult> {
  const { service } = await requireAdmin();
  if (!service) return { ok: false, error: "Admin service is not configured." };
  const { error } = await service.from("portal_reports").update({ status }).eq("id", reportId);
  if (error) return { ok: false, error: "Couldn't update the report." };
  revalidatePath("/admin");
  return { ok: true };
}
