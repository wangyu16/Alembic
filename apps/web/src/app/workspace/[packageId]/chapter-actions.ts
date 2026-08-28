"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ChapterNotFoundError,
  ChapterOperationError,
  createChapter,
  deleteChapter,
  renameChapter,
  renameChapterPageName,
  reorderChapters,
  setUnitTerm,
} from "@alembic/package-ops";
import { parseManifest, UnitTermSchema } from "@alembic/package-contract";
import { commitFiles, type FileChange } from "@alembic/github-bridge";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { clientForUser, recordSyncedSha } from "@/lib/github";

export interface ChapterResult {
  ok: boolean;
  slug?: string;
  error?: string;
  /**
   * Set when the change saved to the workspace but could not be mirrored to
   * GitHub (missing connection or a failed commit). The save itself succeeded.
   */
  warning?: string;
}

/** Educator-facing notice when the workspace saved but the GitHub mirror didn't. */
const SYNC_WARNING =
  "Saved in your workspace, but not to GitHub yet — your next Save to GitHub will catch it up.";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

function friendly(e: unknown): string {
  if (e instanceof ChapterOperationError || e instanceof ChapterNotFoundError) {
    return e.message;
  }
  return "That chapter change didn't complete. Please try again.";
}

/**
 * Outcome of mirroring a change to GitHub:
 * - "synced"    — nothing to mirror (sandbox package) or the commit landed.
 * - "no-github" — the package is GitHub-backed but no client/repo was
 *                 available, so the mirror was skipped.
 * - "failed"    — the commit was attempted and failed.
 */
type SyncStatus = "synced" | "no-github" | "failed";

/**
 * For GitHub-backed packages, mirror chapter changes to the public repo so the
 * repo source stays in step with the projection. (Sandbox packages need no
 * sync — the projection is canonical until graduation.)
 *
 * Never throws: the caller's DB write has already succeeded, so a mirror
 * problem is reported as a status the action turns into an educator-visible
 * warning — never a silent skip.
 */
async function syncToGitHub(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  store: SupabaseSandboxStore,
  userId: string,
  packageId: string,
  changes: FileChange[],
): Promise<SyncStatus> {
  const record = await store.getPackage(packageId);
  if (record?.storage !== "github") return "synced";
  const repo = record.manifest.publicRepo;
  if (!repo) return "no-github";
  const gh = await clientForUser(supabase, userId);
  if (!gh) return "no-github";
  try {
    const { commitSha } = await commitFiles(
      gh.client,
      { owner: repo.owner, repo: repo.name },
      { repo: "public", summary: "Update course chapters", changes },
    );
    // Advance the synced pointer so chapter edits aren't read as foreign commits.
    await recordSyncedSha(supabase, packageId, commitSha);
    return "synced";
  } catch {
    return "failed";
  }
}

async function fileContent(
  store: SupabaseSandboxStore,
  packageId: string,
  path: string,
): Promise<string | null> {
  const files = await store.listFiles(packageId);
  return files.find((f) => f.repo === "public" && f.path === path)?.content ?? null;
}

/**
 * The `packages.manifest` DB column is a derived read cache of the file
 * manifest (alembic.json). Chapter ops write only through the file-based path
 * (sandbox_files), while column readers (e.g. edit/page.tsx) read the column —
 * so it must be refreshed after every operation that changed the manifest, or
 * the editor keeps serving the stale copy.
 *
 * Returns the raw manifest file content (for mirroring to GitHub), or null if
 * the file is missing.
 */
async function refreshManifestColumn(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  store: SupabaseSandboxStore,
  packageId: string,
): Promise<string | null> {
  const content = await fileContent(store, packageId, "alembic.json");
  if (content === null) return null;
  const manifest = parseManifest(JSON.parse(content));
  await supabase.from("packages").update({ manifest }).eq("id", packageId);
  return content;
}

function resultFor(sync: SyncStatus, slug?: string): ChapterResult {
  return sync === "synced"
    ? { ok: true, slug }
    : { ok: true, slug, warning: SYNC_WARNING };
}

