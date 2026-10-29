"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { can, newDocId, WorkingManifestV3Schema, type Role } from "@alembic/package-contract";
import { addChapters, CHAPTER_PARTS, chapterPartPath, chapterPartText, enqueueSync, SqlQueueStore, SyncRefused, type ChapterPart } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { directDb } from "@/lib/db";
import { courseRepo, textVersion } from "@/lib/course-v3";
import { githubBusy } from "@/lib/github-busy";

const back = (packageId: string, msg?: string) => {
  revalidatePath(`/workspace/${packageId}/course`);
  return redirect(`/workspace/${packageId}/course${msg ? `?m=${encodeURIComponent(msg)}` : ""}`);
};

/** A GitHub rate limit inside an action becomes a message on the page, not an error page (RC.12). */
async function withGithub(packageId: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (!githubBusy(e)) throw e; // includes Next's redirects
    back(packageId, "GitHub is limiting how often Alembic may read this course right now; nothing was changed. Please try again in a few minutes.");
  }
}

async function member(packageId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/workspace/${packageId}/course`)}`);
  const { data: role } = await supabase.rpc("course_role", { p: packageId });
  return { user: user!, role: (role ?? "none") as Role };
}

/**
 * Add chapters to the end of the course, as drafts (RC.26): one title per line, so a whole table of contents
 * goes in at once. With `start`, each new chapter's five parts are started too. Owner or deputy: the chapter
 * list is a course setting, changed by compare-and-swap like a status change.
 */
export async function addChaptersAction(packageId: string, form: FormData): Promise<void> {
  return withGithub(packageId, async () => {
    const { user, role } = await member(packageId);
    if (!can(role, "edit.course-files")) back(packageId, "Only the owner or deputy adds chapters.");
    const titles = String(form.get("titles") ?? "").split(/\r?\n/);
    const start = form.get("start") === "on";
    const sql = directDb();
    const c = await courseRepo(packageId);
    if (!sql || !c) back(packageId, "Chapters can't be added right now.");
    const head = await c!.repo.head();
    const text = await c!.repo.readFile(head, "alembic.json");
    if (text === null) back(packageId, "This course's settings can't be read.");
    let next: ReturnType<typeof addChapters>;
    try {
      next = addChapters(WorkingManifestV3Schema.parse(JSON.parse(text!)), titles);
    } catch (e) {
      return back(packageId, e instanceof RangeError ? "That's more than 30 chapters at once. Add them in smaller groups." : "This course's settings can't be read.");
    }
    if (!next.added.length) back(packageId, "Write at least one chapter title.");
    const files: Array<{ path: string; baseVersion: string | null; text: string }> = [
      { path: "alembic.json", baseVersion: textVersion(text!), text: `${JSON.stringify(next.manifest, null, 2)}\n` },
    ];
    if (start) for (const ch of next.added) for (const { part } of CHAPTER_PARTS) files.push({ path: chapterPartPath(part, ch.slug), baseVersion: null, text: chapterPartText(part, ch.title, newDocId()) });
    await new SqlQueueStore(sql!).insert({
      packageId, kind: "system", idem: `chapters:add:${randomUUID()}`, actorId: user.id, priority: 1,
      payload: { files, summary: `Added ${next.added.length === 1 ? `chapter “${next.added[0]!.title}”` : `${next.added.length} chapters`}` },
    });
    const n = next.added.length;
    back(packageId, `${n === 1 ? "The chapter is" : `${n} chapters are`} being added${start ? (n === 1 ? " with its parts" : " with their parts") : ""}; ${n === 1 ? "it appears" : "they appear"} here in a few seconds.`);
  });
}

/** Start one missing part of a chapter, or all of them (RC.26): each from its starting text, as a new document. */
export async function startPartsAction(packageId: string, slug: string, which: ChapterPart | "all"): Promise<void> {
  return withGithub(packageId, async () => {
    const { user } = await member(packageId);
    const sql = directDb();
    const c = await courseRepo(packageId);
    if (!sql || !c || !/^[a-z0-9-]{1,60}$/.test(slug)) back(packageId, "That chapter can't be changed here.");
    const head = await c!.repo.head();
    const m = WorkingManifestV3Schema.parse(JSON.parse((await c!.repo.readFile(head, "alembic.json")) ?? "null"));
    const ch = m.chapters.find((x) => x.slug === slug);
    if (!ch) back(packageId, "That chapter isn't in the course.");
    const { paths } = await c!.client.listTree({ owner: c!.owner, repo: c!.name }, head);
    const have = new Set(paths);
    const files = CHAPTER_PARTS.filter(({ part }) => which === "all" || part === which)
      .map(({ part }) => ({ path: chapterPartPath(part, slug), part }))
      .filter((x) => !have.has(x.path))
      .map((x) => ({ path: x.path, baseVersion: null, text: chapterPartText(x.part, ch!.title, newDocId()) }));
    if (!files.length) back(packageId, "That's already started.");
    try {
      await enqueueSync(sql!, { actorId: user.id, packageId, syncId: randomUUID(), files, fromOpenEditor: false });
    } catch (e) {
      back(packageId, e instanceof SyncRefused ? `Not allowed: ${e.reason}` : "Couldn't reach Alembic.");
    }
    back(packageId, `${files.length === 1 ? "It is" : "They are"} being started; ${files.length === 1 ? "it appears" : "they appear"} here in a few seconds.`);
  });
}
