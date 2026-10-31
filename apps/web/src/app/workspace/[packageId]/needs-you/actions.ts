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
  // Still open: a stale page can't restore after someone chose to leave it removed (audit r3 LOW-1).
  const { data: item } = await supabase.from("needs_you").select("kind, payload").eq("id", id).eq("package_id", packageId).in("state", ["waiting", "shown"]).maybeSingle();
  const action = (item?.payload as { action?: unknown } | null)?.action;
  const op = item?.kind === "both-changed" ? parseCourseOp(action) : null;
  if (!op || op.op !== "restoreChapter") return;
  // Queue under a key from the item, then answer: two clicks are one restore (round 1 M2), and a failed queue
  // leaves the item open to try again (round 2 L5). Only the first person's row is accepted for that key.
  try {
    if (!(await queueCourseOp(packageId, user.id, op, "restoreChapter", `item-${id}`))) return;
  } catch {
    return; // e.g. the same key queued by the other decider: their restore stands
  }
  await supabase.rpc("needs_you_answer", { p_id: id, p_answer: { decision: "restored" } });
  revalidatePath(`/workspace/${packageId}/needs-you`);
}

/**
 * Answers to the assistant's question digest (agent-runtime §14.1): only the person it is addressed to answers;
 * answers to the listed questions only, a chosen answer one of its choices; "accept all recommended" takes each
 * recommendation (questions without one stay unanswered). The assistant reads the answers when it catches up.
 * An answer is never an approval of anything.
 */
export async function answerDigestAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const packageId = String(formData.get("packageId") ?? "");
  const id = String(formData.get("id") ?? "");
  const { data: item } = await supabase.from("needs_you").select("kind, origin, payload, addressed_to").eq("id", id).eq("package_id", packageId).in("state", ["waiting", "shown"]).maybeSingle();
  const payload = item?.payload as { digest?: boolean; questions?: Array<{ id: string; choices?: string[]; recommended?: string }> } | null;
  if (item?.kind !== "question" || item.origin !== "agent" || !payload?.digest || !(item.addressed_to as string[]).includes(user.id)) return;
  const acceptAll = formData.get("acceptAll") === "1";
  const answers: Record<string, string> = {};
  for (const q of payload.questions ?? []) {
    const v = acceptAll ? q.recommended : String(formData.get(`q:${q.id}`) ?? "").trim().slice(0, 1000);
    if (!v) continue;
    if (q.choices && !q.choices.includes(v)) continue;
    answers[q.id] = v;
  }
  if (!Object.keys(answers).length) return;
  await supabase.rpc("needs_you_answer", { p_id: id, p_answer: { answers, ...(acceptAll ? { via: "accept-all" } : {}) } });
  revalidatePath(`/workspace/${packageId}/needs-you`);
}

/**
 * The assistant's proposed course change (§11.2): approving queues it as the approver's own operation, so the usual
 * check runs again when it is applied; the licence is the owner's only. Declining closes the item.
 */
export async function decideProposalAction(packageId: string, id: string, approve: boolean): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data: role } = await supabase.rpc("course_role", { p: packageId });
  const { data: item } = await supabase.from("needs_you").select("kind, payload").eq("id", id).eq("package_id", packageId).in("state", ["waiting", "shown"]).maybeSingle();
  const payload = item?.payload as { from?: string; action?: unknown } | null;
  const op = item?.kind === "approve" && payload?.from === "assistant" ? parseCourseOp(payload.action) : null;
  if (!op) return;
  const may = op.op === "setLicense" ? can((role ?? "none") as Role, "license.change") : can((role ?? "none") as Role, "edit.course-files");
  if (!may) return;
  if (approve) {
    try {
      if (!(await queueCourseOp(packageId, user.id, op, op.op, `item-${id}`))) return;
    } catch {
      return; // the same proposal queued by the other decider: theirs stands
    }
  }
  await supabase.rpc("needs_you_answer", { p_id: id, p_answer: { decision: approve ? "approved" : "declined" } });
  revalidatePath(`/workspace/${packageId}/needs-you`);
}
