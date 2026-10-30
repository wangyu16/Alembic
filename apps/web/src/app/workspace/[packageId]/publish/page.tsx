import { GithubBusy, githubBusy } from "@/lib/github-busy";
import Link from "next/link";
import { redirect } from "next/navigation";
import { activeProfile, can, isPage, statusOf, WorkingManifestV3Schema, type FileStatus, type Role } from "@alembic/package-contract";
import { unitOf } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { v3Enabled } from "@/lib/db";
import { blobsAt, courseRepo, textAtCommit } from "@/lib/course-v3";
import { LocalTime } from "@/lib/local-time";
import { requestPublishAction, setStatusAction } from "./actions";
import { SubmitButton } from "../../submit-button";
import { RefreshWhile } from "./refresh-while";
import { siteView } from "@/lib/publish-view";

export const dynamic = "force-dynamic";

type Outcome =
  | { status: "committed"; published: string[]; kept?: string[]; unchanged?: boolean; leftOut?: string[]; htmlAsText?: string[]; broughtIn?: string[] }
  | { status: "stopped" | "failed"; reason: string; drift?: string[] };

/** What Publish does with one page (family SITE-TYPE-CONTRACT §7), in the person's words. */
type Fate = "goes-up" | "live" | "waits" | "off" | "comes-off";
const FATE: Record<Fate, { label: string; tone: string }> = {
  "goes-up": { label: "goes up", tone: "badge-accent" },
  live: { label: "on the website", tone: "badge-ok" },
  waits: { label: "draft: the website keeps the published version", tone: "badge-warn" },
  off: { label: "draft: not on the website", tone: "" },
  "comes-off": { label: "comes off the website", tone: "badge-warn" },
};
function fateOf(status: FileStatus, published: boolean, changed: boolean): Fate {
  if (status === "withdrawn") return published ? "comes-off" : "off";
  if (status === "completed" || status === "public") return !published || changed ? "goes-up" : "live";
  return published ? "waits" : "off";
}

const docHref = (packageId: string, path: string) => `/workspace/${packageId}/doc/${path.split("/").map(encodeURIComponent).join("/")}`;

