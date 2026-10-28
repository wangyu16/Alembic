import Link from "next/link";
import { redirect } from "next/navigation";
import { normalizePath } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { v3Enabled } from "@/lib/db";
import { courseRepo, recordDocVersion } from "@/lib/course-v3";
import { kindOfPath } from "@/lib/orz-editor/kit";
import { DocEditor } from "./doc-editor";

export const dynamic = "force-dynamic";

/** One course document in the embedded 1.x editor (K4), read from the working repo's head. */
export default async function DocPage({ params }: { params: Promise<{ packageId: string; path: string[] }> }) {
  const { packageId, path: parts } = await params;
  if (!v3Enabled()) redirect(`/workspace/${packageId}`);
  let path: string;
  try { path = normalizePath(parts.map(decodeURIComponent).join("/")); } catch { redirect(`/workspace/${packageId}/course`); }
  const kind = kindOfPath(path);
  if (!kind) redirect(`/workspace/${packageId}/course`);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/workspace/${packageId}/doc/${path}`)}`);
  const { data: role } = await supabase.rpc("course_role", { p: packageId });
  if (!role) redirect("/workspace");
  const c = await courseRepo(packageId);
  if (!c) return <main className="p-6">This course's repository can't be reached right now.</main>;
  const head = await c.repo.head();
  const text = await c.repo.readFile(head, path);
  if (text === null) redirect(`/workspace/${packageId}/course`);
  const version = await recordDocVersion(packageId, path, text, head);

  return (
    <main className="flex h-[calc(100vh-1rem)] flex-col">
      <div className="flex items-center gap-3 border-b px-3 py-2 text-sm">
        <Link href={`/workspace/${packageId}/course`} className="underline">← Course</Link>
        <span className="font-medium">{path}</span>
      </div>
      <div className="min-h-0 flex-1">
        <DocEditor kind={kind} packageId={packageId} path={path} text={text} version={version} isPrivate={path.startsWith("private/")} />
      </div>
    </main>
  );
}
