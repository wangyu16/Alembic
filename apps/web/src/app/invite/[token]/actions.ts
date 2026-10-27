"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { invitationHash, isInvitationToken } from "@/lib/invitations";

export async function acceptInvitationAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  if (!isInvitationToken(token)) redirect("/workspace");
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/invite/${token}`)}`);
  const { data: packageId, error } = await supabase.rpc("accept_invitation", { p_token_hash: invitationHash(token) });
  if (error || typeof packageId !== "string") redirect(`/invite/${token}?error=1`);
  redirect(`/workspace/${encodeURIComponent(packageId)}`);
}
