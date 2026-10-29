import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "@/lib/supabase/env";
import { docPageCsp, isDocPage, newNonce } from "@/lib/csp";
import {
  PUBLIC_NOT_FOUND_REWRITE,
  isClientNavigation,
  isListed,
  listingTargetOf,
} from "@/lib/public-not-found";

function configuredEnv(): { url: string; anonKey: string } | null {
  try {
    return supabaseEnv();
  } catch {
    return null;
  }
}

/**
 * `/p/{id}` and `/portal/element/{id}`: an unknown course or shared file gets
 * the server-rendered site 404 (readable without JavaScript) instead of the
 * page's script-only not-found (`lib/public-not-found.ts`). No session work
 * here — these are public pages.
 */
async function publicNotFound(request: NextRequest): Promise<NextResponse | null> {
  const target = listingTargetOf(request.nextUrl.pathname);
  if (!target) return null;
  if (isClientNavigation(request.headers)) return NextResponse.next();
  const listed = await isListed(target, { env: configuredEnv() });
  if (listed === false) {
    return NextResponse.rewrite(new URL(PUBLIC_NOT_FOUND_REWRITE, request.url));
  }
  return NextResponse.next();
}

export async function middleware(request: NextRequest) {
  const publicAnswer = await publicNotFound(request);
  if (publicAnswer) return publicAnswer;

  const { url, anonKey } = supabaseEnv();
  // Course document pages get a per-request nonce and their CSP (K4 step 2). Next reads the
  // policy from the request to put the nonce on its own scripts; the page hands it to the editor.
  const csp = isDocPage(request.nextUrl.pathname) ? docPageCsp(newNonce(), url) : null;
  if (csp) {
    request.headers.set("x-nonce", /'nonce-([^']+)'/.exec(csp)![1]!);
    request.headers.set("content-security-policy", csp);
  }
  const withCsp = (r: NextResponse) => {
    if (csp) r.headers.set(process.env["ALEMBIC_CSP"] === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", csp);
    return r;
  };
  let response = NextResponse.next({ request });

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

  // Course files: the route checks the session or the signed address itself (the editor's preview sends no session).
  // The sync route also answers for itself: a request whose session ended gets "sign in again", not a page (RC.17).
  const isAsset = /^\/workspace\/[^/]+\/(?:asset\/|sync$|upload$)/.test(request.nextUrl.pathname);
  if (!user && request.nextUrl.pathname.startsWith("/workspace") && !isAsset) {
    // Come back to the same page after signing in (a session that ended mid-work); /signin re-validates it.
    const signin = new URL("/signin", request.url);
    signin.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return withCsp(NextResponse.redirect(signin));
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

  return withCsp(response);
}

export const config = {
  matcher: ["/workspace/:path*", "/auth/:path*", "/p/:packageId", "/portal/element/:docId"],
};
