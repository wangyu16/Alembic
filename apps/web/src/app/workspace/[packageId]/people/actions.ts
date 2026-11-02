"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { buildInvitation } from "@alembic/notify";
import { lookupGithubUser } from "@alembic/github-bridge";
import { serverOrigin } from "@/lib/server-origin";
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

  // Invitations are matched on GitHub's numeric id, never the name (names change hands).
  let gh: Awaited<ReturnType<typeof lookupGithubUser>>;
  try {
    gh = await lookupGithubUser(login);
  } catch {
    return { error: "Couldn't reach GitHub to check that name. Please try again." };
  }
  if (!gh) return { error: "There is no GitHub user with that name." };

  const { token, hash } = newInvitationToken();
  const { data: id, error } = await supabase.rpc("invite_member", {
    p: packageId, p_login: gh.login, p_github_id: gh.id, p_token_hash: hash, p_days: INVITE_DAYS,
  });
  if (error || typeof id !== "string") return { error: "Only the course owner can invite." };
  const link = `${await serverOrigin()}/invite/${token}`;

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
  return { ok: { login: gh.login, link, emailed } };
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

/** Name a co-author deputy until the end of a chosen day (at most 6 months; the database checks). */
export async function nameDeputyAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const packageId = String(formData.get("packageId") ?? "");
  const until = String(formData.get("until") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return;
  await supabase.rpc("name_deputy", { p: packageId, p_user: String(formData.get("userId") ?? ""), p_until: `${until}T23:59:59Z` });
  revalidatePath(`/workspace/${packageId}/people`);
}

export async function endDeputyAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const packageId = String(formData.get("packageId") ?? "");
  await supabase.rpc("end_deputy", { p: packageId, p_user: String(formData.get("userId") ?? "") });
  revalidatePath(`/workspace/${packageId}/people`);
}

export async function leaveCourseAction(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("leave_course", { p: String(formData.get("packageId") ?? "") });
  redirect("/workspace");
}
