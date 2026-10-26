"use server";

import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit-server";
import { clientIp, rateSecret } from "@/lib/rate-limit";
import { recordDiscoveryEvent } from "@/lib/record-discovery-event";
import { fileReport, reporterKey } from "@/lib/report-submit";
import { createServiceClient } from "@/lib/supabase/service";
import { REPORT_MESSAGES, type ReportCode } from "@/lib/report-return";

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
): Promise<{ ok: boolean; error?: string; code?: ReportCode }> {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (!trimmed) return { ok: false, code: "empty", error: REPORT_MESSAGES.empty };
  const h = await headers();
  const gate = await checkRateLimit("report", h);
  if (!gate.ok) {
    return { ok: false, code: "limited", error: REPORT_MESSAGES.limited };
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const outcome = await fileReport(
    createServiceClient(),
    (row) => supabase.from("portal_reports").insert(row),
    {
      packageId,
      reason: trimmed,
      reporterId: user?.id ?? null,
      // The database caps each package per reporting source (security loop r1 M4).
      reporterKey: reporterKey({ userId: user?.id ?? null, ip: clientIp(h) }, rateSecret()),
    },
  );
  if (outcome === "rate_limited") {
    return { ok: false, code: "busy", error: REPORT_MESSAGES.busy };
  }
  if (outcome === "invalid") return { ok: false, code: "invalid", error: REPORT_MESSAGES.invalid };
  if (outcome !== "ok") return { ok: false, code: "error", error: REPORT_MESSAGES.error };
  recordDiscoveryEvent(
    { type: "portal.reported", packageId, reasonLength: trimmed.length },
    { userId: user?.id ?? null, session: supabase },
  );
  return { ok: true, code: "sent" };
}
