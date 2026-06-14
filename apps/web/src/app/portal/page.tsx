import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface Registration {
  package_id: string;
  title: string;
  description: string;
  discipline: string;
  license: string;
  public_repo_url: string;
  site_url: string;
  registered_at: string;
}

export default async function PortalPage() {
  const supabase = await createSupabaseServerClient();
  // Public read (RLS allows anyone); empty list if not configured.
  let registrations: Registration[] = [];
  try {
    const { data } = await supabase
      .from("portal_registrations")
      .select(
        "package_id, title, description, discipline, license, public_repo_url, site_url, registered_at",
      )
      .order("registered_at", { ascending: false });
    registrations = (data as Registration[] | null) ?? [];
  } catch {
    /* index is best-effort */
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Discover</h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          Open educational resources shared by educators on Alembic.
        </p>
      </header>

      {registrations.length === 0 ? (
        <p className="text-zinc-500">No packages have been listed yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {registrations.map((r) => (
            <li key={r.package_id} className="py-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-medium">{r.title}</h2>
                <span className="shrink-0 rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {r.license}
                </span>
              </div>
              {r.description && (
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {r.description}
                </p>
              )}
              <div className="mt-2 flex items-center gap-4 text-sm">
                <span className="text-xs uppercase tracking-wide text-zinc-400">
                  {r.discipline}
                </span>
                <a
                  href={r.site_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-700 hover:underline dark:text-blue-400"
                >
                  Visit site
                </a>
                <a
                  href={r.public_repo_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-zinc-600 hover:underline dark:text-zinc-400"
                >
                  Source
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
