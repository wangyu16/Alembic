import { GithubBusy, githubBusy } from "@/lib/github-busy";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { clientForCourse } from "@/lib/github";
import { v3Enabled } from "@/lib/db";
import { kindOfPath } from "@/lib/orz-editor/kit";
import { courseOutline } from "@/lib/course-outline";
import { can, type Role } from "@alembic/package-contract";
import { CHAPTER_PARTS } from "@alembic/package-ops";
import { SubmitButton } from "../../submit-button";
import { RefreshWhile } from "../publish/refresh-while";
import { addChaptersAction, startPartsAction } from "./actions";

export const dynamic = "force-dynamic";

/** What the person is in this course, and what that lets them do (RC.24). */
const ROLE_LINE: Record<string, string> = {
  owner: "You own this course: you edit it, approve its course plan, publish it and choose who works on it.",
  deputy: "You are this course's deputy: you edit it, approve its course plan and publish it.",
  "co-author": "You are a co-author: you edit the course; the owner or deputy approves the course plan and publishes.",
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
  const head = (await c.client.getBranchHead(coords)).commitSha;
  const { paths } = await c.client.listTree(coords, head);
  const docs = paths.filter((p) => kindOfPath(p) && !p.startsWith("."));
  let chapters: Array<{ slug: string; title: string; mode?: string }> = [];
  try {
    chapters = (JSON.parse((await c.client.getFileAtRef(coords, "alembic.json", head)) ?? "{}") as { chapters?: typeof chapters }).chapters ?? [];
  } catch (e) {
    if (githubBusy(e)) throw e; // the busy page, not a course with no chapters (RC.12)
    /* an unreadable manifest: everything shows under course files */
  }
  // Changes on their way into the course (chapters being added, parts being started): the page refreshes until they land.
  const { data: open } = await supabase.from("write_queue").select("id").eq("package_id", packageId).in("status", ["queued", "processing", "retry"]).limit(1);
  const mayAddChapters = can(role as Role, "edit.course-files");
  const partOf = new Map(CHAPTER_PARTS.map((x) => [x.label, x.part]));
  const o = courseOutline(Array.isArray(chapters) ? chapters : [], docs);
  const href = (p: string) => `/workspace/${packageId}/doc/${p.split("/").map(encodeURIComponent).join("/")}`;
  const list = (items: Array<{ label: string; path: string }>) => (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {items.map((x) => <li key={x.path}><Link prefetch={false} className="underline" href={href(x.path)}>{x.label}</Link></li>)}
    </ul>
  );

  return (
    <main className="mx-auto max-w-3xl p-6">
      <p className="text-sm"><Link href="/workspace">← Your courses</Link></p>
      <h1 className="mt-2 text-2xl font-semibold">{(course?.title as string | undefined) ?? "Course"}</h1>
      <p className="mt-1 text-sm text-gray-600" data-testid="role">{ROLE_LINE[role as string] ?? ""}</p>
      <nav className="mt-2 flex gap-4 text-sm">
        <Link className="underline" href={`/workspace/${packageId}/needs-you`}>Needs you</Link>
        <Link className="underline" href={`/workspace/${packageId}/people`}>People</Link>
        <Link prefetch={false} className="underline" href={`/workspace/${packageId}/publish`}>Publish</Link>
      </nav>
      <RefreshWhile active={(open ?? []).length > 0} everyMs={3000} />
      {message ? <p className="mt-3 rounded border border-sky-300 bg-sky-50 p-2 text-sm text-sky-950" role="status">{message}</p> : null}
      <ol className="mt-6 divide-y rounded border" data-testid="chapters">
        {o.chapters.map((ch, k) => (
          <li key={ch.slug} className="p-3">
            <h2 className="font-medium">
              {k + 1}. {ch.title}
              {ch.draft ? <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-xs font-normal text-gray-800">Draft</span> : null}
            </h2>
            {list([...ch.parts, ...ch.more])}
            {ch.missing.length ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-700" data-testid="missing">
                <span>Not started:</span>
                {ch.missing.map((label) => (
                  <form key={label} action={startPartsAction.bind(null, packageId, ch.slug, partOf.get(label)!)}>
                    <SubmitButton className="underline" pending={`Starting ${label}…`}>{`Start ${label.toLowerCase()}`}</SubmitButton>
                  </form>
                ))}
                {ch.missing.length > 1 ? (
                  <form action={startPartsAction.bind(null, packageId, ch.slug, "all")}>
                    <SubmitButton className="font-medium underline" pending="Starting…">Start all {ch.missing.length}</SubmitButton>
                  </form>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {o.chapters.length === 0 && docs.length === 0 ? <p className="mt-6">No documents yet.</p> : null}
      {mayAddChapters ? (
        <details className="mt-6 rounded border p-3" data-testid="add-chapters" open={o.chapters.length <= 1}>
          <summary className="cursor-pointer font-medium">Add chapters</summary>
          <form action={addChaptersAction.bind(null, packageId)} className="mt-3 space-y-3">
            <label className="block text-sm">
              Chapter titles, one per line (paste a whole table of contents if you like). They are added at the end, as drafts.
              <textarea name="titles" rows={4} required className="input mt-1 w-full font-normal" placeholder={"Atoms and Molecules\nStoichiometry\nGases"} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="start" defaultChecked /> Start all five parts of each chapter (concept map, study guide, slides, assessment guide, practice); without this, each starts with its study guide
            </label>
            <SubmitButton className="btn btn-primary" pending="Adding…">Add</SubmitButton>
          </form>
        </details>
      ) : null}
      {o.course.length ? (
        <details className="mt-6 rounded border p-3">
          <summary className="cursor-pointer font-medium">Course-wide files ({o.course.length})</summary>
          {list(o.course)}
        </details>
      ) : null}
      {o.instructor.length ? (
        <details className="mt-3 rounded border p-3">
          <summary className="cursor-pointer font-medium">Instructor only ({o.instructor.length})</summary>
          {list(o.instructor)}
        </details>
      ) : null}
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
