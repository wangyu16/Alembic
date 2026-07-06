import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { learningResource } from "@alembic/renderer";
import type { License } from "@alembic/package-contract";
import { PortalBrowser, type PortalRegistration } from "@/components/portal-browser";
import { ElementAdapt, type AdaptTarget } from "./element-adapt";

export const dynamic = "force-dynamic";

type Registration = PortalRegistration & { registered_at: string };

export default async function PortalPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const scope = (await searchParams).scope === "elements" ? "elements" : "courses";
  const supabase = await createSupabaseServerClient();
  // Public read (RLS allows anyone); empty list if not configured.
  let registrations: Registration[] = [];
  try {
    const { data } = await supabase
      .from("portal_registrations")
      .select(
        "package_id, title, description, discipline, license, public_repo_url, site_url, registered_at, accessibility_status",
      )
      .order("registered_at", { ascending: false });
    registrations = (data as Registration[] | null) ?? [];
  } catch {
    /* index is best-effort */
  }

  // M30.2 — the portal consumes the SAME standard metadata (schema.org), not a
  // proprietary record: emit an ItemList of LearningResource so the discovery
  // hub is itself harvestable. Inner @context is dropped (it lives on the list).
  const itemListLd =
    registrations.length > 0
      ? JSON.stringify({
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: registrations.map((r, i) => {
            const { ["@context"]: _ctx, ...item } = learningResource({
              name: r.title,
              description: r.description || undefined,
              license: r.license as License,
              discipline: r.discipline || undefined,
              url: r.site_url || undefined,
              accessibility: r.accessibility_status,
            });
            return { "@type": "ListItem", position: i + 1, item };
          }),
        }).replace(/</g, "\\u003c")
      : null;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      {itemListLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: itemListLd }} />
      )}
      <header className="flex flex-col gap-3">
        <h1 className="font-serif text-4xl leading-[1.1] tracking-tight text-ink">
          <span aria-hidden className="mr-3 font-mono text-[0.7em] text-faint select-none">
            #
          </span>
          Discover.
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-muted text-pretty">
          Open educational resources shared by educators — visit them, adapt
          them, make them fit your students.
        </p>
      </header>

      {/* Two search scopes (document-model.md): whole courses, and individual
          shared elements (per-file "share this" → the documents registry). */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/portal"
          className={
            scope === "courses"
              ? "rounded-full bg-[var(--accent-soft)] px-3 py-1 font-medium text-[var(--accent)]"
              : "rounded-full border border-edge px-3 py-1 text-muted hover:text-ink"
          }
        >
          Courses
        </Link>
        <Link
          href="/portal?scope=elements"
          className={
            scope === "elements"
              ? "rounded-full bg-[var(--accent-soft)] px-3 py-1 font-medium text-[var(--accent)]"
              : "rounded-full border border-edge px-3 py-1 text-muted hover:text-ink"
          }
          title="Individual shared elements — figures, plots, explanations"
        >
          Elements
        </Link>
      </div>

      {scope === "elements" ? (
        <ElementsList />
      ) : registrations.length === 0 ? (
        <p className="text-muted">
          No courses have been listed yet — be the first: publish a package,
          then choose <span className="text-ink">List publicly</span>.
        </p>
      ) : (
        <PortalBrowser registrations={registrations} />
      )}
    </main>
  );
}

/**
 * Elements scope (P2): every file an educator explicitly shared ("share
 * this"). The registry's RLS is owner-only, so the public listing reads
 * through the service client; without it (dev, or key unset) the scope
 * degrades to an explanatory message rather than an error.
 */
async function ElementsList() {
  const service = createServiceClient();
  if (!service) {
    return (
      <p className="text-muted">
        Element search isn&rsquo;t available on this deployment yet.
      </p>
    );
  }

  const { data } = await service
    .from("documents")
    .select("doc_id, package_id, path, kind, description, alt_text")
    .eq("discoverable", true)
    .eq("tombstoned", false)
    .order("registered_at", { ascending: false })
    .limit(200);
  const docs =
    (data as Array<{
      doc_id: string;
      package_id: string;
      path: string;
      kind: string;
      description: string | null;
      alt_text: string | null;
    }> | null) ?? [];

  // The signed-in educator's own packages, offered as adaptation targets
  // ("Adapt into my package"). RLS scopes the select to packages they own, so
  // a signed-out visitor simply gets none and sees no adapt control.
  const session = await createSupabaseServerClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  let myPackages: AdaptTarget[] = [];
  if (user) {
    const { data: pkgs } = await session
      .from("packages")
      .select("id, title")
      .order("created_at", { ascending: false });
    myPackages = (pkgs as AdaptTarget[] | null) ?? [];
  }

  if (docs.length === 0) {
    return (
      <p className="text-muted">
        No shared elements yet — in your workspace, open a package&rsquo;s
        Assets and choose <span className="text-ink">Share this</span> on any
        figure, plot, or explanation worth reusing.
      </p>
    );
  }

  // Package titles for context (one query; index is small).
  const ids = [...new Set(docs.map((d) => d.package_id))];
  const { data: pkgs } = await service
    .from("packages")
    .select("id, title")
    .in("id", ids);
  const titles = new Map(
    ((pkgs as Array<{ id: string; title: string }> | null) ?? []).map((p) => [p.id, p.title]),
  );

  return (
    <ul className="divide-y divide-[var(--edge-soft)]">
      {docs.map((d) => (
        <li key={d.doc_id} className="flex items-center justify-between gap-3 py-4">
          <div className="min-w-0">
            <div className="truncate text-sm text-ink">
              {d.description ?? d.alt_text ?? d.path.split("/").pop()}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-faint">
              <span className="chip">{d.kind}</span>
              <span className="truncate">{titles.get(d.package_id) ?? "a course package"}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <ElementAdapt docId={d.doc_id} packages={myPackages} />
            <a href={`/d/${d.doc_id}`} target="_blank" rel="noreferrer" className="link text-sm">
              Open ↗
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}
