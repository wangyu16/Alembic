"use server";

import { revalidatePath } from "next/cache";
import { can, type Role } from "@alembic/package-contract";
import { parseCourseOp } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { queueCourseOp } from "@/lib/course-op";

/** Answer an item through needs_you_answer (the role checks live there). */
export async function answerItemAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const packageId = String(formData.get("packageId") ?? "");
  const id = String(formData.get("id") ?? "");
  // The kind comes from the item itself, never from the form.
  const { data: item } = await supabase.from("needs_you").select("kind").eq("id", id).eq("package_id", packageId).maybeSingle();
  const kind = item?.kind as string | undefined;
  let answer: Record<string, unknown>;
  if (kind === "question") {
    const text = String(formData.get("text") ?? "").trim().slice(0, 2000);
    if (!text) return;
    answer = { text };
  } else if (kind === "to-confirm") {
    answer = { decision: "confirmed" };
  } else if (kind === "update" || kind === "suggestion") {
    answer = { decision: "dismissed" };
  } else if (kind === "both-changed") {
    answer = { decision: "seen" }; // both versions are already kept; "Restore the chapter" has its own action
  } else {
    return; // decided elsewhere (approvals, conflicts…), not from this page
  }
  await supabase.rpc("needs_you_answer", { p_id: id, p_answer: answer });
  revalidatePath(`/workspace/${packageId}/needs-you`);
}

/**
 * "Restore the chapter" on a both-changed item (contract v3 §13.4): the operation comes from the item the
 * platform raised, never from the form; the person's right is checked here and again when it runs.
 */
export async function restoreChapterFromItemAction(packageId: string, id: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data: role } = await supabase.rpc("course_role", { p: packageId });
  if (!can((role ?? "none") as Role, "edit.course-files")) return;
  const { data: item } = await supabase.from("needs_you").select("kind, payload").eq("id", id).eq("package_id", packageId).maybeSingle();
  const action = (item?.payload as { action?: unknown } | null)?.action;
  const op = item?.kind === "both-changed" ? parseCourseOp(action) : null;
  if (!op || op.op !== "restoreChapter") return;
  await queueCourseOp(packageId, user.id, op);
  await supabase.rpc("needs_you_answer", { p_id: id, p_answer: { decision: "restored" } });
  revalidatePath(`/workspace/${packageId}/needs-you`);
}
