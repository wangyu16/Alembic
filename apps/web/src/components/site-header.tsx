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
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <nav className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-3">
        <a href="/" className="font-semibold tracking-tight">
          Alembic
        </a>
        <div className="flex items-center gap-4 text-sm">
          <a href="/portal" className="hover:underline">
            Discover
          </a>
          {user ? (
            <>
              <a href="/workspace" className="hover:underline">
                Workspace
              </a>
              {handle && <span className="text-zinc-500">{handle}</span>}
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="rounded-md border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <a href="/signin" className="hover:underline">
              Sign in
            </a>
          )}
        </div>
      </nav>
    </header>
  );
}
