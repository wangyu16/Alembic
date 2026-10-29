import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { clientForCourse } from "@/lib/github";
import { v3Enabled } from "@/lib/db";
import { kindOfPath } from "@/lib/orz-editor/kit";

export const dynamic = "force-dynamic";

const SPACE: Record<string, string> = {
  "study-guide": "Study guides", slides: "Slides", practice: "Practice", concepts: "Concept maps",
  "assessment-support": "Assessment guides", current: "Current materials", private: "Instructor only",
};

/** A v3 course's home: its documents, straight from the working repo. */
export default async function CourseHomeV3({ params }: { params: Promise<{ packageId: string }> }) {
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
  const groups = new Map<string, string[]>();
  for (const p of docs) { const top = p.split("/")[0]!; groups.set(top, [...(groups.get(top) ?? []), p]); }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <p className="text-sm"><Link href="/workspace">← Your courses</Link></p>
      <h1 className="mt-2 text-2xl font-semibold">{(course?.title as string | undefined) ?? "Course"}</h1>
      <nav className="mt-2 flex gap-4 text-sm">
        <Link className="underline" href={`/workspace/${packageId}/needs-you`}>Needs you</Link>
        <Link className="underline" href={`/workspace/${packageId}/people`}>People</Link>
        <Link prefetch={false} className="underline" href={`/workspace/${packageId}/publish`}>Publish</Link>
      </nav>
      {[...groups].map(([top, list]) => (
        <section key={top} className="mt-6">
          <h2 className="font-medium">{SPACE[top] ?? top}</h2>
          <ul className="mt-2 divide-y rounded border">
            {list.map((p) => (
              <li key={p} className="p-2 text-sm">
                <Link prefetch={false} className="underline" href={`/workspace/${packageId}/doc/${p.split("/").map(encodeURIComponent).join("/")}`}>{p.split("/").slice(1).join("/") || p}</Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {docs.length === 0 ? <p className="mt-6">No documents yet.</p> : null}
    </main>
  );
}
