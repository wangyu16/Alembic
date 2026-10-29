"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { can, newDocId, WorkingManifestV3Schema, type Role } from "@alembic/package-contract";
import { chapterPartPath, chapterPartText, enqueueSync, SqlQueueStore, SyncRefused } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { directDb } from "@/lib/db";
import { courseRepo, textVersion } from "@/lib/course-v3";
import { githubBusy } from "@/lib/github-busy";
import { queueCourseOp } from "@/lib/course-op";

const back = (packageId: string, msg?: string) => {
  revalidatePath(`/workspace/${packageId}/publish`); // the page shows the new state at once (RC.24)
  return redirect(`/workspace/${packageId}/publish${msg ? `?m=${encodeURIComponent(msg)}` : ""}`);
};

/** A GitHub rate limit inside an action becomes a message on the page, not an error page (RC.12). */
async function withGithub<T>(packageId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const busy = githubBusy(e);
    if (!busy) throw e; // includes Next's redirects
    const at = busy.until ? ` after ${busy.until.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago", timeZoneName: "short" })}` : " in a few minutes";
    return back(packageId, `GitHub is limiting how often Alembic may read this course right now; nothing was changed. Please try again${at}.`);
  }
}

async function member(packageId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/workspace/${packageId}/publish`)}`);
  const { data: role } = await supabase.rpc("course_role", { p: packageId });
  return { supabase, user, role: (role ?? "none") as Role };
}

/** Ask for a Publish with the publisher's choices (the worker runs it). */
export async function requestPublishAction(packageId: string, form: FormData): Promise<void> {
  const { supabase } = await member(packageId);
  // A chapter status change still on its way would be published as it was (RC.24): wait for it.
  const { data: pending } = await supabase.from("write_queue").select("id").eq("package_id", packageId)
    .in("status", ["queued", "processing", "retry"]).or("kind.eq.courseop,idem_key.like.system:mode:%").limit(1);
  if (pending?.length) back(packageId, "A chapter's status change is still being saved. Publish again in a few seconds.");
  // Each choice names the version that was shown (path@version, slug@digest): the job applies it only to that.
  const approveAndPublish = form.getAll("approve").flatMap((v) => (typeof v === "string" ? v.split("|") : []))
    .filter((v) => /^(concepts|assessment-support)\/[a-z0-9-]{1,60}\.md@[0-9a-f]{64}$/.test(v));
  const publishAnyway = form.getAll("anyway").filter((v): v is string => typeof v === "string" && /^[a-z0-9-]{1,60}@[0-9a-f]{64}$/.test(v));
  const { error } = await supabase.rpc("request_publish", { p: packageId, p_choices: { approveAndPublish, publishAnyway } });
  if (error) {
    back(packageId, error.code === "42501" ? "Only the owner or deputy publishes."
      : error.code === "55006" && /status change/.test(error.message) ? "A chapter's status change is still being saved. Publish again in a few seconds."
      : error.code === "55006" ? "Publish is already running; try again when it has finished."
      : "Publish couldn't be started. Try again.");
  }
  back(packageId);
}

/**
 * Start a chapter's course plan: its concept map and assessment guide, as new
 * documents (each passes the permission matrix like any edit).
 */
export async function startPlanAction(packageId: string, slug: string): Promise<void> {
  return withGithub(packageId, () => startPlan(packageId, slug));
}

async function startPlan(packageId: string, slug: string): Promise<void> {
  const { user } = await member(packageId);
  const sql = directDb();
  const c = await courseRepo(packageId);
  if (!sql || !c || !/^[a-z0-9-]{1,60}$/.test(slug)) back(packageId, "That chapter can't be changed here.");
  const head = await c!.repo.head();
  const m = WorkingManifestV3Schema.parse(JSON.parse((await c!.repo.readFile(head, "alembic.json")) ?? "null"));
  const ch = m.chapters.find((x) => x.slug === slug);
  if (!ch) back(packageId, "That chapter isn't in the course.");
  const files = [];
  for (const part of ["concepts", "assessment-support"] as const) {
    const path = chapterPartPath(part, slug);
    if ((await c!.repo.readFile(head, path)) === null) files.push({ path, baseVersion: null, text: chapterPartText(part, ch!.title, newDocId()) });
  }
  if (files.length === 0) back(packageId);
  try {
    await enqueueSync(sql!, { actorId: user!.id, packageId, syncId: randomUUID(), files, fromOpenEditor: false });
  } catch (e) {
    back(packageId, e instanceof SyncRefused ? `Not allowed: ${e.reason}` : "Couldn't reach Alembic.");
  }
  back(packageId, "The course plan documents are being added; they appear in a few seconds.");
}

/** Mark a chapter ready for publishing, or back to draft (the manifest is changed by a system row, owner or deputy only). */
export async function setChapterModeAction(packageId: string, slug: string, mode: "draft" | "package"): Promise<void> {
  return withGithub(packageId, () => setChapterMode(packageId, slug, mode));
}

async function setChapterMode(packageId: string, slug: string, mode: "draft" | "package"): Promise<void> {
  const { user, role } = await member(packageId);
  if (!can(role, "edit.course-files")) back(packageId, "Only the owner or deputy changes this.");
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) back(packageId, "That chapter isn't in the course.");
  // A course operation (contract v3 §13): the worker applies it to the course as it is then.
  if (!(await queueCourseOp(packageId, user!.id, { op: "setChapterMode", slug, mode }, `mode:${slug}:${mode}`))) back(packageId, "That chapter can't be changed here.");
  back(packageId, "Saved; it takes a few seconds to show.");
}

/**
 * Approve a chapter's course plan now, as it was shown (path@version of each part; owner or deputy,
 * checked by approve_part). Takes effect at once, so the page shows it (RC.15).
 */
export async function approvePlanNowAction(packageId: string, shown: string): Promise<void> {
  const { supabase } = await member(packageId);
  // The parts as shown come as a bound argument: Next replaces a submit button's name with its own
  // action reference, so a button's name/value never reaches a formAction (RC.21).
  const parts = String(shown ?? "").split("|")
    .map((v) => /^((?:concepts|assessment-support)\/[a-z0-9-]{1,60}\.md)@([0-9a-f]{64})$/.exec(v))
    .filter((m): m is RegExpExecArray => m !== null);
  if (!parts.length) back(packageId, "Nothing to approve.");
  for (const m of parts) {
    const { error } = await supabase.rpc("approve_part", { p: packageId, p_path: m[1], p_version: m[2] });
    if (error) back(packageId, error.code === "42501" ? "Only the owner or deputy approves the course plan." : "The approval couldn't be saved. Try again.");
  }
  back(packageId, "Course plan approved.");
}
