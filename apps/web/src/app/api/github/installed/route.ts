import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { installationAccountLogin } from "@/lib/github";

/**
 * GitHub App post-install redirect target. GitHub appends installation_id,
 * setup_action, and the `state` we passed (the package id being published).
 * We store the installation id AND the account the App was installed on, then
 * return the educator to that package with publishing resumed — so the
 * two-step "connect, then publish" flow completes in one pass.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const installationId = searchParams.get("installation_id");
  const state = searchParams.get("state"); // the package id, if we set it

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/signin`);
  }

  if (installationId) {
    const id = Number(installationId);
    const update: { github_installation_id: number; github_username?: string } = {
      github_installation_id: id,
    };
    // Pin the repo owner to where the App was actually installed. Best-effort:
    // if the lookup fails we still save the id and fall back to the OAuth
    // username at publish time.
    try {
      const login = await installationAccountLogin(id);
      if (login) update.github_username = login;
    } catch {
      /* keep the OAuth username; publish has a fallback */
    }
    await supabase.from("profiles").update(update).eq("id", user.id);
  }

  // Return to the package and auto-resume publishing when we know which one.
  const target =
    state && /^pkg-/.test(state)
      ? `${origin}/workspace/${state}?publish=1`
      : `${origin}/workspace?connected=1`;
  return NextResponse.redirect(target);
}
