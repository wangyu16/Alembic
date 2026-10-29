import { GithubBusy, githubBusy } from "@/lib/github-busy";
import Link from "next/link";
import { redirect } from "next/navigation";
import { can, WorkingManifestV3Schema, type Role } from "@alembic/package-contract";
import { unitOf } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { v3Enabled } from "@/lib/db";
import { blobsAt, courseRepo, textAtCommit, versionsAt } from "@/lib/course-v3";
import { LocalTime } from "@/lib/local-time";
import { approvePlanNowAction, requestPublishAction, setChapterModeAction, startPlanAction } from "./actions";
import { SubmitButton } from "../../submit-button";
import { RefreshWhile } from "./refresh-while";
import { siteView } from "@/lib/publish-view";

export const dynamic = "force-dynamic";

type Outcome =
  | { status: "committed"; decisions: Array<{ unit: string; result: "pass" | "kept"; why: string[] }>; published: string[]; anywayKeys?: Record<string, string>; unchanged?: boolean }
  | { status: "stopped" | "failed"; reason: string; drift?: string[] };

/** Publish (A11): what each chapter needs, the publisher's choices, and the last run. */
async function PublishPageInner({ params, searchParams }: { params: Promise<{ packageId: string }>; searchParams: Promise<{ m?: string }> }) {
  const { packageId } = await params;
  const { m: message } = await searchParams;
  if (!v3Enabled()) redirect(`/workspace/${packageId}`);
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/workspace/${packageId}/publish`)}`);
  const { data: roleRaw } = await supabase.rpc("course_role", { p: packageId });
  if (!roleRaw) redirect("/workspace");
  const role = roleRaw as Role;

  const [{ data: course }, { data: requests }, { data: approvals }, { data: runs }, { data: pendingRows }, { data: publishedRows }] = await Promise.all([
    supabase.from("packages").select("title, public_repo").eq("id", packageId).maybeSingle(),
    supabase.from("publish_requests").select("id, status, outcome, created_at, finished_at").eq("package_id", packageId).order("created_at", { ascending: false }).limit(1),
    supabase.from("approvals").select("part_path, version").eq("package_id", packageId),
    supabase.from("publish_runs").select("status, results").eq("package_id", packageId).in("status", ["committed", "site-built", "site-failed"]).order("committed_at", { ascending: false }).limit(1),
    // Chapter status changes still on their way into the course (RC.15): shown as "saving", not as the old state.
    supabase.from("write_queue").select("idem_key, status, finished_at").eq("package_id", packageId).like("idem_key", "system:mode:%")
      .or(`status.in.(queued,processing,retry),finished_at.gt.${new Date(Date.now() - 15 * 60_000).toISOString()}`),
    supabase.from("published_files").select("path, blob_sha, unit").eq("package_id", packageId),
  ]);
  // Status changes still on their way (shown as saving; no other change is offered meanwhile, so none is
  // refused for being made on an older version), and any refused in the last minutes (said, not lost).
  const pendingMode = new Map<string, string>();
  const refusedMode: string[] = [];
  for (const r of (pendingRows ?? []) as Array<{ idem_key: string; status: string }>) {
    const m = /^system:mode:([a-z0-9-]+):(draft|package):/.exec(r.idem_key);
    if (!m) continue;
    if (["queued", "processing", "retry"].includes(r.status)) pendingMode.set(m[1]!, m[2]!);
    else if (r.status === "refused" || r.status === "failed") refusedMode.push(m[1]!);
  }
  const lastRun = runs?.[0] as { status: string; results: { site?: { url?: string; error?: string; superseded?: boolean } } } | undefined;
  const site = siteView(lastRun);
  const c = await courseRepo(packageId);
  if (!c) return <main className="mx-auto max-w-2xl p-6"><p>This course's repository can't be reached right now.</p></main>;
  const head = await c.repo.head();
  let manifest: ReturnType<typeof WorkingManifestV3Schema.parse>;
  try {
    manifest = WorkingManifestV3Schema.parse(JSON.parse((await textAtCommit(c.repo, `${c.owner}/${c.name}`, head, "alembic.json")) ?? "null"));
  } catch (e) {
    if (githubBusy(e)) throw e; // the busy page (RC.12)
    return <main className="mx-auto max-w-2xl p-6"><p>The course&apos;s settings file (alembic.json) can&apos;t be read, so it can&apos;t be published until it is fixed.</p></main>;
  }
  const approved = new Set((approvals ?? []).map((a) => `${a.part_path as string}@${a.version as string}`));

  // Plan versions from one tree listing, cached by blob id (RC.8): a warm render reads no plan file.
  const planPaths = manifest.chapters.flatMap((ch) => [`concepts/${ch.slug}.md`, `assessment-support/${ch.slug}.md`]);
  const versions = await versionsAt(c.client, { owner: c.owner, repo: c.name }, head, planPaths);
  // What a Publish would change, chapter by chapter (RC.24): any of its files differing from what was published.
  const blobs = await blobsAt(c.client, { owner: c.owner, repo: c.name }, head);
  const published = new Map(((publishedRows ?? []) as Array<{ path: string; blob_sha: string; unit: string }>).map((r) => [r.path, r]));
  const everPublished = new Set([...published.values()].filter((r) => r.unit.startsWith("chapter:")).map((r) => r.unit.slice(8)));
  // Which files belong to which chapter: the publisher's own rule (any name under the chapter's slots and folders).
  const slugs = new Set(manifest.chapters.map((ch) => ch.slug));
  const changed = new Set<string>();
  for (const [p, sha] of blobs) {
    const u = unitOf(p, slugs, everPublished);
    if (u.kind === "chapter" && published.get(p)?.blob_sha !== sha) changed.add(u.slug);
  }
  for (const [p, r] of published) if (r.unit.startsWith("chapter:") && !blobs.has(p)) changed.add(r.unit.slice(8)); // deleted since
  const editedSincePublish = (slug: string) => everPublished.has(slug) && changed.has(slug);
  const chapters = manifest.chapters.map((ch) => {
    const parts = ["concepts", "assessment-support"].map((space) => {
      const path = `${space}/${ch.slug}.md`;
      const version = versions.get(path) ?? null;
      return { path, version, present: version !== null, approved: version !== null && approved.has(`${path}@${version}`) };
    });
    return { ...ch, parts };
  });

  const last = requests?.[0] as { id: string; status: string; outcome: Outcome | null; finished_at: string | null } | undefined;
  const busy = last?.status === "queued" || last?.status === "running";
  // The website is built after Publish; that never blocks publishing again (review r2 M-C).
  const siteBuilding = site.kind === "building";
  const titleOf = new Map(manifest.chapters.map((ch) => [ch.slug, ch.title]));
  const unitName = (unit: string) => (unit.startsWith("chapter:") ? (titleOf.get(unit.slice(8)) ?? unit.slice(8)) : unit === "course" ? "Course files" : unit.replace(/^asset:/, "Figure "));
  const lastDecisions = last?.outcome?.status === "committed" ? last.outcome.decisions : [];
  const keptFor = (slug: string) => lastDecisions.find((d) => d.unit === `chapter:${slug}`);
  const anywayKeys = last?.outcome?.status === "committed" ? (last.outcome.anywayKeys ?? {}) : {};
  const pub = course?.public_repo as { owner: string; name: string } | null;
  const canPublish = can(role, "publish.later");
  const canApprove = can(role, "approve.plan");
  const canMode = can(role, "edit.course-files");

  return (
    <main className="mx-auto max-w-3xl p-6">
      <RefreshWhile active={busy || siteBuilding || pendingMode.size > 0} everyMs={busy || pendingMode.size ? 5000 : 15_000} />
      <p className="text-sm"><Link prefetch={false} href={`/workspace/${packageId}/course`}>← {(course?.title as string | undefined) ?? "Course"}</Link></p>
      <h1 className="mt-2 text-2xl font-semibold">Publish</h1>
      <p className="mt-1 text-sm text-gray-600">
        Publishing copies the chapters that are ready to the course&apos;s public copy{" "}
        {pub ? <>(<a className="underline" href={`https://github.com/${pub.owner}/${pub.name}`}>on GitHub</a>)</> : "(made on the first Publish)"}{" "}and updates its website.
        A chapter is ready when it isn&apos;t a draft, its course plan is approved, and the checks pass (nothing in it repeats an
        answer key or copies a source). A draft chapter stays on the website as it was last published (or isn&apos;t there yet); its new edits wait.
      </p>
      {message ? <p className="mt-3 rounded border border-amber-400 bg-amber-100 p-2 text-sm text-amber-950" role="status">{message}</p> : null}
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

      {refusedMode.length ? (
        <p className="mt-3 rounded border border-amber-400 bg-amber-100 p-2 text-sm text-amber-950" role="status">
          {`A change to ${[...new Set(refusedMode)].map((s2) => titleOf.get(s2) ?? s2).join(", ")} couldn't be saved because the course's settings changed at the same time. Please make it again.`}
        </p>
      ) : null}
      <section className="mt-5 rounded border p-3">
        <h2 className="font-medium">The most recent Publish</h2>
        {!last ? <p className="mt-1 text-sm">Not published yet.</p> : busy ? (
          <p className="mt-1 text-sm">Publishing… this page updates by itself.</p>
        ) : last.outcome?.status === "committed" ? (
          <div className="mt-1 text-sm">
            <p><strong>Published</strong> {last.finished_at ? <LocalTime at={last.finished_at} /> : ""}{last.outcome.unchanged ? " (nothing had changed since the last Publish)" : ""}. {last.outcome.published.length} of {manifest.chapters.length} chapters are public.</p>
            <ul className="mt-2 list-disc pl-5">
              {last.outcome.decisions.filter((d) => d.result === "kept").map((d) => (
                <li key={d.unit}>{unitName(d.unit)} stayed as it was then: {d.why.map((w) => (w === "Draft chapter" ? "it is a draft" : w === "Course plan not approved" ? "its course plan isn't approved" : w)).join("; ")}</li>
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
                  <td className="py-2">{ch.title}{editedSincePublish(ch.slug) ? <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-950">edited since the last Publish</span> : !everPublished.has(ch.slug) ? <span className="ml-2 text-xs text-gray-600">not published yet</span> : null}</td>
                  <td className="py-2">
                    {pendingMode.has(ch.slug) ? <span>{pendingMode.get(ch.slug) === "draft" ? "Draft" : "Ready"} <em className="text-gray-600">(saving…)</em></span>
                      : ch.mode === "draft" ? "Draft"
                      : missing || toApprove.length ? "Ready once the course plan is approved"
                      : "Ready"}
                    {canMode && pendingMode.size === 0 ? (
                      <button className="ml-2 underline" formAction={setChapterModeAction.bind(null, packageId, ch.slug, ch.mode === "draft" ? "package" : "draft")}>
                        {ch.mode === "draft" ? "Mark ready" : "Back to draft"}
                      </button>
                    ) : null}
                  </td>
                  <td className="py-2">
                    {missing ? (
                      <>Not written yet <button className="ml-1 underline" formAction={startPlanAction.bind(null, packageId, ch.slug)}>Start it</button></>
                    ) : toApprove.length === 0 ? "Approved" : canApprove ? (
                      <span>
                        Changed since it was approved: read the {ch.parts.map((p) => <Link key={p.path} prefetch={false} className="underline" href={`/workspace/${packageId}/doc/${p.path.split("/").map(encodeURIComponent).join("/")}`}>{p.path.split("/")[0] === "concepts" ? "concept map" : "assessment guide"}</Link>).reduce<React.ReactNode[]>((a, x, i) => (i ? [...a, " and ", x] : [x]), [])}, then{" "}
                        <button className="rounded border px-2 py-0.5" formAction={approvePlanNowAction.bind(null, packageId, toApprove.map((p) => `${p.path}@${p.version}`).join("|"))}>Approve it as it is now</button>
                      </span>
                    ) : "Waiting for the owner or deputy to approve the course plan"}
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
          <div className="mt-4">{busy || pendingMode.size
            ? <button type="button" disabled className="rounded bg-gray-300 px-4 py-2 text-gray-900">{busy ? "Publishing…" : "Waiting for a status change to be saved…"}</button>
            : <SubmitButton pending="Starting…" className="rounded bg-blue-700 px-4 py-2 font-medium text-white hover:bg-blue-800">Publish</SubmitButton>}</div>
        ) : <p className="mt-4 text-sm">Only the owner or deputy publishes.</p>}
      </form>
    </main>
  );
}

/** A GitHub rate limit shows as a calm page, not an error (RC.12). */
export default async function PublishPage(props: Parameters<typeof PublishPageInner>[0]) {
  try {
    return await PublishPageInner(props);
  } catch (e) {
    const busy = githubBusy(e);
    if (!busy) throw e;
    return <GithubBusy until={busy.until} back={`/workspace/${(await props.params).packageId}/course`} />;
  }
}
