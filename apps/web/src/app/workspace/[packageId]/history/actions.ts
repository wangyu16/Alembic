"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gitBlobSha } from "@alembic/github-bridge";
import { can, canWritePath, fileKind, normalizePath, unitPartForPath, WorkingManifestV3Schema, type Role } from "@alembic/package-contract";
import { SqlQueueStore } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { directDb } from "@/lib/db";
import { courseRepo, textVersion } from "@/lib/course-v3";
import { inCourseHistory, snapshotSlug } from "@/lib/history-v3";

const docHref = (packageId: string, path: string) => `/workspace/${packageId}/history/${path.split("/").map(encodeURIComponent).join("/")}`;
const back = (to: string, msg: string): never => { revalidatePath(to); redirect(`${to}?m=${encodeURIComponent(msg)}`); };

async function member(packageId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  const { data: role } = await supabase.rpc("course_role", { p: packageId });
  return { supabase, user: user!, role: (role ?? "none") as Role };
}

/**
 * Bring an earlier version back as the newest one (history-v3 §3). `seen` is the version the person was looking at
 * (sha256 of a text, or a figure's blob id); `itemId` answers a Both-changed item ("Use this version", §4).
 */
export async function restoreVersionAction(packageId: string, rawPath: string, sha: string, seen: string | null, itemId: string | null): Promise<void> {
  let path: string;
  try { path = normalizePath(rawPath); } catch { return back(`/workspace/${packageId}/course`, "That document can't be found."); }
  const to = docHref(packageId, path);
  const { supabase, user, role } = await member(packageId);
  if (!can(role, "history.restore-doc") || !canWritePath(role, path)) back(to, "You can't change this document.");
  if (!(await inCourseHistory(packageId, sha))) back(to, "That version isn't in this course's history.");
  const c = await courseRepo(packageId);
  const sql = directDb();
  if (!c || !sql) back(to, "This course can't be reached right now.");
  const coords = { owner: c!.owner, repo: c!.name };
  const head = await c!.repo.head();
  const kind = fileKind(path);
  if (!kind) back(to, "This kind of file can't be restored.");
  let file: { path: string; baseVersion: string | null; text: string | null; blob?: { sha: string; size: number }; baseBlob?: string | null; restoreOf: string };
  if (kind === "text") {
    const old = await c!.repo.readFile(sha, path);
    if (old === null) back(to, "This document didn't exist at that point.");
    const current = await c!.repo.readFile(head, path);
    if (current === null) await mayRestoreRemoved(c!, head, path, gitBlobSha(new TextEncoder().encode(old!)), to);
    file = { path, baseVersion: seen ?? (current === null ? null : textVersion(current)), text: old!, restoreOf: sha };
  } else {
    const [then, now] = await Promise.all([c!.client.listTreeEntries(coords, sha), c!.client.listTreeEntries(coords, head)]);
    const blob = then.entries.find((e) => e.path === path)?.sha;
    if (!blob) back(to, "This figure didn't exist at that point.");
    const current = now.entries.find((e) => e.path === path)?.sha ?? null;
    if (current === null) await mayRestoreRemoved(c!, head, path, blob!, to);
    file = { path, baseVersion: null, text: null, blob: { sha: blob!, size: 0 }, baseBlob: seen ?? current, restoreOf: sha };
  }
  await new SqlQueueStore(sql!).insert({ packageId, kind: "restore", idem: randomUUID(), actorId: user.id, payload: { files: [file!], summary: `Restored the version of ${path.split("/").pop()}` } });
  if (itemId) await supabase.rpc("needs_you_answer", { p_id: itemId, p_answer: { decision: "used-version", commit: sha } });
  back(to, "Restoring that version; it shows here in a few seconds.");
}

/**
 * A removed file comes back only to a place it may be (history-v3 §3, G0r1 B7): not a listed chapter's part (that is
 * restoreChapter's), and not into a public space when the same content now sits under private/ (an answer key moved
 * there must not come back public).
 */
async function mayRestoreRemoved(c: NonNullable<Awaited<ReturnType<typeof courseRepo>>>, head: string, path: string, blob: string, to: string): Promise<void> {
  const part = unitPartForPath(path);
  if (part) {
    const m = WorkingManifestV3Schema.safeParse(JSON.parse((await c.repo.readFile(head, "alembic.json")) ?? "null"));
    if (!m.success || !m.data.chapters.some((ch) => ch.slug === part.slug)) back(to, "This part belongs to a removed chapter: ask the owner or deputy to restore the chapter.");
  }
  if (!path.startsWith("private/")) {
    const now = await c.client.listTreeEntries({ owner: c.owner, repo: c.name }, head);
    if (now.entries.some((e) => e.path.startsWith("private/") && e.sha === blob)) back(to, "This content is now instructor-only, so it can't come back to a public place.");
  }

}

/** Name the course as it is now (history-v3 §5): a tag on the working repo plus a row. */
export async function createSnapshotAction(packageId: string, form: FormData): Promise<void> {
  const to = `/workspace/${packageId}/course`;
  const { user, role } = await member(packageId);
  if (!can(role, "snapshot.create")) back(to, "You can't name versions of this course.");
  const name = String(form.get("name") ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) back(to, "Give the snapshot a name.");
  const c = await courseRepo(packageId);
  const sql = directDb();
  if (!c || !sql) back(to, "This course can't be reached right now.");
  const head = await c!.repo.head();
  const { rows } = await sql!.query<{ slug: string }>(`select slug from public.course_snapshots where package_id = $1`, [packageId]);
  const taken = new Set(rows.map((r) => r.slug));
  const stem = snapshotSlug(name);
  for (let n = 1; n < 50; n++) {
    const slug = n === 1 ? stem : `${stem}-${n}`;
    if (taken.has(slug)) continue;
    try {
      await c!.client.createTag({ owner: c!.owner, repo: c!.name }, `snapshot/${slug}`, head);
    } catch (e) {
      if ((e as { status?: number }).status === 422) continue; // a tag of that name already exists (pushed, or made at the same moment)
      throw e;
    }
    await sql!.query(`insert into public.course_snapshots (package_id, slug, name, commit_sha, created_by) values ($1, $2, $3, $4, $5)`, [packageId, slug, name, head, user.id]);
    back(to, `Saved the course as it is now as “${name}”.`);
  }
  back(to, "That name is used too often; choose another.");
}
