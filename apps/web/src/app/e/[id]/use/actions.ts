"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { activeProfile, canWritePath, isPage, normalizePath, type Role } from "@alembic/package-contract";
import { enqueueSync, sectionText, SqlQueueStore, SyncRefused, usedElementText } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { directDb } from "@/lib/db";
import { courseRepo, recordDocVersion } from "@/lib/course-v3";
import { elementBytes, loadElement } from "@/lib/shared-element";
import { storeFigure } from "@/lib/store-figure";

const back = (id: string, m: string, course?: string) => redirect(`/e/${id}/use?${course ? `course=${encodeURIComponent(course)}&` : ""}m=${encodeURIComponent(m)}`);

/**
 * Use a shared element in one's own course (element-sharing-v3 §3, step 2): only when its licence is open; a figure
 * is copied through the upload path into the page's figure folder; the page gets the element and its credit at the
 * end, as an ordinary edit of the person (History, the version rule).
 */
export async function useElementAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const packageId = String(formData.get("course") ?? "");
  let page: string;
  try { page = normalizePath(String(formData.get("page") ?? "")); } catch { return back(id, "Choose a page.", packageId); }
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/e/${id}/use`)}`);
  const e = await loadElement(id);
  if (!e) return back(id, "This element is no longer available.");
  if (!activeProfile.licences.open.includes(e.course.licence)) return back(id, "This element's licence doesn't allow using it in another course.");
  const { data: roleData } = await supabase.rpc("course_role", { p: packageId });
  const role = (roleData ?? "none") as Role;
  if (!isPage(page) || !canWritePath(role, page)) return back(id, "You can't change that page.", packageId);
  const sql = directDb();
  const course = await courseRepo(packageId);
  if (!sql || !course) return back(id, "That course can't be reached right now. Try again in a few minutes.", packageId);
  const credit = { title: e.title, course: e.course.title, authors: e.course.authors, licence: e.course.licence, pageUrl: e.course.pageUrl };

  let figurePath: string | undefined;
  if (e.kind === "figure") {
    const bytes = await elementBytes(e);
    if (!bytes) return back(id, "The figure couldn't be fetched from its course website. Try again in a few minutes.", packageId);
    const folder = activeProfile.figureFolder(page);
    const name = e.path.split("/").pop()!;
    const dot = name.lastIndexOf(".");
    let stored: Awaited<ReturnType<typeof storeFigure>> | null = null;
    for (let k = 1; k <= 5; k++) {
      const candidate = `${folder}/${k === 1 ? name : `${name.slice(0, dot)}-${k}${name.slice(dot)}`}`;
      stored = await storeFigure({ sql, packageId, uploader: user.id, role, path: candidate, bytes, baseBlob: null, fromDoc: page });
      if (stored.ok || stored.status !== 409) break;
    }
    if (!stored?.ok) return back(id, stored?.message ?? "The figure couldn't be added.", packageId);
    figurePath = stored.path;
    await new SqlQueueStore(sql).insert({
      packageId, kind: "sync", idem: randomUUID(), actorId: user.id,
      payload: { files: [{ path: stored.path, baseVersion: null, text: null, blob: { sha: stored.sha, size: stored.size }, baseBlob: null }], fromOpenEditor: false, summary: `Added ${stored.path.split("/").pop()} from “${e.course.title}”` },
    });
  }
  const sectionMd = e.kind === "section" ? sectionText(e.pageText ?? "", e.anchor!) : undefined;
  if (e.kind === "section" && !sectionMd) return back(id, "This section is no longer available.", packageId);
  const head = await course.repo.head();
  const current = await course.repo.readFile(head, page);
  if (current === null) return back(id, "That page isn't in the course any more.", packageId);
  const baseVersion = await recordDocVersion(packageId, page, current, head);
  const text = current.trimEnd() + "\n" + usedElementText({ kind: e.kind, pagePath: page, credit, ...(figurePath ? { figurePath } : {}), ...(sectionMd ? { sectionMd } : {}) });
  try {
    await enqueueSync(sql, { actorId: user.id, packageId, syncId: randomUUID(), files: [{ path: page, baseVersion, text }], fromOpenEditor: false });
  } catch (err) {
    return back(id, err instanceof SyncRefused ? `It couldn't be added: ${err.reason}.` : "It couldn't be added right now. Try again in a few minutes.", packageId);
  }
  redirect(`/workspace/${packageId}/doc/${page.split("/").map(encodeURIComponent).join("/")}?m=${encodeURIComponent(`Added “${e.title}” at the end of this page, with its credit.`)}`);
}
