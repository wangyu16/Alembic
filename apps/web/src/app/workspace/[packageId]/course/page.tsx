import { GithubBusy, githubBusy } from "@/lib/github-busy";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { clientForCourse } from "@/lib/github";
import { v3Enabled } from "@/lib/db";
import { kindOfPath } from "@/lib/orz-editor/kit";
import { courseOutline } from "@/lib/course-outline";
import { activeProfile, can, isPage, isServerOnlyPath, statusOf, type Role, type StatusMap } from "@alembic/package-contract";
import { CHAPTER_PARTS } from "@alembic/package-ops";
import { SubmitButton } from "../../submit-button";
import { RefreshWhile } from "../publish/refresh-while";
import { addChaptersAction, startPartsAction } from "./actions";
import { createSnapshotAction } from "../history/actions";
import { LocalTime } from "@/lib/local-time";

export const dynamic = "force-dynamic";

/** What the person is in this course, and what that lets them do (RC.24). */
const ROLE_LINE: Record<string, string> = {
  owner: "You own this course: you edit it, mark pages completed, publish it and choose who works on it.",
  deputy: "You are this course's deputy: you edit it, mark pages completed and publish it.",
  "co-author": "You are a co-author: you edit the course and mark pages completed; the owner or deputy publishes.",
};

