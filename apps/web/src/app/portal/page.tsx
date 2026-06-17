import { createSupabaseServerClient } from "@/lib/supabase/server";
import { learningResource } from "@alembic/renderer";
import type { License } from "@alembic/package-contract";
import { PortalBrowser, type PortalRegistration } from "@/components/portal-browser";

export const dynamic = "force-dynamic";

type Registration = PortalRegistration & { registered_at: string };

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
        <PortalBrowser registrations={registrations} />
      )}
    </main>
  );
}
