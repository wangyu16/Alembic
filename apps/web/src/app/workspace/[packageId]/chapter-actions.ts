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
import { UnitTermSchema } from "@alembic/package-contract";
import { commitFiles, type FileChange } from "@alembic/github-bridge";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { clientForUser, recordSyncedSha } from "@/lib/github";

export interface ChapterResult {
  ok: boolean;
  slug?: string;
  error?: string;
}

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
 * For GitHub-backed packages, mirror chapter changes to the public repo so the
 * repo source stays in step with the projection. (Sandbox packages need no
 * sync — the projection is canonical until graduation.)
 */
async function syncToGitHub(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  store: SupabaseSandboxStore,
  userId: string,
  packageId: string,
  changes: FileChange[],
): Promise<void> {
  const record = await store.getPackage(packageId);
  const repo = record?.storage === "github" ? record.manifest.publicRepo : null;
  if (!repo) return;
  const gh = await clientForUser(supabase, userId);
  if (!gh) return;
  const { commitSha } = await commitFiles(
    gh.client,
    { owner: repo.owner, repo: repo.name },
    { repo: "public", summary: "Update course chapters", changes },
  );
  // Advance the synced pointer so chapter edits aren't read as foreign commits.
  await recordSyncedSha(supabase, packageId, commitSha);
}

async function fileContent(
  store: SupabaseSandboxStore,
  packageId: string,
  path: string,
): Promise<string | null> {
  const files = await store.listFiles(packageId);
  return files.find((f) => f.repo === "public" && f.path === path)?.content ?? null;
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
    const manifest = await fileContent(store, packageId, "alembic.json");
    const body = await fileContent(store, packageId, chapter.path);
    const changes: FileChange[] = [];
    if (manifest !== null) changes.push({ path: "alembic.json", content: manifest });
    if (body !== null) changes.push({ path: chapter.path, content: body });
    await syncToGitHub(supabase, store, user.id, packageId, changes);
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true, slug: chapter.slug };
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
    const manifest = await fileContent(store, packageId, "alembic.json");
    if (manifest !== null) {
      await syncToGitHub(supabase, store, user.id, packageId, [
        { path: "alembic.json", content: manifest },
      ]);
    }
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
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
    const manifest = await fileContent(store, packageId, "alembic.json");
    if (manifest !== null) {
      await syncToGitHub(supabase, store, user.id, packageId, [
        { path: "alembic.json", content: manifest },
      ]);
    }
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
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
    const manifest = await fileContent(store, packageId, "alembic.json");
    const changes: FileChange[] = [{ path, content: null }];
    if (manifest !== null) changes.push({ path: "alembic.json", content: manifest });
    await syncToGitHub(supabase, store, user.id, packageId, changes);
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
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
    const manifest = await fileContent(store, packageId, "alembic.json");
    if (manifest !== null) changes.push({ path: "alembic.json", content: manifest });
    await syncToGitHub(supabase, store, user.id, packageId, changes);
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true, slug };
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
    const manifest = await fileContent(store, packageId, "alembic.json");
    if (manifest !== null) {
      await syncToGitHub(supabase, store, user.id, packageId, [
        { path: "alembic.json", content: manifest },
      ]);
    }
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}
