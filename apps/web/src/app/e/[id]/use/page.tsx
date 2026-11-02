import Link from "next/link";
import { redirect } from "next/navigation";
import { activeProfile, canWritePath, isPage, type Role } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { courseRepo } from "@/lib/course-v3";
import { loadElement } from "@/lib/shared-element";
import { SubmitButton } from "@/app/workspace/submit-button";
import { useElementAction } from "./actions";

export const dynamic = "force-dynamic";

/** "Use this element" (element-sharing-v3 §3, step 2): choose one of your courses, then a page; it goes in with its credit. */
export default async function UseElementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ course?: string; m?: string }> }) {
  const { id } = await params;
  const { course: chosen, m } = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/e/${id}/use`)}`);
  const e = await loadElement(id);
  const open = e ? activeProfile.licences.open.includes(e.course.licence) : false;
  const { data: mine } = await supabase.from("course_members").select("package_id").eq("user_id", user.id);
  const ids = (mine ?? []).map((r) => r.package_id as string);
  const { data: courses } = ids.length ? await supabase.from("packages").select("id, title").in("id", ids).is("archived_at", null) : { data: [] as Array<{ id: string; title: string }> };
  let pages: string[] = [];
  if (chosen && ids.includes(chosen)) {
    const { data: role } = await supabase.rpc("course_role", { p: chosen });
    const c = await courseRepo(chosen);
    if (c?.repo.listPaths) pages = (await c.repo.listPaths(await c.repo.head())).filter((p) => isPage(p) && canWritePath((role ?? "none") as Role, p)).sort();
  }
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <p className="text-sm text-muted"><Link prefetch={false} href={`/e/${id}`}>← Back to the element</Link></p>
      <h1 className="page-title mt-2">Use this element</h1>
      {m ? <p className="notice mt-4" role="status">{m}</p> : null}
      {!e ? <p className="mt-4">This element is no longer available.</p> : !open ? (
        <p className="mt-4">This element&apos;s licence doesn&apos;t allow using it in another course. You can still link to it.</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">“{e.title}” from {e.course.title}. It goes at the end of the page you choose, with its credit; you can move it from there.</p>
          {!chosen || !ids.includes(chosen) ? (
            <form className="panel mt-5 space-y-3 p-4" method="get">
              <label className="block"><span className="font-medium">Which of your courses?</span>
                <select name="course" className="input mt-2 w-full" required defaultValue="">
                  <option value="" disabled>Choose a course</option>
                  {(courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </label>
              <button className="btn btn-primary btn-sm">Next</button>
            </form>
          ) : (
            <form action={useElementAction} className="panel mt-5 space-y-3 p-4" data-testid="use-element">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="course" value={chosen} />
              <label className="block"><span className="font-medium">Which page?</span>
                <select name="page" className="input mt-2 w-full" required defaultValue="">
                  <option value="" disabled>Choose a page</option>
                  {pages.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <div className="flex gap-2">
                <SubmitButton className="btn btn-primary btn-sm" pending="Adding…">Add it</SubmitButton>
                <Link prefetch={false} className="btn btn-ghost btn-sm" href={`/e/${id}/use`}>Another course</Link>
              </div>
            </form>
          )}
        </>
      )}
    </main>
  );
}
