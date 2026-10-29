import { GithubBusy, githubBusy } from "@/lib/github-busy";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { clientForCourse } from "@/lib/github";
import { v3Enabled } from "@/lib/db";
import { kindOfPath } from "@/lib/orz-editor/kit";
import { courseOutline } from "@/lib/course-outline";

export const dynamic = "force-dynamic";

/** A v3 course's home: its chapters and their documents, straight from the working repo (RC.14). */
async function CourseHomeV3Inner({ params }: { params: Promise<{ packageId: string }> }) {
  const { packageId } = await params;
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
  } catch { /* an unreadable manifest: everything shows under course files */ }
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
      <nav className="mt-2 flex gap-4 text-sm">
        <Link className="underline" href={`/workspace/${packageId}/needs-you`}>Needs you</Link>
        <Link className="underline" href={`/workspace/${packageId}/people`}>People</Link>
        <Link prefetch={false} className="underline" href={`/workspace/${packageId}/publish`}>Publish</Link>
      </nav>
      <ol className="mt-6 divide-y rounded border" data-testid="chapters">
        {o.chapters.map((ch, k) => (
          <li key={ch.slug} className="p-3">
            <h2 className="font-medium">
              {k + 1}. {ch.title}
              {ch.draft ? <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-xs font-normal text-gray-800">Draft</span> : null}
            </h2>
            {list([...ch.parts, ...ch.more])}
            {ch.missing.length ? <p className="mt-1 text-xs text-gray-600">Not written yet: {ch.missing.join(", ")}</p> : null}
          </li>
        ))}
      </ol>
      {o.chapters.length === 0 && docs.length === 0 ? <p className="mt-6">No documents yet.</p> : null}
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
