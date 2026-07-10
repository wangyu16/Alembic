import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * GitHub OAuth callback. Exchanges the code for a session.
 *
 * A SUSPENDED account fails right here, not in middleware: Supabase refuses to
 * issue a session for a banned user, so `exchangeCodeForSession` returns
 * `user_banned`. Sending them to "Sign-in did not complete. Please try again."
 * would be untrue — retrying can never work — so they land on `/suspended`,
 * which explains the situation and how to reach the site owner.
 *
 * Every other failure keeps the generic retry message: we should not narrate why
 * an arbitrary sign-in failed, and for genuinely transient errors retrying is
 * the right advice.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/workspace";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    // `code` is the documented discriminator; the message test is a fallback for
    // a GoTrue that reports the ban without one.
    if (error.code === "user_banned" || /banned/i.test(error.message)) {
      return NextResponse.redirect(`${origin}/suspended`);
    }
  }
  return NextResponse.redirect(`${origin}/signin?error=could-not-sign-in`);
}
