"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ACTIONS, readOneClick } from "@/lib/one-click";

export async function answerOneClickAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const r = readOneClick(token, user?.id ?? null);
  if (r.state !== "ok") redirect(`/act/${encodeURIComponent(token)}`);
  const { data: item } = await supabase.from("needs_you").select("package_id").eq("id", r.claim.item).maybeSingle();
  const { error } = await supabase.rpc("needs_you_answer", { p_id: r.claim.item, p_answer: ACTIONS[r.claim.action]!.answer });
  if (error) redirect(`/act/${encodeURIComponent(token)}?error=1`);
  redirect(item ? `/workspace/${encodeURIComponent(item.package_id as string)}` : "/workspace");
}
