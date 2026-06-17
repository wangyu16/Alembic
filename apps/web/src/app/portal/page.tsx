import { createSupabaseServerClient } from "@/lib/supabase/server";
import { learningResource } from "@alembic/renderer";
import type { License } from "@alembic/package-contract";

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
  accessibility_status: "pass" | "warn" | "fail" | "unknown";
}

const A11Y_BADGE: Record<
  Registration["accessibility_status"],
  { label: string; className: string } | null
> = {
  pass: { label: "Accessible", className: "text-ok" },
  warn: { label: "Accessibility: minor issues", className: "text-warn" },
  fail: { label: "Accessibility: needs work", className: "text-danger" },
  unknown: null,
};

export default async function PortalPage() {
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
      <header>
        <h1 className="font-serif text-3xl tracking-tight text-ink">Discover</h1>
        <p className="mt-1 text-muted">
          Open educational resources shared by educators on Alembic.
        </p>
      </header>

      {registrations.length === 0 ? (
        <p className="text-muted">No packages have been listed yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--edge-soft)]">
          {registrations.map((r) => (
            <li key={r.package_id} className="py-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-serif text-xl text-ink">{r.title}</h2>
                <span className="chip shrink-0">{r.license}</span>
              </div>
              {r.description && (
                <p className="mt-1 text-sm leading-relaxed text-muted">
                  {r.description}
                </p>
              )}
              <div className="mt-2 flex items-center gap-4 text-sm">
                <span className="text-xs text-faint">{r.discipline}</span>
                {A11Y_BADGE[r.accessibility_status] && (
                  <span className={`text-xs ${A11Y_BADGE[r.accessibility_status]!.className}`}>
                    {A11Y_BADGE[r.accessibility_status]!.label}
                  </span>
                )}
                <a href={r.site_url} target="_blank" rel="noreferrer" className="link">
                  Visit site
                </a>
                <a
                  href={r.public_repo_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted hover:text-ink"
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
