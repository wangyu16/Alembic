"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { gitBlobSha } from "@alembic/github-bridge";
import { can, canWritePath, fileKind, MAX_UPLOAD_BYTES, normalizePath, unitPartForPath, WorkingManifestV3Schema, type Role } from "@alembic/package-contract";
import { checkAnswerKeys, SqlQueueStore } from "@alembic/package-ops";
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
  const c = await courseRepo(packageId);
  const sql = directDb();
  if (!c || !sql) back(to, "This course can't be reached right now.");
  const coords = { owner: c!.owner, repo: c!.name };
  const head = await c!.repo.head();
  const range = await inCourseHistory(packageId, sha, head);
  if (!range.ok) back(to, "That version isn't in this course's history.");
  const kind = fileKind(path);
  if (!kind) back(to, "This kind of file can't be restored.");
  let file: { path: string; baseVersion: string | null; text: string | null; blob?: { sha: string; size: number }; baseBlob?: string | null; restoreOf: string };
  if (kind === "text") {
    const old = await c!.repo.readFile(sha, path);
    if (old === null) back(to, "This document didn't exist at that point.");
    const current = await c!.repo.readFile(head, path);
    if (current === null) await mayRestoreRemoved(c!, head, path, gitBlobSha(new TextEncoder().encode(old!)), to);
    if (!path.startsWith("private/")) await mayRepeatPrivate(c!, head, path, old!, range.changed, to);
    file = { path, baseVersion: seen ?? (current === null ? null : textVersion(current)), text: old!, restoreOf: sha };
  } else {
    const [then, now] = await Promise.all([c!.client.listTreeEntries(coords, sha), c!.client.listTreeEntries(coords, head)]);
    const was = then.entries.find((e) => e.path === path);
    const blob = was?.sha;
    if (!blob) back(to, "This figure didn't exist at that point.");
    if ((was?.size ?? 0) > MAX_UPLOAD_BYTES) back(to, "That version is larger than 4 MB, the most a course file may be."); // audit r1 L-2
    if (!path.startsWith("private/") && (now.truncated || now.entries.some((e) => e.path.startsWith("private/") && e.sha === blob))) back(to, "This picture is now instructor-only, so it can't come back to a public place.");
    const current = now.entries.find((e) => e.path === path)?.sha ?? null;
    if (current === null) await mayRestoreRemoved(c!, head, path, blob!, to);
    file = { path, baseVersion: null, text: null, blob: { sha: blob!, size: 0 }, baseBlob: seen ?? current, restoreOf: sha };
  }
  // "Use the other version": the item is answered only once the restore passed every check, so a refusal leaves it
  // open (audit r2 L-a); a stale or second click is refused (audit r1 M-1).
  if (itemId) {
    const { error } = await supabase.rpc("needs_you_answer", { p_id: itemId, p_answer: { decision: "used-version", commit: sha } });
    if (error) back(to, "That choice was already made.");
  }
  await new SqlQueueStore(sql!).insert({ packageId, kind: "restore", idem: randomUUID(), actorId: user.id, payload: { files: [file!], summary: `Restored the version of ${path.split("/").pop()}` } });
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

/** The most instructor-only text a restore reads to check against (audit r2 H2-1: unbounded reads stalled the server). */
const MAX_PRIVATE_CHECK_BYTES = 1_000_000;
const plainWords = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Never back into a public place a text that repeats instructor-only material (audit r1 H-1, r2 H2-1/M2-1):
 * - an exact copy of any file under private/ now (one tree read, compared by content id), whatever its length;
 * - a 12-word run from, or the whole of a short, instructor file added or changed since that version (Publish's
 *   own check), read within a byte budget: over it, or when the change is too large to list, the person is told
 *   to ask the owner. Files unchanged since were public alongside it then, and Publish still checks them.
 */
async function mayRepeatPrivate(c: NonNullable<Awaited<ReturnType<typeof courseRepo>>>, head: string, path: string, old: string, changed: Array<{ path: string; status: string }> | null, to: string): Promise<void> {
  const now = await c.client.listTreeEntries({ owner: c.owner, repo: c.name }, head);
  const tooMuch = "Too much instructor-only material changed since that version to check it here; ask the owner.";
  if (now.truncated) back(to, tooMuch);
  const blob = gitBlobSha(new TextEncoder().encode(old));
  if (now.entries.some((e) => e.path.startsWith("private/") && e.sha === blob)) back(to, "This content is now instructor-only, so it can't come back to a public place.");
  if (changed === null) back(to, tooMuch);
  const sizes = new Map(now.entries.map((e) => [e.path, e.size ?? 0]));
  const priv = changed!.filter((f) => f.path.startsWith("private/") && f.status !== "removed" && fileKind(f.path) === "text" && sizes.has(f.path));
  if (priv.reduce((n, f) => n + sizes.get(f.path)!, 0) > MAX_PRIVATE_CHECK_BYTES) back(to, tooMuch);
  const texts = (await Promise.all(priv.map(async (f) => ({ path: f.path, text: (await c.repo.readFile(head, f.path)) ?? "" })))).filter((t) => t.text.trim());
  const flat = ` ${plainWords(old)} `;
  const short = texts.some((t) => { const w = plainWords(t.text); return w.split(" ").length < 12 && w.length >= 8 && flat.includes(` ${w} `); });
  if (short || checkAnswerKeys(path, old, texts).length) back(to, "That version repeats instructor-only material, so it can't come back to a public place.");
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
