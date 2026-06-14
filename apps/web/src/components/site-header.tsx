import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Auth-aware top navigation. Server component: renders Sign in for anonymous
 * visitors and Workspace + Sign out (with the GitHub handle) when signed in.
 * Any failure (e.g. Supabase not configured at build time) degrades to the
 * anonymous view rather than breaking the page.
 */
export async function SiteHeader() {
  let user = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Not configured or no session → treat as anonymous.
  }

  const handle =
    (user?.user_metadata?.["user_name"] as string | undefined) ??
    (user?.user_metadata?.["full_name"] as string | undefined);

  return (
    <header className="border-b border-edge/70 backdrop-blur supports-[backdrop-filter]:bg-canvas/70 sticky top-0 z-10">
      <nav className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-3.5">
        <a href="/" className="flex items-center gap-2.5" title="Alembic — part of the orz family">
          {/* orz family logo (static SVG asset) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/orz.svg" alt="orz" className="h-6 w-auto" />
          <span className="font-serif text-xl tracking-tight text-ink">
            Alembic
          </span>
        </a>
        <div className="flex items-center gap-5 text-sm text-muted">
          <a href="/portal" className="transition-colors hover:text-ink">
            Discover
          </a>
          {user ? (
            <>
              <a href="/workspace" className="transition-colors hover:text-ink">
                Workspace
              </a>
              {handle && <span className="text-faint">{handle}</span>}
              <form action="/auth/signout" method="post">
                <button type="submit" className="btn btn-ghost btn-sm">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <a href="/signin" className="transition-colors hover:text-ink">
              Sign in
            </a>
          )}
        </div>
      </nav>
    </header>
  );
}
