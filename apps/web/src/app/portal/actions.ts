"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * M33 — report a listed package. Open to anyone (signed-in or anonymous);
 * entries land in `portal_reports` for operators to review (no in-app admin UI
 * yet — Phase 7). Takedown during the grant is an operator action (remove the
 * registration) or the owner unlisting; see docs/specs/portal-governance.md.
 */
export async function reportPackageAction(
  packageId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = reason.trim();
  if (!trimmed) return { ok: false, error: "Add a brief reason for the report." };
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
  return { ok: true };
}
