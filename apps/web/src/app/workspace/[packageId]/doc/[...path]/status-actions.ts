"use server";

import { can, canWritePath, normalizePath, type Role, type StatusChange } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { queueCourseOp } from "@/lib/course-op";

/**
 * One page's status from the document itself (family SITE-TYPE-CONTRACT §7): no page reload, so the
 * editor stays as it is. The worker applies it as a course operation and re-checks the right.
 */
export async function setDocStatusAction(packageId: string, rawPath: string, status: StatusChange): Promise<{ ok: boolean; message?: string }> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Please sign in again." };
  const { data: roleRaw } = await supabase.rpc("course_role", { p: packageId });
  const role = (roleRaw ?? "none") as Role;
  let path: string;
  try { path = normalizePath(rawPath); } catch { return { ok: false, message: "That page can't be found." }; }
  if ((status === "withdrawn" || status === "public") && !can(role, "edit.course-files")) return { ok: false, message: "Only the owner or deputy takes pages off the website." };
  if (!canWritePath(role, path)) return { ok: false, message: "You can't change this page." };
  const ok = await queueCourseOp(packageId, user.id, { op: "setStatus", paths: [path], status }, `status:${status}`);
  return ok ? { ok: true } : { ok: false, message: "That can't be changed right now; try again." };
}
