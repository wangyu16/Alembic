import Link from "next/link";
import { redirect } from "next/navigation";
import { can, WorkingManifestV3Schema, type Role } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { v3Enabled } from "@/lib/db";
import { courseRepo, textVersion } from "@/lib/course-v3";
import { requestPublishAction, setChapterModeAction, startPlanAction } from "./actions";
import { SubmitButton } from "../../submit-button";
import { RefreshWhile } from "./refresh-while";
import { siteView } from "@/lib/publish-view";

export const dynamic = "force-dynamic";

type Outcome =
  | { status: "committed"; decisions: Array<{ unit: string; result: "pass" | "kept"; why: string[] }>; published: string[]; anywayKeys?: Record<string, string>; unchanged?: boolean }
  | { status: "stopped" | "failed"; reason: string; drift?: string[] };

/** Publish (A11): what each chapter needs, the publisher's choices, and the last run. */
export default async function PublishPage({ params, searchParams }: { params: Promise<{ packageId: string }>; searchParams: Promise<{ m?: string }> }) {
  const { packageId } = await params;
  const { m: message } = await searchParams;
  if (!v3Enabled()) redirect(`/workspace/${packageId}`);
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/workspace/${packageId}/publish`)}`);
  const { data: roleRaw } = await supabase.rpc("course_role", { p: packageId });
  if (!roleRaw) redirect("/workspace");
  const role = roleRaw as Role;

  const [{ data: course }, { data: requests }, { data: approvals }, { data: runs }] = await Promise.all([
    supabase.from("packages").select("title, public_repo").eq("id", packageId).maybeSingle(),
    supabase.from("publish_requests").select("id, status, outcome, created_at, finished_at").eq("package_id", packageId).order("created_at", { ascending: false }).limit(1),
    supabase.from("approvals").select("part_path, version").eq("package_id", packageId),
    supabase.from("publish_runs").select("status, results").eq("package_id", packageId).in("status", ["committed", "site-built", "site-failed"]).order("committed_at", { ascending: false }).limit(1),
  ]);
  const lastRun = runs?.[0] as { status: string; results: { site?: { url?: string; error?: string; superseded?: boolean } } } | undefined;
  const site = siteView(lastRun);
  const c = await courseRepo(packageId);
  if (!c) return <main className="mx-auto max-w-2xl p-6"><p>This course's repository can't be reached right now.</p></main>;
  const head = await c.repo.head();
  const manifest = WorkingManifestV3Schema.parse(JSON.parse((await c.repo.readFile(head, "alembic.json")) ?? "null"));
  const approved = new Set((approvals ?? []).map((a) => `${a.part_path as string}@${a.version as string}`));

  const chapters = await Promise.all(manifest.chapters.map(async (ch) => {
    const parts = await Promise.all(["concepts", "assessment-support"].map(async (space) => {
      const path = `${space}/${ch.slug}.md`;
      const text = await c.repo.readFile(head, path);
      const version = text === null ? null : textVersion(text);
      return { path, version, present: text !== null, approved: version !== null && approved.has(`${path}@${version}`) };
    }));
    return { ...ch, parts };
  }));

  const last = requests?.[0] as { id: string; status: string; outcome: Outcome | null; finished_at: string | null } | undefined;
  const busy = last?.status === "queued" || last?.status === "running";
  // The website is built after Publish; that never blocks publishing again (review r2 M-C).
  const siteBuilding = site.kind === "building";
  const lastDecisions = last?.outcome?.status === "committed" ? last.outcome.decisions : [];
  const keptFor = (slug: string) => lastDecisions.find((d) => d.unit === `chapter:${slug}`);
  const anywayKeys = last?.outcome?.status === "committed" ? (last.outcome.anywayKeys ?? {}) : {};
  const pub = course?.public_repo as { owner: string; name: string } | null;
  const canPublish = can(role, "publish.later");
  const canApprove = can(role, "approve.plan");
  const canMode = can(role, "edit.course-files");

  return (
    <main className="mx-auto max-w-3xl p-6">
      <RefreshWhile active={busy || siteBuilding} everyMs={busy ? 3000 : 10_000} />
      <p className="text-sm"><Link href={`/workspace/${packageId}/course`}>← {(course?.title as string | undefined) ?? "Course"}</Link></p>
      <h1 className="mt-2 text-2xl font-semibold">Publish</h1>
      <p className="mt-1 text-sm text-gray-600">
        Publishing copies the chapters that are ready to the course's public copy
        {pub ? <> (<a className="underline" href={`https://github.com/${pub.owner}/${pub.name}`}>{pub.owner}/{pub.name}</a>)</> : " (made on the first Publish)"}.
        A chapter is ready when it isn't a draft, its course plan is approved, and the checks pass.
      </p>
      {message ? <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm">{message}</p> : null}
      {site.kind !== "none" ? (
        <div className="mt-3 text-sm">
          Website: {site.kind === "live" ? <><a className="underline" href={site.url}>{site.url}</a>{site.note ? <> ({site.note})</> : null}</>
            : site.kind === "failed" ? <>not updated — {site.error}{site.problems.length ? (
              <ul className="mt-1 list-disc pl-5" data-testid="site-problems">{site.problems.map((x) => <li key={x}>{x}</li>)}</ul>
            ) : null}</>
            : site.kind === "updated" ? "updated"
            : "being built…"}
        </div>
      ) : null}

      <section className="mt-5 rounded border p-3">
        <h2 className="font-medium">Last Publish</h2>
        {!last ? <p className="mt-1 text-sm">Not published yet.</p> : busy ? (
          <p className="mt-1 text-sm">Publishing… this page updates by itself.</p>
        ) : last.outcome?.status === "committed" ? (
          <div className="mt-1 text-sm">
            <p>Published {last.finished_at ? new Date(last.finished_at).toLocaleString() : ""}{last.outcome.unchanged ? " (nothing had changed since the last Publish)" : ""}. Public chapters: {last.outcome.published.length ? last.outcome.published.join(", ") : "none yet"}.</p>
            <ul className="mt-2 list-disc pl-5">
              {last.outcome.decisions.filter((d) => d.result === "kept").map((d) => (
                <li key={d.unit}>{d.unit.replace(/^chapter:/, "Chapter ")} stayed as before: {d.why.join("; ")}</li>
              ))}
            </ul>
          </div>
        ) : last.outcome ? (
          <p className="mt-1 text-sm">Publish stopped: {last.outcome.reason}</p>
        ) : null}
      </section>

      <form action={requestPublishAction.bind(null, packageId)} className="mt-5">
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th className="py-1">Chapter</th><th>Status</th><th>Course plan</th><th /></tr></thead>
          <tbody className="divide-y">
            {chapters.map((ch) => {
              const missing = ch.parts.some((p) => !p.present);
              const toApprove = ch.parts.filter((p) => p.present && !p.approved);
              const kept = keptFor(ch.slug);
              const findings = kept?.why.filter((w) => w !== "Draft chapter" && w !== "Course plan not approved") ?? [];
              return (
                <tr key={ch.slug} className="align-top">
                  <td className="py-2">{ch.title}</td>
                  <td className="py-2">
                    {ch.mode === "draft" ? "Draft" : "Ready"}
                    {canMode ? (
                      <button className="ml-2 underline" formAction={setChapterModeAction.bind(null, packageId, ch.slug, ch.mode === "draft" ? "package" : "draft")}>
                        {ch.mode === "draft" ? "Mark ready" : "Back to draft"}
                      </button>
                    ) : null}
                  </td>
                  <td className="py-2">
                    {missing ? (
                      <>Not written yet <button className="ml-1 underline" formAction={startPlanAction.bind(null, packageId, ch.slug)}>Start it</button></>
                    ) : toApprove.length === 0 ? "Approved" : canApprove ? (
                      <label className="flex items-start gap-1">
                        <input type="checkbox" name="approve" value={toApprove.map((p) => `${p.path}@${p.version}`).join("|")} className="mt-1" />
                        <span>Approve the course plan as it is now ({ch.parts.map((p) => <Link key={p.path} prefetch={false} className="underline" href={`/workspace/${packageId}/doc/${p.path}`}>{p.path.split("/")[0] === "concepts" ? "concept map" : "assessment guide"}</Link>).reduce<React.ReactNode[]>((a, x, i) => (i ? [...a, " and ", x] : [x]), [])})</span>
                      </label>
                    ) : "Waiting for the owner or deputy"}
                  </td>
                  <td className="py-2">
                    {findings.length && anywayKeys[ch.slug] && can(role, "publish.anyway") ? (
                      <label className="flex items-start gap-1" title={findings.join("; ")}>
                        <input type="checkbox" name="anyway" value={`${ch.slug}@${anywayKeys[ch.slug]}`} className="mt-1" /> <span>Publish anyway</span>
                      </label>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {canPublish ? (
          <div className="mt-4">{busy
            ? <button type="button" disabled className="rounded bg-gray-300 px-4 py-2">Publishing…</button>
            : <SubmitButton pending="Starting…" className="rounded bg-black px-4 py-2 text-white">Publish</SubmitButton>}</div>
        ) : <p className="mt-4 text-sm">Only the owner or deputy publishes.</p>}
      </form>
    </main>
  );
}
