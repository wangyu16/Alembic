import { GithubBusy, githubBusy } from "@/lib/github-busy";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { canWritePath, isPage, normalizePath, statusOf, type StatusMap } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { v3Enabled } from "@/lib/db";
import { courseRepo, recordDocVersion } from "@/lib/course-v3";
import { assetSecret, assetUrlMap } from "@/lib/course-assets";
import { can, type Role } from "@alembic/package-contract";
import { kindOfPath } from "@/lib/orz-editor/kit";
import { DocEditor } from "./doc-editor";
import { StatusControl } from "./status-control";
import { SharePanel, type ShareRow } from "./share-panel";
import { shareablesOf } from "@alembic/package-ops";

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
  // Versions recorded after this moment are caught up by the editor once it listens (audit r5 MEDIUM-2; 2 s for clock skew).
  const renderedAt = new Date(Date.now() - 2000).toISOString();
  const head = await c.repo.head();
  const text = await c.repo.readFile(head, path);
  if (text === null) redirect(`/workspace/${packageId}/course`);
  const version = await recordDocVersion(packageId, path, text, head);
  // The course's images, for the editor's preview (one tree listing; RC.9).
  const tree = await c.client.listTreeEntries({ owner: c.owner, repo: c.name }, head).catch((e) => {
    if (githubBusy(e)) throw e;
    return { entries: [] as Array<{ path: string; type: string; sha: string }> };
  });
  // The page's status (family SITE-TYPE-CONTRACT §7) and whether it is on the website.
  let statusMap: StatusMap | undefined;
  let editReturnsToDraft = false;
  try {
    const m = JSON.parse((await c.repo.readFile(head, "alembic.json")) ?? "{}") as { status?: StatusMap; options?: { editReturnsToDraft?: boolean } };
    statusMap = m.status;
    editReturnsToDraft = m.options?.editReturnsToDraft === true;
  } catch { statusMap = undefined; }
  const { data: pubRow } = await supabase.from("published_files").select("path").eq("package_id", packageId).eq("path", path).maybeSingle();
  // What of this page can be shared on its own (element-sharing-v3): its figures and its sections with a block id.
  const shareables = isPage(path) ? shareablesOf(path, text) : [];
  let shareRows: ShareRow[] = [];
  if (shareables.length) {
    const figurePaths = shareables.filter((x) => x.kind === "figure").map((x) => x.path);
    const [{ data: pubFigures }, { data: shared }] = await Promise.all([
      figurePaths.length ? supabase.from("published_files").select("path").eq("package_id", packageId).in("path", figurePaths) : Promise.resolve({ data: [] as Array<{ path: string }> }),
      supabase.from("shared_elements").select("id, path, anchor").eq("package_id", packageId).is("stopped_at", null).in("path", [path, ...figurePaths]),
    ]);
    const onSite = new Set(((pubFigures ?? []) as Array<{ path: string }>).map((r) => r.path));
    const active = new Map(((shared ?? []) as Array<{ id: string; path: string; anchor: string | null }>).map((r) => [`${r.path}#${r.anchor ?? ""}`, r.id]));
    shareRows = shareables.map((x) => ({
      kind: x.kind, path: x.path, anchor: x.anchor ?? null, title: x.title,
      published: x.kind === "figure" ? onSite.has(x.path) : !!pubRow,
      id: active.get(`${x.path}#${x.anchor ?? ""}`) ?? null,
    }));
  }
  const secret = assetSecret();
  const assets = secret ? assetUrlMap(packageId, tree.entries.filter((e) => e.type === "blob"), can(role as Role, "edit.private"), secret) : new Map<string, string>();

  return (
    <main className="flex h-[calc(100dvh-3.75rem)] flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2 text-sm">
        <Link prefetch={false} href={`/workspace/${packageId}/course`} className="underline">← Course</Link>
        <Link prefetch={false} href={`/workspace/${packageId}/history/${path.split("/").map(encodeURIComponent).join("/")}`} className="underline" data-testid="history-link">History</Link>
        <span className="min-w-0 max-w-full truncate font-medium">{docTitle(text) ?? path}</span>
        {docTitle(text) ? <span className="hidden text-xs text-muted md:inline">{path}</span> : null}
        {isPage(path) ? (
          <StatusControl packageId={packageId} path={path} status={statusOf(statusMap, path)} published={!!pubRow}
            canEdit={canWritePath(role as Role, path)} lead={can(role as Role, "edit.course-files")} editReturnsToDraft={editReturnsToDraft} />
        ) : null}
        <SharePanel packageId={packageId} page={path} rows={shareRows} canEdit={canWritePath(role as Role, path)} />
      </div>
      <div className="min-h-0 flex-1">
        <DocEditor kind={kind} packageId={packageId} path={path} text={text} version={version} renderedAt={renderedAt} isPrivate={path.startsWith("private/")} assets={[...assets]} nonce={(await headers()).get("x-nonce") ?? undefined} />
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
