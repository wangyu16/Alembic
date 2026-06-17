import { requireAdmin } from "@/lib/admin";
import { Participants, Reports, type Participant, type ReportItem } from "./admin-client";

export const dynamic = "force-dynamic";

async function count(
  service: NonNullable<Awaited<ReturnType<typeof requireAdmin>>["service"]>,
  table: string,
): Promise<number> {
  const { count } = await service.from(table).select("*", { count: "exact", head: true });
  return count ?? 0;
}

export default async function AdminPage() {
  const { service } = await requireAdmin();

  if (!service) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <h1 className="font-serif text-3xl tracking-tight text-ink">Admin</h1>
        <p className="mt-2 text-muted">
          The admin module needs the service key. Set <code>SUPABASE_SECRET_KEY</code> in the deployment.
        </p>
      </main>
    );
  }

  const [packages, registrations, events] = await Promise.all([
    count(service, "packages"),
    count(service, "portal_registrations"),
    count(service, "research_events"),
  ]);

  const { data: errorRows } = await service
    .from("research_events")
    .select("type, package_id, detail, occurred_at")
    .eq("type", "error.surfaced")
    .order("occurred_at", { ascending: false })
    .limit(15);

  const { data: profileRows } = await service
    .from("profiles")
    .select("id, github_username, portal_eligible, is_admin")
    .order("created_at", { ascending: false })
    .limit(100);
  const participants: Participant[] = (
    (profileRows as { id: string; github_username: string | null; portal_eligible: boolean; is_admin: boolean }[] | null) ?? []
  ).map((p) => ({ id: p.id, handle: p.github_username ?? "", portal_eligible: p.portal_eligible, is_admin: p.is_admin }));

  const { data: reportRows } = await service
    .from("portal_reports")
    .select("id, package_id, reason, created_at")
    .eq("status", "open")
    .order("created_at", { ascending: false });
  const reports = ((reportRows as ReportItem[] | null) ?? []);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <header>
        <h1 className="font-serif text-3xl tracking-tight text-ink">Admin &amp; operations</h1>
        <p className="mt-1 text-muted">Study readiness — status, research export, participants, reports.</p>
      </header>

      <section className="grid grid-cols-3 gap-3">
        {[
          { label: "Packages", value: packages },
          { label: "Listed (portal)", value: registrations },
          { label: "Research events", value: events },
        ].map((s) => (
          <div key={s.label} className="panel p-4">
            <div className="text-2xl font-semibold text-ink">{s.value}</div>
            <div className="text-xs text-muted">{s.label}</div>
          </div>
        ))}
      </section>

      <section>
        <h2 className="font-serif text-xl text-ink">Research export</h2>
        <p className="mt-1 text-sm text-muted">
          De-identified — pseudonymous participants, no GitHub identities or content.
        </p>
        <div className="mt-2 flex gap-3">
          <a href="/admin/export?format=csv" className="btn btn-ghost btn-sm">Download CSV</a>
          <a href="/admin/export?format=json" className="btn btn-ghost btn-sm">Download JSON</a>
        </div>
      </section>

      <section>
        <h2 className="font-serif text-xl text-ink">Recent errors</h2>
        {(errorRows as { package_id: string | null; detail: Record<string, unknown>; occurred_at: string }[] | null)?.length ? (
          <ul className="mt-2 divide-y divide-[var(--edge-soft)] text-xs text-muted">
            {(errorRows as { package_id: string | null; detail: Record<string, unknown>; occurred_at: string }[]).map((e, i) => (
              <li key={i} className="py-1.5">
                <span className="text-faint">{new Date(e.occurred_at).toLocaleString()}</span> ·{" "}
                {e.package_id ?? "—"} · {JSON.stringify(e.detail)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">No errors logged. ✓</p>
        )}
      </section>

      <section>
        <h2 className="font-serif text-xl text-ink">Participants</h2>
        <p className="mt-1 text-sm text-muted">Toggle portal-listing eligibility for study participants.</p>
        <div className="mt-2"><Participants participants={participants} /></div>
      </section>

      <section>
        <h2 className="font-serif text-xl text-ink">Reports</h2>
        <div className="mt-2"><Reports reports={reports} /></div>
      </section>
    </main>
  );
}
