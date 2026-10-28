"use server";

import { newDocId, normalizePath } from "@alembic/package-contract";
import { enqueueSync, SyncRefused } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { directDb } from "@/lib/db";
import { courseRepo } from "@/lib/course-v3";
import type { SendResult } from "@/lib/device-save/scheduler";

async function signedIn() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

/** Send a document's text to the course: one queue row, checked against the permission matrix (A4). */
export async function syncDocAction(a: { packageId: string; path: string; text: string; baseVersion: string | null; syncId: string }): Promise<SendResult> {
  const { user } = await signedIn();
  if (!user) return { ok: false, retryable: false, reason: "Sign in again to sync." };
  const sql = directDb();
  if (!sql) return { ok: false, retryable: true, reason: "Syncing isn't available here." };
  try {
    await enqueueSync(sql, { actorId: user.id, packageId: a.packageId, syncId: a.syncId, files: [{ path: a.path, baseVersion: a.baseVersion, text: a.text }], fromOpenEditor: true });
    return { ok: true };
  } catch (e) {
    if (e instanceof SyncRefused) return { ok: false, retryable: false, reason: e.reason };
    return { ok: false, retryable: true, reason: "Couldn't reach Alembic." };
  }
}

/** Another text file of the course, for an include in the preview (members only). */
export async function readCourseTextAction(packageId: string, path: string): Promise<string | null> {
  const { supabase, user } = await signedIn();
  if (!user) return null;
  const { data: role } = await supabase.rpc("course_role", { p: packageId });
  if (!role) return null;
  let p: string;
  try { p = normalizePath(path); } catch { return null; }
  const c = await courseRepo(packageId);
  if (!c) return null;
  return c.repo.readFile(await c.repo.head(), p);
}

export async function mintUidAction(): Promise<string> {
  return newDocId();
}
