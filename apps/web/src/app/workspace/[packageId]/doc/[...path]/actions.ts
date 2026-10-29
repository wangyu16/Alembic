"use server";

import { newDocId, normalizePath } from "@alembic/package-contract";
import { enqueueSync, SyncRefused } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { directDb } from "@/lib/db";
import { courseRepo, textVersion } from "@/lib/course-v3";
import { githubBusy } from "@/lib/github-busy";
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
  return c.repo.readFile(await c.repo.head(), p).catch((e) => { if (githubBusy(e)) return null; throw e; }); // RC.12: the include shows as unavailable
}

export async function mintUidAction(): Promise<string> {
  return newDocId();
}

/** The text of one version of a document (members only), for live updates in an open editor. */
export async function readVersionAction(packageId: string, path: string, commitSha: string, version: string): Promise<string | null> {
  const { supabase, user } = await signedIn();
  if (!user) return null;
  const { data: role } = await supabase.rpc("course_role", { p: packageId });
  if (!role || !/^[0-9a-f]{40}$/.test(commitSha)) return null;
  let p: string;
  try { p = normalizePath(path); } catch { return null; }
  const c = await courseRepo(packageId);
  const text = c ? await c.repo.readFile(commitSha, p).catch((e) => { if (githubBusy(e)) return null; throw e; }) : null; // RC.12: the update arrives with the next one
  return text !== null && textVersion(text) === version ? text : null;
}

/** Does the course hold this exact version of the document? (members only; resume never resends what arrived, RC.17) */
export async function hasVersionAction(packageId: string, path: string, version: string): Promise<boolean> {
  const { supabase, user } = await signedIn();
  if (!user || !/^[0-9a-f]{64}$/.test(version)) return false;
  const { data } = await supabase.from("doc_versions").select("version").eq("package_id", packageId).eq("path", path).eq("version", version).limit(1);
  return (data ?? []).length > 0;
}
