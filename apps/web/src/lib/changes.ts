import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** A row of the risk-tier change log / review queue (migration 0005). */
export interface ChangeRow {
  id: number;
  tier: number;
  kind: string;
  summary: string;
  detail: Record<string, unknown>;
  inverse: Record<string, unknown> | null;
  status: "pending" | "applied" | "accepted" | "rejected" | "undone";
  created_at: string;
}

export async function recordChange(
  supabase: SupabaseClient,
  row: {
    packageId: string;
    userId: string;
    tier: number;
    kind: string;
    summary: string;
    detail?: Record<string, unknown>;
    inverse?: Record<string, unknown> | null;
    status: ChangeRow["status"];
  },
): Promise<number | null> {
  const decided =
    row.status === "applied" ? new Date().toISOString() : null;
  const { data, error } = await supabase
    .from("package_changes")
    .insert({
      package_id: row.packageId,
      user_id: row.userId,
      tier: row.tier,
      kind: row.kind,
      summary: row.summary,
      detail: row.detail ?? {},
      inverse: row.inverse ?? null,
      status: row.status,
      decided_at: decided,
    })
    .select("id")
    .single();
  if (error) return null;
  return (data as { id: number }).id;
}

const COLS = "id, tier, kind, summary, detail, inverse, status, created_at";

export async function listAppliedTier1(
  supabase: SupabaseClient,
  packageId: string,
  limit = 12,
): Promise<ChangeRow[]> {
  const { data } = await supabase
    .from("package_changes")
    .select(COLS)
    .eq("package_id", packageId)
    .eq("status", "applied")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as ChangeRow[] | null) ?? [];
}

export async function listPendingReviews(
  supabase: SupabaseClient,
  packageId: string,
): Promise<ChangeRow[]> {
  const { data } = await supabase
    .from("package_changes")
    .select(COLS)
    .eq("package_id", packageId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  return (data as ChangeRow[] | null) ?? [];
}

export async function getChange(
  supabase: SupabaseClient,
  id: number,
): Promise<ChangeRow | null> {
  const { data } = await supabase
    .from("package_changes")
    .select(COLS)
    .eq("id", id)
    .maybeSingle();
  return (data as ChangeRow | null) ?? null;
}

export async function setChangeStatus(
  supabase: SupabaseClient,
  id: number,
  status: ChangeRow["status"],
): Promise<void> {
  await supabase
    .from("package_changes")
    .update({ status, decided_at: new Date().toISOString() })
    .eq("id", id);
}

/** Read the package's review policy (review_all → review floor of Tier 2). */
export async function getReviewAll(
  supabase: SupabaseClient,
  packageId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("packages")
    .select("review_all")
    .eq("id", packageId)
    .maybeSingle();
  return Boolean((data as { review_all?: boolean } | null)?.review_all);
}