export async function createChapterAction(
  packageId: string,
  title: string,
  pageName?: string,
): Promise<ChapterResult> {
  const { supabase, user } = await requireUser();
  if (!title.trim()) return { ok: false, error: "Give the chapter a title." };
  const store = new SupabaseSandboxStore(supabase);
  try {
    const slug = pageName?.trim() || undefined;
    const chapter = await createChapter(store, packageId, { title: title.trim(), slug });
    const manifest = await refreshManifestColumn(supabase, store, packageId);
    const body = await fileContent(store, packageId, chapter.path);
    const changes: FileChange[] = [];
    if (manifest !== null) changes.push({ path: "alembic.json", content: manifest });
    if (body !== null) changes.push({ path: chapter.path, content: body });
    const sync = await syncToGitHub(supabase, store, user.id, packageId, changes);
    revalidatePath(`/workspace/${packageId}`);
    return resultFor(sync, chapter.slug);
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function renameChapterAction(
  packageId: string,
  slug: string,
  title: string,
): Promise<ChapterResult> {
  const { supabase, user } = await requireUser();
  if (!title.trim()) return { ok: false, error: "Give the chapter a title." };
  const store = new SupabaseSandboxStore(supabase);
  try {
    await renameChapter(store, packageId, slug, title.trim());
    const manifest = await refreshManifestColumn(supabase, store, packageId);
    let sync: SyncStatus = "synced";
    if (manifest !== null) {
      sync = await syncToGitHub(supabase, store, user.id, packageId, [
        { path: "alembic.json", content: manifest },
      ]);
    }
    revalidatePath(`/workspace/${packageId}`);
    return resultFor(sync);
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function reorderChaptersAction(
  packageId: string,
  orderedSlugs: string[],
): Promise<ChapterResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    await reorderChapters(store, packageId, orderedSlugs);
    const manifest = await refreshManifestColumn(supabase, store, packageId);
    let sync: SyncStatus = "synced";
    if (manifest !== null) {
      sync = await syncToGitHub(supabase, store, user.id, packageId, [
        { path: "alembic.json", content: manifest },
      ]);
    }
    revalidatePath(`/workspace/${packageId}`);
    return resultFor(sync);
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function deleteChapterAction(
  packageId: string,
  slug: string,
  path: string,
): Promise<ChapterResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    await deleteChapter(store, packageId, slug);
    const manifest = await refreshManifestColumn(supabase, store, packageId);
    const changes: FileChange[] = [{ path, content: null }];
    if (manifest !== null) changes.push({ path: "alembic.json", content: manifest });
    const sync = await syncToGitHub(supabase, store, user.id, packageId, changes);
    revalidatePath(`/workspace/${packageId}`);
    return resultFor(sync);
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

/**
 * Rename a chapter's page name (file name + public URL). Moves every slug-keyed
 * file and mirrors the move to GitHub (write new paths, delete old). Changes the
 * chapter's public URL — the UI warns before calling this.
 */
export async function renameChapterPageNameAction(
  packageId: string,
  oldSlug: string,
  newSlug: string,
): Promise<ChapterResult> {
  const { supabase, user } = await requireUser();
  if (!newSlug.trim()) return { ok: false, error: "Give the page a name." };
  const store = new SupabaseSandboxStore(supabase);
  try {
    const { slug, moved } = await renameChapterPageName(
      store,
      packageId,
      oldSlug,
      newSlug.trim(),
    );
    const changes: FileChange[] = [];
    for (const m of moved) {
      const content = await fileContent(store, packageId, m.to);
      if (content !== null) changes.push({ path: m.to, content });
      changes.push({ path: m.from, content: null });
    }
    const manifest = await refreshManifestColumn(supabase, store, packageId);
    if (manifest !== null) changes.push({ path: "alembic.json", content: manifest });
    const sync = await syncToGitHub(supabase, store, user.id, packageId, changes);
    revalidatePath(`/workspace/${packageId}`);
    return resultFor(sync, slug);
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

/** Set the course's unit term (chapter / module / lesson / …). */
export async function setUnitTermAction(
  packageId: string,
  term: string,
): Promise<ChapterResult> {
  const parsed = UnitTermSchema.safeParse(term);
  if (!parsed.success) return { ok: false, error: "Unknown structure term." };
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    await setUnitTerm(store, packageId, parsed.data);
    const manifestContent = await refreshManifestColumn(supabase, store, packageId);
    let sync: SyncStatus = "synced";
    if (manifestContent !== null) {
      sync = await syncToGitHub(supabase, store, user.id, packageId, [
        { path: "alembic.json", content: manifestContent },
      ]);
    }
    revalidatePath(`/workspace/${packageId}`);
    return resultFor(sync);
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}