/** A v3 course's home: its chapters and their documents, straight from the working repo (RC.14). */
async function CourseHomeV3Inner({ params, searchParams }: { params: Promise<{ packageId: string }>; searchParams: Promise<{ m?: string }> }) {
  const { packageId } = await params;
  const { m: message } = await searchParams;
  if (!v3Enabled()) redirect(`/workspace/${packageId}`);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/workspace/${packageId}/course`)}`);
  const { data: role } = await supabase.rpc("course_role", { p: packageId });
  if (!role) redirect("/workspace");
  const { data: course } = await supabase.from("packages").select("title").eq("id", packageId).maybeSingle();
  const admin = createServiceClient();
  const c = admin ? await clientForCourse(admin, packageId) : null;
  if (!c) return <main className="mx-auto max-w-2xl p-6"><p>This course's repository can't be reached right now.</p></main>;
  const coords = { owner: c.owner, repo: c.repos[0]! };
  // Changes on their way into the course (chapters being added, parts being started): the page refreshes until they land.
  // Read BEFORE the head: a change that finished in between is then already in the head (live race, foundations 1b).
  const { data: open } = await supabase.from("write_queue").select("id").eq("package_id", packageId).in("status", ["queued", "processing", "retry"]).limit(1);
  const head = (await c.client.getBranchHead(coords)).commitSha;
  const { paths } = await c.client.listTree(coords, head);
  const docs = paths.filter((p) => kindOfPath(p) && !p.startsWith(".") && !isServerOnlyPath(p)); // e.g. the template's private/README.md (contract v3 §12.1)
  let chapters: Array<{ slug: string; title: string; mode?: string }> = [];
  let status: StatusMap | undefined;
  try {
    const m = JSON.parse((await c.client.getFileAtRef(coords, "alembic.json", head)) ?? "{}") as { chapters?: typeof chapters; status?: StatusMap };
    chapters = m.chapters ?? [];
    status = m.status;
  } catch (e) {
    if (githubBusy(e)) throw e; // the busy page, not a course with no chapters (RC.12)
    /* an unreadable manifest: everything shows under course files */
  }
  const mayAddChapters = can(role as Role, "edit.course-files");
  const partOf = new Map(CHAPTER_PARTS.map((x) => [x.label, x.part]));
  const { data: snapRows } = await supabase.from("course_snapshots").select("slug, name, created_at").eq("package_id", packageId).order("created_at", { ascending: false });
  const snaps = (snapRows ?? []) as Array<{ slug: string; name: string; created_at: string }>;
  const o = courseOutline(Array.isArray(chapters) ? chapters : [], docs);
  const href = (p: string) => `/workspace/${packageId}/doc/${p.split("/").map(encodeURIComponent).join("/")}`;
  const list = (items: Array<{ label: string; path: string }>) => (
    <ul className="mt-3 flex flex-wrap gap-1.5 text-sm">
      {items.map((x) => <li key={x.path}><Link prefetch={false} className="part" href={href(x.path)}>{x.label}</Link></li>)}
    </ul>
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <p className="text-sm text-muted"><Link href="/workspace">← Your courses</Link></p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="page-title">{(course?.title as string | undefined) ?? "Course"}</h1>
          <p className="mt-1 text-sm text-muted" data-testid="role">{ROLE_LINE[role as string] ?? ""}</p>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm" aria-label="This course">
          <Link className="btn btn-ghost btn-sm" href={`/workspace/${packageId}/needs-you`}>Needs you</Link>
          <Link className="btn btn-ghost btn-sm" href={`/workspace/${packageId}/people`}>People</Link>
          <Link prefetch={false} className="btn btn-primary btn-sm" href={`/workspace/${packageId}/publish`}>Publish</Link>
        </nav>
      </div>
      <RefreshWhile active={(open ?? []).length > 0} everyMs={3000} />
      {message ? <p className="notice mt-4" role="status">{message}</p> : null}
      <ol className="panel mt-6 divide-y divide-edge-soft" data-testid="chapters">
        {o.chapters.map((ch, k) => (
          <li key={ch.slug} className="grid gap-2 px-4 py-3 lg:grid-cols-[minmax(14rem,1fr)_auto] lg:items-center">
            <h2 className="flex min-w-0 items-baseline gap-2 font-medium text-ink">
              <span className="w-6 shrink-0 text-right text-sm tabular-nums text-muted">{k + 1}</span>
              <span className="min-w-0">{ch.title}</span>
              {(() => {
                const pages = [...ch.parts, ...ch.more].filter((x) => isPage(x.path));
                const done = pages.filter((x) => statusOf(status, x.path) === "completed").length;
                return pages.length ? <span className={`text-xs ${done === pages.length ? "text-ok" : "text-muted"}`} data-testid="completed-count">{done === pages.length ? "all completed" : `${done} of ${pages.length} completed`}</span> : null;
              })()}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5 pl-8 lg:justify-end lg:pl-0">
            {[...ch.parts, ...ch.more].map((x) => {
              const st = statusOf(status, x.path);
              return <Link key={x.path} prefetch={false} className="part" href={href(x.path)} title={st === "completed" ? "Completed" : st === "withdrawn" ? "Off the website" : "Draft"}>{st === "completed" ? "✓ " : ""}{x.label}</Link>;
            })}
            {ch.missing.length ? (
              <div className="contents" data-testid="missing">
                <span className="sr-only">Not started:</span>
                {ch.missing.map((label) => (
                  <form key={label} action={startPartsAction.bind(null, packageId, ch.slug, partOf.get(label)!)}>
                    <SubmitButton className="part part-missing" pending={`Starting ${label}…`}>{`Start ${label.toLowerCase()}`}</SubmitButton>
                  </form>
                ))}
                {ch.missing.length > 1 ? (
                  <form action={startPartsAction.bind(null, packageId, ch.slug, "all")}>
                    <SubmitButton className="part part-missing font-medium text-accent" pending="Starting…">Start all {ch.missing.length}</SubmitButton>
                  </form>
                ) : null}
              </div>
            ) : null}
            </div>
          </li>
        ))}
      </ol>
      {o.chapters.length === 0 && docs.length === 0 ? <p className="mt-6 text-muted">No documents yet.</p> : null}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
      {mayAddChapters ? (
        <details className="panel p-4" data-testid="add-chapters" open={o.chapters.length <= 1}>
          <summary className="cursor-pointer font-medium">Add chapters</summary>
          <form action={addChaptersAction.bind(null, packageId)} className="mt-3 space-y-3">
            <label className="block text-sm text-muted">
              Chapter titles, one per line (paste a whole table of contents if you like). They are added at the end; their pages start as drafts.
              <textarea name="titles" rows={4} required className="input mt-1 w-full font-normal" placeholder={"Atoms and Molecules\nStoichiometry\nGases"} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="start" defaultChecked /> Start all {CHAPTER_PARTS.length} parts of each chapter ({CHAPTER_PARTS.map((x) => x.label.toLowerCase()).join(", ")}); without this, each starts with {activeProfile.unitParts.filter((p) => activeProfile.requiredParts.includes(p.id)).map((p) => p.label.toLowerCase()).join(", ")}
            </label>
            <SubmitButton className="btn btn-primary" pending="Adding…">Add</SubmitButton>
          </form>
        </details>
      ) : null}
      <details className="panel p-4" data-testid="snapshots">
        <summary className="cursor-pointer font-medium">Snapshots ({snaps.length})</summary>
        <p className="mt-2 text-sm text-muted">Name the course as it is now (for example &ldquo;Fall 2026&rdquo;), and later see what changed since.</p>
        <form action={createSnapshotAction.bind(null, packageId)} className="mt-2 flex gap-2">
          <input name="name" required maxLength={120} placeholder="Fall 2026" className="input flex-1" />
          <SubmitButton className="btn btn-ghost" pending="Saving…">Save a snapshot</SubmitButton>
        </form>
        {snaps.length ? (
          <ul className="mt-3 space-y-1 text-sm">
            {snaps.map((sn) => (
              <li key={sn.slug}><Link prefetch={false} className="underline" href={`/workspace/${packageId}/snapshots/${sn.slug}`}>{sn.name}</Link> <span className="text-muted">· <LocalTime at={sn.created_at} /></span></li>
            ))}
          </ul>
        ) : null}
      </details>
      {o.course.length ? (
        <details className="panel p-4">
          <summary className="cursor-pointer font-medium">Course-wide files ({o.course.length})</summary>
          {list(o.course)}
        </details>
      ) : null}
      {o.instructor.length ? (
        <details className="panel p-4">
          <summary className="cursor-pointer font-medium">Instructor only ({o.instructor.length})</summary>
          {list(o.instructor)}
        </details>
      ) : null}
      </div>
    </main>
  );
}

/** A GitHub rate limit shows as a calm page, not an error (RC.12). */
export default async function CourseHomeV3(props: Parameters<typeof CourseHomeV3Inner>[0]) {
  try {
    return await CourseHomeV3Inner(props);
  } catch (e) {
    const busy = githubBusy(e);
    if (!busy) throw e;
    return <GithubBusy until={busy.until} back={"/workspace"} />;
  }
}
