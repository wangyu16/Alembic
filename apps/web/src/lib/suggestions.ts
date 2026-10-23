import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** A cross-owner suggest-back row (migration 0009). RLS does the access control. */
export interface SuggestionRow {
  id: number;
  target_package_id: string;
  from_package_id: string;
  chapter_path: string;
  source_block_id: string;
  suggested_title: string | null;
  suggested_body: string;
  note: string;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
}

const COLS =
  "id, target_package_id, from_package_id, chapter_path, source_block_id, suggested_title, suggested_body, note, status, created_at";

/**
 * The database's bounds on a suggestion (migration 0028_loop_r2_3, security
 * loop r2 NEW-4) — checked here first so the educator gets a clear answer.
 */
export const SUGGESTION_LIMITS = { body: 20_000, title: 500, note: 2_000 } as const;

/** Whether a suggestion fits the database's bounds. */
export function suggestionFits(row: { suggestedBody: string; suggestedTitle: string | null; note: string }): boolean {
  return (
    row.suggestedBody.length <= SUGGESTION_LIMITS.body &&
    (row.suggestedTitle ?? "").length <= SUGGESTION_LIMITS.title &&
    row.note.length <= SUGGESTION_LIMITS.note
  );
}

/** Send a suggestion to another educator's (registered) package. RLS enforces
 *  consent (target must be registered) + sender identity. Returns false on deny. */
export async function sendSuggestion(
  supabase: SupabaseClient,
  row: {
    targetPackageId: string;
    fromPackageId: string;
    fromUserId: string;
    chapterPath: string;
    sourceBlockId: string;
    suggestedTitle: string | null;
    suggestedBody: string;
    note: string;
  },
): Promise<boolean> {
  const { error } = await supabase.from("suggestions").insert({
    target_package_id: row.targetPackageId,
    from_package_id: row.fromPackageId,
    from_user_id: row.fromUserId,
    chapter_path: row.chapterPath,
    source_block_id: row.sourceBlockId,
    suggested_title: row.suggestedTitle,
    suggested_body: row.suggestedBody,
    note: row.note,
    status: "pending",
  });
  return !error;
}

/** Pending suggestions targeting a package (the owner sees them via RLS). */
export async function listIncomingSuggestions(
  supabase: SupabaseClient,
  packageId: string,
): Promise<SuggestionRow[]> {
  const { data } = await supabase
    .from("suggestions")
    .select(COLS)
    .eq("target_package_id", packageId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  return (data as SuggestionRow[] | null) ?? [];
}

export async function getSuggestion(
  supabase: SupabaseClient,
  id: number,
): Promise<SuggestionRow | null> {
  const { data } = await supabase.from("suggestions").select(COLS).eq("id", id).maybeSingle();
  return (data as SuggestionRow | null) ?? null;
}

export async function setSuggestionStatus(
  supabase: SupabaseClient,
  id: number,
  status: "accepted" | "rejected",
): Promise<void> {
  await supabase
    .from("suggestions")
    .update({ status, decided_at: new Date().toISOString() })
    .eq("id", id);
}
