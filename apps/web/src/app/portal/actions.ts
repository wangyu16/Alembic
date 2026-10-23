"use server";

import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit-server";
import { recordDiscoveryEvent } from "@/lib/record-discovery-event";

/**
 * M33 — report a listed package. Open to anyone (signed-in or anonymous);
 * entries land in `portal_reports` for operators to review (no in-app admin UI
 * yet — Phase 7). Takedown during the grant is an operator action (remove the
 * registration) or the owner unlisting; see docs/specs/portal-governance.md.
 * Rate limited per client address (Track A.6: 5 per 10 min, 20 per day —
 * `lib/rate-limit.ts`); each accepted report logs a de-identified
 * `portal.reported` event (the reason's length, never its text).
 */
export async function reportPackageAction(
  packageId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = reason.trim();
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
  const { error } = await supabase.from("portal_reports").insert({
    package_id: packageId,
    reporter_id: user?.id ?? null,
    reason: trimmed.slice(0, 2000),
  });
  if (error) return { ok: false, error: "Couldn't submit the report. Please try again." };
  recordDiscoveryEvent(
    { type: "portal.reported", packageId, reasonLength: trimmed.length },
    { userId: user?.id ?? null, session: supabase },
  );
  return { ok: true };
}
