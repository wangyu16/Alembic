import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRenderTheme } from "@/lib/theme";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Auth-aware top navigation. Server component: renders Sign in for anonymous
 * visitors and Workspace + Sign out (with the GitHub handle) when signed in.
 * Any failure (e.g. Supabase not configured at build time) degrades to the
 * anonymous view rather than breaking the page.
 *
 * One nav-item list drives both presentations: inline links from `sm:` up, a
 * CSS-only dropdown (<details>) below — so the nav can grow without a second
 * mobile pass.
 */
export async function SiteHeader() {
  let user = null;
  let isAdmin = false;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    user = data.user;
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .maybeSingle();
      isAdmin = Boolean((profile as { is_admin?: boolean } | null)?.is_admin);
    }
  } catch {
    // Not configured or no session → treat as anonymous.
  }

  const handle =
    (user?.user_metadata?.["user_name"] as string | undefined) ??
    (user?.user_metadata?.["full_name"] as string | undefined);

  const theme = await getRenderTheme();

  const items: Array<{ href: string; label: string }> = [
    { href: "/portal", label: "Discover" },
    ...(user ? [{ href: "/workspace", label: "Workspace" }] : []),
    { href: "/guide", label: "Guide" },
    ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
    ...(user ? [] : [{ href: "/signin", label: "Sign in" }]),
  ];

  return (
    <header className="border-b border-edge/70 backdrop-blur supports-[backdrop-filter]:bg-canvas/70 sticky top-0 z-10">
      <nav className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" title="Alembic — part of the orz family">
          {/* orz family logo (static SVG asset) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/orz.svg" alt="orz" className="h-6 w-auto" />
          <span className="font-serif text-xl tracking-tight text-ink">
            Alembic
          </span>
        </Link>
        <div className="flex items-center gap-3 text-sm whitespace-nowrap text-muted sm:gap-5">
          <ThemeToggle initial={theme} />

          {/* Inline links from sm: up */}
          <div className="hidden items-center gap-5 sm:flex">
            {items.map((it) => (
              <Link key={it.href} href={it.href} className="transition-colors hover:text-ink">
                {it.label}
              </Link>
            ))}
            {user && (
              <>
                {handle && <span className="hidden text-faint md:inline">{handle}</span>}
                <form action="/auth/signout" method="post">
                  <button type="submit" className="btn btn-ghost btn-sm">
                    Sign out
                  </button>
                </form>
              </>
            )}
          </div>

          {/* Collapsed dropdown below sm: (CSS-only) */}
          <details className="relative sm:hidden">
            <summary className="btn btn-ghost btn-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              Menu
            </summary>
            <div className="panel absolute right-0 z-20 mt-2 flex w-44 flex-col gap-0.5 p-2 shadow-lg">
              {items.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  className="rounded-md px-2 py-1.5 transition-colors hover:bg-elevated hover:text-ink"
                >
                  {it.label}
                </Link>
              ))}
              {user && (
                <form action="/auth/signout" method="post" className="border-t border-edge-soft pt-1">
                  <button
                    type="submit"
                    className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-elevated hover:text-ink"
                  >
                    Sign out{handle ? ` (${handle})` : ""}
                  </button>
                </form>
              )}
            </div>
          </details>
        </div>
      </nav>
    </header>
  );
}
