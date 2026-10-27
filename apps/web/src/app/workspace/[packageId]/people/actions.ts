"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildInvitation } from "@alembic/notify";
import { appBaseUrl } from "@/lib/app-url";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isGithubLogin, newInvitationToken, webMailer } from "@/lib/invitations";

export interface InviteState {
  ok?: { login: string; link: string; emailed: boolean };
  error?: string;
}

const INVITE_DAYS = 14;

export async function inviteAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  const packageId = String(formData.get("packageId") ?? "");
  const login = String(formData.get("login") ?? "").trim().replace(/^@/, "");
  if (!isGithubLogin(login)) return { error: "That isn't a GitHub user name." };

  const { token, hash } = newInvitationToken();
  const { data: id, error } = await supabase.rpc("invite_member", { p: packageId, p_login: login, p_token_hash: hash, p_days: INVITE_DAYS });
  if (error || typeof id !== "string") return { error: "Only the course owner can invite." };
  const link = `${appBaseUrl()}/invite/${token}`;

  // Email it too when the person already uses Alembic and email is set up. Best effort.
  let emailed = false;
  const service = createServiceClient();
  const mailer = webMailer();
  if (service && mailer) {
    try {
      const { data: address } = await service.rpc("invitee_address", { p_invitation: id });
      if (typeof address === "string" && address) {
        const [{ data: course }, { data: me }] = await Promise.all([
          supabase.from("packages").select("title").eq("id", packageId).maybeSingle(),
          supabase.from("profiles").select("display_name, github_username").eq("id", user.id).maybeSingle(),
        ]);
        await mailer.send(buildInvitation({
          invitationId: id,
          to: address,
          inviterName: (me?.display_name as string | null) || (me?.github_username as string | null) || "A colleague",
          courseTitle: (course?.title as string | undefined) ?? "a course",
          role: "co-author",
          acceptUrl: link,
          expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
        }));
        emailed = true;
      }
    } catch {
      emailed = false;
    }
  }
  revalidatePath(`/workspace/${packageId}/people`);
  return { ok: { login, link, emailed } };
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const packageId = String(formData.get("packageId") ?? "");
  await supabase.rpc("revoke_invitation", { p_id: String(formData.get("id") ?? "") });
  revalidatePath(`/workspace/${packageId}/people`);
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const packageId = String(formData.get("packageId") ?? "");
  await supabase.rpc("remove_member", { p: packageId, p_user: String(formData.get("userId") ?? "") });
  revalidatePath(`/workspace/${packageId}/people`);
}
