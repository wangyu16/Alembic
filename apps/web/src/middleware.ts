import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "@/lib/supabase/env";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = supabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Refresh the session and gate the workspace.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && request.nextUrl.pathname.startsWith("/workspace")) {
    const signin = new URL("/signin", request.url);
    return NextResponse.redirect(signin);
  }

  // Ban check (docs/specs/user-governance.md §2.4). A ban blocks new sign-ins
  // and refresh-token exchange, but an access token minted before the ban stays
  // valid until it expires (~1h). `getUser()` above validates that token and
  // succeeds for a banned user within that window — it does NOT surface
  // `banned_until` (that field is not returned by the auth /user endpoint). So
  // for a signed-in user we ask the database, which reads `auth.users`
  // authoritatively, via a single RPC. This runs only on the scoped matcher
  // (/workspace, /auth) and only when a session exists, so it is not on general
  // traffic. It is defence-in-depth for the residual-token window, not the
  // security boundary (that is GoTrue's refusal to refresh plus the RLS
  // backstop), so it fails OPEN on RPC error — the DB policies still refuse the
  // banned user's writes.
  if (user) {
    const { data: active, error } = await supabase.rpc("is_active_user");
    if (!error && active === false) {
      // Drop the residual session cookies, then send them somewhere with an
      // explanation rather than a dead end.
      await supabase.auth.signOut();
      const suspended = NextResponse.redirect(new URL("/suspended", request.url));
      for (const cookie of response.cookies.getAll()) {
        suspended.cookies.set(cookie);
      }
      return suspended;
    }
  }

  return response;
}

export const config = {
  matcher: ["/workspace/:path*", "/auth/:path*"],
};
