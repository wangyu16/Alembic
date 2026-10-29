import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createPackageAction } from "./actions";
import { connectGithubAction, createCourseV3Action } from "./v3-actions";
import { SubmitButton } from "./submit-button";
import { v3Enabled } from "@/lib/db";
import { reconcileArchivedPackages } from "./lifecycle-actions";
import { PackageActions } from "./_components/package-actions";
import { PackageSnapshots } from "./_components/package-snapshots";
import { ArchivedPackages } from "./_components/archived-packages";

// Per-user page: never prerendered (and must not require env at build time).
export const dynamic = "force-dynamic";

const LICENSES = [
  "CC-BY-4.0",
  "CC-BY-SA-4.0",
  "CC-BY-NC-4.0",
  "CC-BY-NC-SA-4.0",
  "CC0-1.0",
  "ALL-RIGHTS-RESERVED",
] as const;

// Short option labels (kept compact so the select doesn't stretch the row); the
// value stays the manifest license id. "Private" = all-rights-reserved (unlisted).
const LICENSE_OPTION_LABEL: Record<(typeof LICENSES)[number], string> = {
  "CC-BY-4.0": "CC BY 4.0",
  "CC-BY-SA-4.0": "CC BY-SA 4.0",
  "CC-BY-NC-4.0": "CC BY-NC 4.0",
  "CC-BY-NC-SA-4.0": "CC BY-NC-SA 4.0",
  "CC0-1.0": "CC0 1.0",
  "ALL-RIGHTS-RESERVED": "Private (all rights reserved)",
};

const UNIT_TERMS = ["chapter", "module", "lesson", "unit", "week"] as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const V3_NOTICE: Record<string, string> = {
  missing: "Give the course a title and choose a licence.",
  connect: "Connect GitHub first, then create the course again.",
  connected: "GitHub is connected. You can create the course now.",
  "not-yours": "That GitHub installation belongs to another account. Sign in with the account the App is installed on.",
  unconfigured: "GitHub isn't set up on this server.",
  failed: "The course couldn't be created. Please try again.",
};

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<{ v3?: string }> }) {
  const { v3 } = await searchParams;
  const v3On = v3Enabled();
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
    .select("id, title, storage, created_at, archived_at, schema:manifest->schemaVersion")
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
      <header className="flex flex-col gap-3">
        <h1 className="font-serif text-4xl leading-[1.1] tracking-tight text-ink">
          <span aria-hidden className="mr-3 font-mono text-[0.7em] text-faint select-none">
            #
          </span>
          Workspace.
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-muted">
          Hi {name} — your course packages live here.
        </p>
        <nav className="flex gap-4 text-sm" aria-label="Your account">
          <Link href="/workspace/credit" className="underline">AI credit</Link>
          <Link href="/workspace/settings" className="underline">Settings</Link>
        </nav>
      </header>

      {v3On ? (
        <section className="panel p-6">
          <h2 className="text-lg font-medium text-ink">New course (new workspace, testing)</h2>
          <p className="mt-1 text-sm text-muted">Keeps the course privately in your own GitHub account; its documents open in the editor and save to the course on their own.</p>
          {v3 && V3_NOTICE[v3] ? <p className={`mt-2 text-sm ${v3 === "connected" ? "text-green-700" : "text-red-700"}`} role={v3 === "connected" ? "status" : "alert"}>{V3_NOTICE[v3]}</p> : null}
          {v3 === "connect" || v3 === "not-yours" ? (
            <form action={connectGithubAction} className="mt-2">
              <SubmitButton className="btn btn-ghost btn-sm" pending="Connecting…">Connect GitHub</SubmitButton>
              <span className="ml-2 text-sm text-muted">Finds the Alembic App on your own GitHub account, or takes you to install it.</span>
            </form>
          ) : null}
          <form action={createCourseV3Action} className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <input name="title" required placeholder="Course title" className="input flex-1" />
            <input name="chapter" placeholder="First chapter (optional)" className="input flex-1" />
            <select name="license" defaultValue="CC-BY-4.0" className="input">
              {LICENSES.map((l) => <option key={l} value={l}>{LICENSE_OPTION_LABEL[l]}</option>)}
            </select>
            <SubmitButton className="btn btn-primary" pending="Creating… (about 15 seconds)">Create course</SubmitButton>
          </form>
        </section>
      ) : null}

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
          <select
            name="unitTerm"
            defaultValue="chapter"
            title="What this course calls its units"
            className="field min-w-0"
          >
            {UNIT_TERMS.map((t) => (
              <option key={t} value={t}>
                {cap(t)}s
              </option>
            ))}
          </select>
          <select
            name="license"
            defaultValue="CC-BY-4.0"
            title="License — an open license to share, or Private (all rights reserved) to keep it to yourself"
            className="field min-w-0"
          >
            {LICENSES.map((license) => (
              <option key={license} value={license}>
                {LICENSE_OPTION_LABEL[license]}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-primary">
            Create
          </button>
        </form>
        <p className="mt-4 border-t border-edge pt-4 text-sm text-muted">
          Built a package offline (e.g. with an AI agent)?{" "}
          <span className="text-ink">Create the course above and publish it</span>,
          then open it and upload your <code className="text-xs">.zip</code> to fill
          it in — images and all.
        </p>
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
              <li key={pkg.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 basis-48">
                  <div className="truncate font-medium text-ink">{pkg.title}</div>
                  <div className="text-xs text-faint">
                    {pkg.storage === "sandbox"
                      ? "Trial — saved only in Alembic, not yet on your GitHub"
                      : "Published via GitHub"} ·
                    created {new Date(pkg.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link href={(pkg as { schema?: unknown }).schema === 3 ? `/workspace/${pkg.id}/course` : `/workspace/${pkg.id}/edit`} className="btn btn-ghost btn-sm">
                    {(pkg as { schema?: unknown }).schema === 3 ? "Open course" : "Open editor"}
                  </Link>
                  <Link href={`/workspace/${pkg.id}/needs-you`} className="btn btn-ghost btn-sm">
                    Needs you
                  </Link>
                  <Link href={`/workspace/${pkg.id}/people`} className="btn btn-ghost btn-sm">
                    People
                  </Link>
                  {pkg.storage === "github" && (
                    <PackageSnapshots packageId={pkg.id} />
                  )}
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
