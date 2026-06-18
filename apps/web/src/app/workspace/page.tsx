import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createPackageAction } from "./actions";
import { reconcileArchivedPackages } from "./lifecycle-actions";
import { PackageActions } from "./_components/package-actions";
import { ArchivedPackages } from "./_components/archived-packages";

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

  // Purge any archived packages whose repos the educator deleted on GitHub.
  // Best-effort: never blocks the page if GitHub is slow or disconnected.
  let purged: string[] = [];
  try {
    purged = await reconcileArchivedPackages();
  } catch {
    purged = [];
  }

  const { data: allPackages } = await supabase
    .from("packages")
    .select("id, title, storage, created_at, archived_at")
    .order("created_at", { ascending: false });

  const visible = (allPackages ?? []).filter((p) => !purged.includes(p.id));
  const packages = visible.filter((p) => p.archived_at === null);
  const archived = visible
    .filter((p) => p.archived_at !== null)
    .map((p) => ({ id: p.id, title: p.title, archivedAt: p.archived_at as string }));

  const name =
    (user.user_metadata?.["full_name"] as string | undefined) ??
    (user.user_metadata?.["user_name"] as string | undefined) ??
    "there";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-12">
      <header>
        <h1 className="font-serif text-3xl tracking-tight text-ink">Workspace</h1>
        <p className="mt-1 text-muted">
          Hi {name} — your course packages live here.
        </p>
      </header>

      <section className="panel p-6">
        <h2 className="text-lg font-medium text-ink">Create a package</h2>
        <p className="mt-1 text-sm text-muted">
          Starts in your trial workspace — no GitHub needed. You can connect
          publishing later and take everything with you.
        </p>
        <form action={createPackageAction} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            name="title"
            required
            placeholder="e.g. Intro Acid–Base Chemistry"
            className="field flex-1"
          />
          <select name="license" defaultValue="CC-BY-4.0" className="field">
            {LICENSES.map((license) => (
              <option key={license} value={license}>
                {license}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary">
            Create
          </button>
        </form>
      </section>

      <section>
        <h2 className="text-lg font-medium text-ink">Your packages</h2>
        {!packages?.length ? (
          <p className="mt-3 text-muted">
            Nothing here yet — create your first package above.
          </p>
        ) : (
          <ul className="panel mt-3 divide-y divide-[var(--edge-soft)]">
            {packages.map((pkg) => (
              <li key={pkg.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-ink">{pkg.title}</div>
                  <div className="text-xs text-faint">
                    {pkg.storage === "sandbox" ? "Trial workspace" : "Published via GitHub"} ·
                    created {new Date(pkg.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link href={`/workspace/${pkg.id}`} className="btn btn-ghost btn-sm">
                    Open editor
                  </Link>
                  <PackageActions
                    packageId={pkg.id}
                    title={pkg.title}
                    storage={pkg.storage}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ArchivedPackages packages={archived} />
    </main>
  );
}
