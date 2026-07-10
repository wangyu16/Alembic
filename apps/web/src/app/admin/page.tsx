import Link from "next/link";
import { summarizeUsage, type InvocationRow } from "@alembic/research-events";
import { requireAdmin } from "@/lib/admin";
import { Reports, type ReportItem } from "./admin-client";

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

  // Handle lookup for the AI-usage table (user id → GitHub handle).
  const { data: profileRows } = await service
    .from("profiles")
    .select("id, github_username")
    .order("created_at", { ascending: false })
    .limit(100);
  const handleOf = new Map(
    ((profileRows as { id: string; github_username: string | null }[] | null) ?? []).map(
      (p) => [p.id, p.github_username ?? ""] as const,
    ),
  );

  const { data: reportRows } = await service
    .from("portal_reports")
    .select("id, package_id, reason, created_at")
    .eq("status", "open")
    .order("created_at", { ascending: false });
  const reports = ((reportRows as ReportItem[] | null) ?? []);

  // AI usage (M36): token aggregates only — never prompts/outputs.
  const { data: usageRows } = await service
    .from("ai_invocations")
    .select("user_id, kind, input_tokens, output_tokens");
  const usage = summarizeUsage((usageRows as InvocationRow[] | null) ?? []);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="font-serif text-3xl tracking-tight text-ink">Admin &amp; operations</h1>
          <p className="mt-1 text-muted">Study readiness — status, research export, reports.</p>
        </div>
        <Link href="/admin/users" className="btn btn-ghost btn-sm">
          Users →
        </Link>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
        <h2 className="font-serif text-xl text-ink">AI usage</h2>
        <p className="mt-1 text-sm text-muted">
          {usage.totalCalls.toLocaleString()} calls · {usage.totalTokens.toLocaleString()} tokens
          ({usage.totalInputTokens.toLocaleString()} in / {usage.totalOutputTokens.toLocaleString()} out).
          Per-user budgets are enforced live (M16); per-institution quotas are a follow-up.
        </p>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-faint">By task</div>
            <ul className="mt-1 text-sm text-muted">
              {usage.byKind.slice(0, 8).map((k) => (
                <li key={k.kind} className="flex justify-between gap-2">
                  <span className="truncate">{k.kind}</span>
                  <span className="shrink-0 text-faint">{k.tokens.toLocaleString()}</span>
                </li>
              ))}
              {usage.byKind.length === 0 && <li className="text-faint">No AI usage yet.</li>}
            </ul>
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-faint">Top participants</div>
            <ul className="mt-1 text-sm text-muted">
              {usage.byUser.slice(0, 8).map((u) => (
                <li key={u.userId} className="flex justify-between gap-2">
                  <span className="truncate">{handleOf.get(u.userId) || u.userId.slice(0, 8)}</span>
                  <span className="shrink-0 text-faint">{u.tokens.toLocaleString()}</span>
                </li>
              ))}
              {usage.byUser.length === 0 && <li className="text-faint">—</li>}
            </ul>
          </div>
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
        <h2 className="font-serif text-xl text-ink">Reports</h2>
        <div className="mt-2"><Reports reports={reports} /></div>
      </section>
    </main>
  );
}