/** Publish: every page's status and what Publish will do with it; one click to mark a chapter completed; Publish. */
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

  const [{ data: course }, { data: requests }, { data: runs }, { data: pendingRows }, { data: publishedRows }] = await Promise.all([
    supabase.from("packages").select("title, public_repo").eq("id", packageId).maybeSingle(),
    supabase.from("publish_requests").select("id, status, outcome, created_at, finished_at").eq("package_id", packageId).order("created_at", { ascending: false }).limit(1),
    supabase.from("publish_runs").select("status, results").eq("package_id", packageId).in("status", ["committed", "site-built", "site-failed"]).order("committed_at", { ascending: false }).limit(1),
    // Status changes and other course operations still on their way: shown as saving; Publish waits for them.
    supabase.from("write_queue").select("id").eq("package_id", packageId).eq("kind", "courseop").in("status", ["queued", "processing", "retry"]),
    supabase.from("published_files").select("path, blob_sha, unit").eq("package_id", packageId),
  ]);
  const saving = (pendingRows ?? []).length;
  const lastRun = runs?.[0] as { status: string; results: { site?: { url?: string; error?: string; superseded?: boolean } } } | undefined;
  const site = siteView(lastRun);
  const c = await courseRepo(packageId);
  if (!c) return <main className="mx-auto max-w-2xl p-6"><p>This course&apos;s repository can&apos;t be reached right now.</p></main>;
  const head = await c.repo.head();
  let manifest: ReturnType<typeof WorkingManifestV3Schema.parse>;
  try {
    manifest = WorkingManifestV3Schema.parse(JSON.parse((await textAtCommit(c.repo, `${c.owner}/${c.name}`, head, "alembic.json")) ?? "null"));
  } catch (e) {
    if (githubBusy(e)) throw e; // the busy page (RC.12)
    return <main className="mx-auto max-w-2xl p-6"><p>The course&apos;s settings file (alembic.json) can&apos;t be read, so it can&apos;t be published until it is fixed.</p></main>;
  }

  // Every file at the head and what was published (one tree listing; RC.24).
  const blobs = await blobsAt(c.client, { owner: c.owner, repo: c.name }, head);
  const published = new Map(((publishedRows ?? []) as Array<{ path: string; blob_sha: string; unit: string }>).map((r) => [r.path, r]));
  const everPublished = new Set([...published.values()].filter((r) => r.unit.startsWith("chapter:")).map((r) => r.unit.slice(8)));
  const slugs = new Set(manifest.chapters.map((ch) => ch.slug));
  const partLabel = (path: string) => activeProfile.unitParts.find((p) => manifest.chapters.some((ch) => p.path(ch.slug) === path))?.label ?? path.split("/").pop()!;
  type Row = { path: string; label: string; status: FileStatus; fate: Fate };
  const byChapter = new Map<string, Row[]>();
  const coursePages: Row[] = [];
  let otherChanges = 0;
  for (const [path, sha] of blobs) {
    const u = unitOf(path, slugs, everPublished);
    if (u.kind === "none" || u.kind === "orphan" || (u.kind === "chapter" && !slugs.has(u.slug))) continue;
    const status = statusOf(manifest.status, path);
    const pub = published.get(path);
    const fate = fateOf(status, pub !== undefined, pub !== undefined && pub.blob_sha !== sha);
    if (!isPage(path)) { if (fate === "goes-up" || fate === "comes-off") otherChanges++; continue; }
    const row = { path, label: partLabel(path), status, fate };
    if (u.kind === "chapter") byChapter.set(u.slug, [...(byChapter.get(u.slug) ?? []), row]);
    else coursePages.push(row);
  }
  // Published files deleted since come off too.
  for (const [p, r] of published) if (!blobs.has(p) && p !== "alembic.json" && !p.startsWith(".") && (r.unit.startsWith("chapter:") || r.unit === "course" || r.unit.startsWith("asset:"))) otherChanges++;
  const order = new Map(activeProfile.unitParts.map((p, i) => [p.label, i]));
  for (const rows of byChapter.values()) rows.sort((a, b) => (order.get(a.label) ?? 99) - (order.get(b.label) ?? 99) || a.path.localeCompare(b.path));
  const all = [...byChapter.values()].flat().concat(coursePages);
  const goingUp = all.filter((r) => r.fate === "goes-up").length;
  const comingOff = all.filter((r) => r.fate === "comes-off").length;
  const drafts = all.filter((r) => r.status === "draft");

  const last = requests?.[0] as { id: string; status: string; outcome: Outcome | null; finished_at: string | null } | undefined;
  const busy = last?.status === "queued" || last?.status === "running";
  const siteBuilding = site.kind === "building";
  const pub = course?.public_repo as { owner: string; name: string } | null;
  const canPublish = can(role, "publish.later");
  const lead = can(role, "edit.course-files");
  const here = `/workspace/${packageId}/publish`;
  const mark = (rows: Row[], status: "completed" | "draft") => setStatusAction.bind(null, packageId, rows.map((r) => r.path).join("|"), status, here);

  const chapterRow = (key: string, title: string, rows: Row[]) => {
    const toComplete = rows.filter((r) => r.status === "draft");
    return (
      <tr key={key} className="align-top" data-testid={`chapter-${key}`}>
        <td className="py-2 pr-3 font-medium">{title}</td>
        <td className="py-2">
          {rows.length ? (
            <ul className="flex flex-col gap-1">
              {rows.map((r) => (
                <li key={r.path} className="flex flex-wrap items-center gap-2">
                  <Link prefetch={false} href={docHref(packageId, r.path)} className="part">{r.status === "completed" ? "✓ " : ""}{r.label}</Link>
                  <span className={`badge ${FATE[r.fate].tone}`}>{FATE[r.fate].label}</span>
                </li>
              ))}
            </ul>
          ) : <span className="text-sm text-muted">No pages yet</span>}
        </td>
        <td className="py-2 pl-3 text-right whitespace-nowrap">
          {toComplete.length && !saving ? (
            <button className="btn btn-ghost btn-sm" formAction={mark(toComplete, "completed")}>{toComplete.length === rows.length ? "Mark chapter completed" : `Mark ${toComplete.length} more completed`}</button>
          ) : null}
        </td>
      </tr>
    );
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <RefreshWhile active={busy || siteBuilding || saving > 0} everyMs={busy || saving ? 4000 : 15_000} />
      <p className="text-sm"><Link prefetch={false} href={`/workspace/${packageId}/course`}>← {(course?.title as string | undefined) ?? "Course"}</Link></p>
      <h1 className="page-title mt-2">Publish</h1>
      <p className="mt-2 max-w-3xl text-sm text-muted">
        Publish puts every page marked <strong>completed</strong> on the course&apos;s website{pub ? <> (its public copy is <a className="underline" href={`https://github.com/${pub.owner}/${pub.name}`}>on GitHub</a>)</> : " (made on the first Publish)"}.
        A page set back to draft stays on the website as it was published until it is completed again. Instructor-only files never leave.
      </p>
      {message ? <p className="notice mt-3" role="status">{message}</p> : null}
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

      <section className="panel mt-5 p-4">
        <h2 className="font-medium">The most recent Publish</h2>
        {!last ? <p className="mt-1 text-sm">Not published yet.</p> : busy ? (
          <p className="mt-1 text-sm">Publishing… this page updates by itself.</p>
        ) : last.outcome?.status === "committed" ? (
          <div className="mt-1 text-sm">
            <p><strong>Published</strong> {last.finished_at ? <LocalTime at={last.finished_at} /> : ""}{last.outcome.unchanged ? " (nothing had changed)" : ""}. {last.outcome.published.length} of {manifest.chapters.length} chapters have pages on the website.</p>
            {last.outcome.broughtIn?.length ? <p className="mt-1">Changes made on GitHub were brought in first: {last.outcome.broughtIn.length} file{last.outcome.broughtIn.length === 1 ? "" : "s"}.</p> : null}
            {last.outcome.leftOut?.length ? (
              <p className="mt-1">Left out because the website can&apos;t show them safely: {last.outcome.leftOut.map((p) => p.split("/").pop()).join(", ")}.</p>
            ) : null}
          </div>
        ) : last.outcome ? (
          <p className="mt-1 text-sm">Publish stopped: {last.outcome.reason}</p>
        ) : null}
      </section>

      <form className="mt-5">
        <div className="flex flex-wrap items-center gap-3">
          {canPublish ? (busy || saving
            ? <button type="button" disabled className="btn btn-ghost">{busy ? "Publishing…" : `Saving ${saving} change${saving === 1 ? "" : "s"}…`}</button>
            : <SubmitButton pending="Starting…" className="btn btn-primary px-6 py-2.5 text-base" formAction={requestPublishAction.bind(null, packageId)}>Publish</SubmitButton>)
            : <p className="text-sm">Only the owner or deputy publishes.</p>}
          <p className="text-sm text-muted" data-testid="publish-summary">
            {goingUp || comingOff || otherChanges
              ? `Publish will put up ${goingUp} page${goingUp === 1 ? "" : "s"}${comingOff ? `, take ${comingOff} off` : ""}${otherChanges ? ` and update ${otherChanges} other file${otherChanges === 1 ? "" : "s"}` : ""}.`
              : "Everything completed is already on the website."}
            {drafts.length ? ` ${drafts.length} page${drafts.length === 1 ? " is a draft" : "s are drafts"}.` : ""}
          </p>
          {drafts.length && !saving && lead ? (
            <button className="btn btn-ghost btn-sm ml-auto" formAction={mark(drafts, "completed")}>Mark all {drafts.length} drafts completed</button>
          ) : null}
        </div>

        <table className="data-table mt-4">
          <thead><tr className="text-left"><th className="py-1">Chapter</th><th>Pages</th><th /></tr></thead>
          <tbody>
            {coursePages.length ? chapterRow("course", "The course", coursePages) : null}
            {manifest.chapters.map((ch) => chapterRow(ch.slug, ch.title, byChapter.get(ch.slug) ?? []))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">Mark a single page draft or completed, or take it off the website, from the page itself.</p>
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
