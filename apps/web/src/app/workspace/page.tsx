import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createPackageAction } from "./actions";

// Per-user page: never prerendered (and must not require env at build time).
export const dynamic = "force-dynamic";

const LICENSES = [
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "CC-BY-NC-4.0",
  "CC-BY-NC-SA-4.0",
  "CC0-1.0",
] as const;

export default async function WorkspacePage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const { data: packages } = await supabase
    .from("packages")
    .select("id, title, storage, created_at")
    .order("created_at", { ascending: false });

  const name =
    (user.user_metadata?.["full_name"] as string | undefined) ??
    (user.user_metadata?.["user_name"] as string | undefined) ??
    "there";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Workspace</h1>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            Hi {name} — your course packages live here.
          </p>
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="text-lg font-medium">Create a package</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Starts in your trial workspace — no GitHub needed. You can connect
          publishing later and take everything with you.
        </p>
        <form action={createPackageAction} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            name="title"
            required
            placeholder="e.g. Intro Acid–Base Chemistry"
            className="flex-1 rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          />
          <select
            name="license"
            defaultValue="CC-BY-4.0"
            className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          >
            {LICENSES.map((license) => (
              <option key={license} value={license}>
                {license}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-md bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Create
          </button>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-medium">Your packages</h2>
        {!packages?.length ? (
          <p className="mt-3 text-zinc-500">
            Nothing here yet — create your first package above.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {packages.map((pkg) => (
              <li key={pkg.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="font-medium">{pkg.title}</div>
                  <div className="text-xs text-zinc-500">
                    {pkg.storage === "sandbox" ? "Trial workspace" : "Published via GitHub"} ·
                    created {new Date(pkg.created_at).toLocaleDateString()}
                  </div>
                </div>
                <span className="text-sm text-zinc-400">Editor opens in M2</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
