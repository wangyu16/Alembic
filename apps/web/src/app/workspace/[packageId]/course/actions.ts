"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { can, EXAMS_FOLDER, newDocId, TERM_STARTERS, termFolder, termPageStarter, termSlug, WorkingManifestV3Schema, type Role } from "@alembic/package-contract";
import { CHAPTER_PARTS, chapterPartPath, chapterPartText, enqueueSync, MAX_NEW_CHAPTERS, SyncRefused, type ChapterPart } from "@alembic/package-ops";
import { queueCourseOp } from "@/lib/course-op";
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
  const { user, role } = await member(packageId);
  if (!can(role, "edit.course-files")) back(packageId, "Only the owner or deputy adds chapters.");
  const titles = String(form.get("titles") ?? "").split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
  const start = form.get("start") === "on";
  if (!titles.length) back(packageId, "Write at least one chapter title.");
  if (titles.length > MAX_NEW_CHAPTERS) back(packageId, `That's more than ${MAX_NEW_CHAPTERS} chapters at once. Add them in smaller groups.`);
  // A course operation (contract v3 §13): the worker adds them to the course as it is then (each with at least its study guide).
  if (!(await queueCourseOp(packageId, user.id, { op: "addChapters", titles, startParts: start }))) back(packageId, "Chapters can't be added right now.");
  const n = titles.length;
  back(packageId, `${n === 1 ? "The chapter is" : `${n} chapters are`} being added${start ? (n === 1 ? " with its parts" : " with their parts") : ""}; ${n === 1 ? "it appears" : "they appear"} here in a few seconds (up to a minute when the course is busy).`);
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
    back(packageId, `${files.length === 1 ? "It is" : "They are"} being started; ${files.length === 1 ? "it appears" : "they appear"} here in a few seconds (up to a minute when the course is busy).`);
  });
}

/** A course option (owner or deputy): "an edit returns a completed page to draft" (owner's ruling 2026-10-30, default off). */
export async function setEditReturnsToDraftAction(packageId: string, value: boolean): Promise<void> {
  const { user, role } = await member(packageId);
  if (!can(role, "edit.course-files")) back(packageId, "Only the owner or deputy changes the course's options.");
  if (!(await queueCourseOp(packageId, user.id, { op: "setOption", option: "editReturnsToDraft", value }, "option"))) back(packageId, "That can't be changed right now; try again.");
  back(packageId, value ? "From now on, an edit returns a completed page to draft." : "Edits no longer change a page's status.");
}

/** The course-website add-on on or off (owner or deputy; course-website-addon §4). */
export async function setCourseWebsiteAction(packageId: string, on: boolean): Promise<void> {
  const { user, role } = await member(packageId);
  if (!can(role, "edit.course-files")) back(packageId, "Only the owner or deputy changes the course's options.");
  if (!(await queueCourseOp(packageId, user.id, { op: "setAddon", addon: "course-website", on }, "addon"))) back(packageId, "That can't be changed right now; try again.");
  back(packageId, on ? "The course website is being set up: a home page and this semester's folder appear in a few seconds." : "The course website is off; its pages stay in the course but aren't published.");
}

/** Add a term, optionally from the current term's pages (owner or deputy; course-website-addon §2). */
export async function addTermAction(packageId: string, copyFrom: string | null, form: FormData): Promise<void> {
  const { user, role } = await member(packageId);
  if (!can(role, "edit.course-files")) back(packageId, "Only the owner or deputy adds terms.");
  const title = String(form.get("title") ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  if (!title) back(packageId, "Give the term a name, for example “Spring 2027”.");
  const copy = form.get("copy") === "on" && copyFrom ? copyFrom : undefined;
  if (!(await queueCourseOp(packageId, user.id, { op: "addTerm", title, makeCurrent: form.get("current") === "on", ...(copy ? { copyFrom: copy } : {}) }, "term"))) back(packageId, "That can't be changed right now; try again.");
  back(packageId, `Adding “${title}”${copy ? " with copies of this term's pages (as drafts)" : ""}.`);
}

export async function setCurrentTermAction(packageId: string, form: FormData): Promise<void> {
  const { user, role } = await member(packageId);
  if (!can(role, "edit.course-files")) back(packageId, "Only the owner or deputy changes the current term.");
  const slug = String(form.get("term") ?? "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) back(packageId, "Choose a term.");
  if (!(await queueCourseOp(packageId, user.id, { op: "setCurrentTerm", slug }, "term"))) back(packageId, "That can't be changed right now; try again.");
  back(packageId, "Changed the current term; the website shows it after the next Publish.");
}

/**
 * Start a page in this term's folder or the Exams folder: a recommended one (syllabus …) or any name. It starts as a
 * draft; never over a file that is there. Anyone who may edit the course (the write path re-checks).
 */
export async function startTermPageAction(packageId: string, where: "term" | "exams", starter: string | null, form: FormData | null): Promise<void> {
  return withGithub(packageId, async () => {
    const { user } = await member(packageId);
    const sql = directDb();
    const c = await courseRepo(packageId);
    if (!sql || !c) back(packageId, "That can't be done right now.");
    const head = await c!.repo.head();
    const m = WorkingManifestV3Schema.parse(JSON.parse((await c!.repo.readFile(head, "alembic.json")) ?? "null"));
    const term = m.terms?.find((t) => t.slug === m.currentTerm);
    if (where === "term" && !term) back(packageId, "Add a term first.");
    const rec = starter ? TERM_STARTERS.find((s) => s.id === starter) : undefined;
    const name = rec ? rec.file : `${termSlug(String(form?.get("name") ?? "")) || "page"}.md`;
    const label = rec ? rec.label : String(form?.get("name") ?? "").replace(/\s+/g, " ").trim().slice(0, 100) || "Page";
    const folder = where === "term" ? termFolder(term!.slug) : `${EXAMS_FOLDER}/`;
    const path = `${folder}${name}`;
    if ((await c!.repo.readFile(head, path)) !== null) back(packageId, `${label} is already there.`);
    const text = termPageStarter(label, where === "term" ? term!.title : "Exams", newDocId(), rec?.body ?? "");
    try {
      await enqueueSync(sql!, { actorId: user.id, packageId, syncId: randomUUID(), files: [{ path, baseVersion: null, text }], fromOpenEditor: false });
    } catch (e) {
      back(packageId, e instanceof SyncRefused ? `Not allowed: ${e.reason}` : "Couldn't reach Alembic.");
    }
    back(packageId, `${label} is being started; it appears here in a few seconds.`);
  });
}
