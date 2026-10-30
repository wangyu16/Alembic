import Link from "next/link";
import { redirect } from "next/navigation";
import { CompareIncompleteError } from "@alembic/github-bridge";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { courseRepo } from "@/lib/course-v3";
import { GithubBusy, githubBusy } from "@/lib/github-busy";
import { LocalTime } from "@/lib/local-time";

export const dynamic = "force-dynamic";

/** What changed since a snapshot (history-v3 §5): each document opens its History, compared from the snapshot. */
async function SnapshotInner({ params }: { params: Promise<{ packageId: string; slug: string }> }) {
  const { packageId, slug } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/workspace/${packageId}/snapshots/${slug}`)}`);
  const { data: role } = await supabase.rpc("course_role", { p: packageId });
  if (!role) redirect("/workspace");
  const { data: snap } = await supabase.from("course_snapshots").select("name, commit_sha, created_at").eq("package_id", packageId).eq("slug", slug).maybeSingle();
  if (!snap) redirect(`/workspace/${packageId}/course`);
  const c = await courseRepo(packageId);
  if (!c) return <main className="p-6">This course can&apos;t be reached right now.</main>;
  const head = await c.repo.head();
  let changed: Array<{ path: string; status: string }> | null = null;
  let rewritten = false;
  try {
    changed = (await c.client.compareCommits({ owner: c.owner, repo: c.name }, snap.commit_sha as string, head)).filter((f) => !f.path.startsWith(".") && f.path !== "alembic.json");
  } catch (e) {
    if (!(e instanceof CompareIncompleteError)) throw e;
    rewritten = e.reason === "not-ancestor";
  }
  const word = { added: "added since", modified: "changed since", removed: "removed since" } as Record<string, string>;
  return (
    <main className="mx-auto max-w-3xl p-6">
      <p className="text-sm"><Link prefetch={false} className="underline" href={`/workspace/${packageId}/course`}>← Course</Link></p>
      <h1 className="mt-2 text-2xl font-semibold">{snap.name as string}</h1>
      <p className="mt-1 text-sm text-gray-600">Saved <LocalTime at={snap.created_at as string} />. What has changed in the course since then:</p>
      {changed === null ? <p className="mt-4 text-sm">{rewritten ? "The course's history was rewritten on GitHub since this snapshot, so it can't be compared here." : "Too much has changed to list here."}</p>
        : changed.length === 0 ? <p className="mt-4 text-sm">Nothing has changed since this snapshot.</p> : (
        <ul className="mt-4 divide-y rounded border text-sm" data-testid="snapshot-changes">
          {changed.map((f) => (
            <li key={f.path} className="p-2">
              <Link prefetch={false} className="underline" href={`/workspace/${packageId}/history/${f.path.split("/").map(encodeURIComponent).join("/")}`}>{f.path}</Link>
              <span className="ml-2 text-gray-600">{word[f.status] ?? f.status}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-gray-600">To bring a document back as it was, open its History and restore that version.</p>
    </main>
  );
}

export default async function SnapshotPage(props: Parameters<typeof SnapshotInner>[0]) {
  try { return await SnapshotInner(props); } catch (e) {
    const busy = githubBusy(e);
    if (!busy) throw e;
    return <GithubBusy until={busy.until} back={"/workspace"} />;
  }
}
