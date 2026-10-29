import { GithubBusy, githubBusy } from "@/lib/github-busy";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { normalizePath } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { v3Enabled } from "@/lib/db";
import { courseRepo, recordDocVersion } from "@/lib/course-v3";
import { assetSecret, assetUrlMap } from "@/lib/course-assets";
import { can, type Role } from "@alembic/package-contract";
import { kindOfPath } from "@/lib/orz-editor/kit";
import { DocEditor } from "./doc-editor";

export const dynamic = "force-dynamic";

/** One course document in the embedded 1.x editor (K4), read from the working repo's head. */
async function DocPageInner({ params }: { params: Promise<{ packageId: string; path: string[] }> }) {
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
  // The course's images, for the editor's preview (one tree listing; RC.9).
  const tree = await c.client.listTreeEntries({ owner: c.owner, repo: c.name }, head).catch(() => ({ entries: [] as Array<{ path: string; type: string }> }));
  const secret = assetSecret();
  const assets = secret ? assetUrlMap(packageId, tree.entries.filter((e) => e.type === "blob").map((e) => e.path), can(role as Role, "edit.private"), secret) : new Map<string, string>();

  return (
    <main className="flex h-[calc(100dvh-3.75rem)] flex-col">
      <div className="flex items-center gap-3 border-b px-3 py-2 text-sm">
        <Link prefetch={false} href={`/workspace/${packageId}/course`} className="underline">← Course</Link>
        <span className="font-medium">{docTitle(text) ?? path}</span>
        {docTitle(text) ? <span className="text-xs text-gray-500">{path}</span> : null}
      </div>
      <div className="min-h-0 flex-1">
        <DocEditor kind={kind} packageId={packageId} path={path} text={text} version={version} isPrivate={path.startsWith("private/")} assets={[...assets]} nonce={(await headers()).get("x-nonce") ?? undefined} />
      </div>
    </main>
  );
}

/** A GitHub rate limit shows as a calm page, not an error (RC.12). */
export default async function DocPage(props: Parameters<typeof DocPageInner>[0]) {
  try {
    return await DocPageInner(props);
  } catch (e) {
    const busy = githubBusy(e);
    if (!busy) throw e;
    return <GithubBusy until={busy.until} back={`/workspace/${(await props.params).packageId}/course`} />;
  }
}

/** The document's own title (its FC-18 header), shown instead of the file path. */
function docTitle(text: string): string | null {
  const header = /^\{\{nyml[ \t]*\r?\n([\s\S]*?)\r?\n\}\}/.exec(text)?.[1] ?? "";
  const t = /^title:[ \t]*(.+)$/m.exec(header)?.[1]?.trim();
  return t ? t.slice(0, 200) : null;
}
