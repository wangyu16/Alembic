"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  } else {
    return; // decided elsewhere (approvals, conflicts…), not from this page
  }
  await supabase.rpc("needs_you_answer", { p_id: id, p_answer: answer });
  revalidatePath(`/workspace/${packageId}/needs-you`);
}
