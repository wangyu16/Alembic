import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * GitHub App post-install redirect target. GitHub appends installation_id
 * (and setup_action); we store it on the educator's profile so later
 * publishing can authenticate as that installation.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const installationId = searchParams.get("installation_id");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/signin`);
  }

  if (installationId) {
    await supabase
      .from("profiles")
      .update({ github_installation_id: Number(installationId) })
      .eq("id", user.id);
  }
  return NextResponse.redirect(`${origin}/workspace?connected=1`);
}
