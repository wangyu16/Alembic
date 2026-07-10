import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { installationAccountLogin } from "@/lib/github";

/**
 * GitHub App post-install redirect target. GitHub appends installation_id,
 * setup_action, and the `state` we passed (the package id being published).
 * We store the installation id AND the account the App was installed on, then
 * return the educator to that package with publishing resumed — so the
 * two-step "connect, then publish" flow completes in one pass.
 *
 * This is the only writer of `profiles.github_installation_id`, and it uses the
 * SERVICE client: migration 0016 revoked column UPDATE from `authenticated`, so
 * a user can no longer point their profile at somebody else's installation (and
 * thereby borrow a GitHub App token for that account's repositories). The write
 * is safe here because `user.id` comes from the verified session, never from the
 * request. See docs/specs/user-governance.md §0.
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
    const service = createServiceClient();
    if (!service) {
      // Fail closed and visibly: without the service key we cannot record the
      // installation, and silently redirecting would leave the educator on a
      // publish screen that never works.
      console.error("github/installed: SUPABASE_SECRET_KEY is not configured");
      return NextResponse.redirect(`${origin}/workspace?connected=0`);
    }
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
    await service.from("profiles").update(update).eq("id", user.id);
  }

  // Return to the package and auto-resume publishing when we know which one.
  // Land on the new editor (the default "Open editor"); its publish header runs
  // the same auto-resume on ?publish=1.
  const target =
    state && /^pkg-/.test(state)
      ? `${origin}/workspace/${state}/edit?publish=1`
      : `${origin}/workspace?connected=1`;
  return NextResponse.redirect(target);
}
