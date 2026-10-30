"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { can, normalizePath, type Role, type StatusChange } from "@alembic/package-contract";
import { MAX_STATUS_PATHS } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

/** Ask for a Publish (the worker runs it). There are no choices: the files' statuses decide (family SITE-TYPE-CONTRACT §7). */
export async function requestPublishAction(packageId: string): Promise<void> {
  const { supabase } = await member(packageId);
  const { error } = await supabase.rpc("request_publish", { p: packageId, p_choices: {} });
  if (error) {
    back(packageId, error.code === "42501" ? "Only the owner or deputy publishes."
      : error.code === "55006" && /status change/.test(error.message) ? "Status changes are still being saved. Publish again in a few seconds."
      : error.code === "55006" ? "Publish is already running; it will include everything marked completed by then."
      : "Publish couldn't be started. Try again.");
  }
  back(packageId);
}

/**
 * Mark pages completed or draft, take files off the website or bring them back — one page or a whole
 * chapter at once (a course operation the worker applies; it re-checks each right).
 * `paths` is a `|`-joined list bound by the page, since a submit button's own value never reaches a formAction.
 */
export async function setStatusAction(packageId: string, joined: string, status: StatusChange, back_?: string): Promise<void> {
  return withGithub(packageId, async () => {
    const { user, role } = await member(packageId);
    const to = back_ && back_.startsWith(`/workspace/${packageId}/`) ? back_ : `/workspace/${packageId}/publish`;
    const done = (msg?: string) => { revalidatePath(to.split("?")[0]!); return redirect(`${to}${msg ? `${to.includes("?") ? "&" : "?"}m=${encodeURIComponent(msg)}` : ""}`); };
    if ((status === "withdrawn" || status === "public") && !can(role, "edit.course-files")) done("Only the owner or deputy takes files off the website or brings them back.");
    const paths: string[] = [];
    for (const p of String(joined ?? "").split("|")) { if (!p) continue; try { paths.push(normalizePath(p)); } catch { /* skipped */ } }
    if (!paths.length || paths.length > MAX_STATUS_PATHS) done("Nothing to change.");
    if (!(await queueCourseOp(packageId, user!.id, { op: "setStatus", paths, status }, `status:${status}`))) done("That can't be changed here right now.");
    done();
  });
}
