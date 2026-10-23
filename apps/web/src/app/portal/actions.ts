"use server";

import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit-server";
import { recordDiscoveryEvent } from "@/lib/record-discovery-event";
import { fileReport } from "@/lib/report-submit";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * M33 — report a listed package. Open to anyone (signed-in or anonymous);
 * entries land in `portal_reports` for operators to review (no in-app admin UI
 * yet — Phase 7). Takedown during the grant is an operator action (remove the
 * registration) or the owner unlisting; see docs/specs/portal-governance.md.
 * Rate limited per client address (Track A.6: 5 per 10 min, 20 per day —
 * `lib/rate-limit.ts`); each accepted report logs a de-identified
 * `portal.reported` event (the reason's length, never its text). Filed
 * through `file_portal_report` (migration 0024: the only insert path, with
 * per-package and global caps — `lib/report-submit.ts`).
 */
export async function reportPackageAction(
  packageId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (!trimmed) return { ok: false, error: "Add a brief reason for the report." };
  const gate = await checkRateLimit("report", await headers());
  if (!gate.ok) {
    return {
      ok: false,
      error: "You've sent several reports in a short time. Please try again later.",
    };
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const outcome = await fileReport(
    createServiceClient(),
    (row) => supabase.from("portal_reports").insert(row),
    { packageId, reason: trimmed, reporterId: user?.id ?? null },
  );
  if (outcome === "rate_limited") {
    return { ok: false, error: "Many reports have been sent in a short time. Please try again later." };
  }
  if (outcome === "invalid") return { ok: false, error: "This report couldn't be filed for this course." };
  if (outcome !== "ok") return { ok: false, error: "Couldn't submit the report. Please try again." };
  recordDiscoveryEvent(
    { type: "portal.reported", packageId, reasonLength: trimmed.length },
    { userId: user?.id ?? null, session: supabase },
  );
  return { ok: true };
}
