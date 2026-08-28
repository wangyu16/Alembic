"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ChapterNotFoundError,
  ChapterOperationError,
  CommitFailedError,
  CommitUnavailableError,
  ManifestConflictError,
  createChapter,
  deleteChapter,
  renameChapter,
  renameChapterPageName,
  reorderChapters,
  setUnitTerm,
  type Committer,
} from "@alembic/package-ops";
import { UnitTermSchema, type PackageManifest } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { committerFor } from "@/lib/committer";
import { manifestFromFiles } from "@/lib/manifest-read";

/**
 * Chapter operations, on the one write path
 * (docs/specs/storage-and-write-paths.md §3).
 *
 * Every action here resolves the package's write path ONCE via `committerFor`
 * and hands the result to package-ops, which writes the manifest through
 * `updateManifest` and chapter files through `writeThrough`. A published
 * package whose online home is unreachable is refused outright — there is no
 * "saved here but not there" half-success any more, because a save that didn't
 * reach permanence didn't happen.
 */

export interface ChapterResult {
  ok: boolean;
  slug?: string;
  error?: string;
}

/** Educator-facing wording for a same-time edit by another tab or person. */
const CONFLICT_MESSAGE =
  "Someone changed this course at the same time. Reload and try again.";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

function friendly(e: unknown): string {
  if (e instanceof ManifestConflictError) return CONFLICT_MESSAGE;
  // Both carry educator-facing copy already (no Git vocabulary).
  if (e instanceof CommitUnavailableError || e instanceof CommitFailedError) {
    return e.message;
  }
  if (e instanceof ChapterOperationError || e instanceof ChapterNotFoundError) {
    return e.message;
  }
  return "That chapter change didn't complete. Please try again.";
}

/**
 * Resolve the package's write path. `null` committer = trial package (its
 * store IS the truth); a committer = published (commit first, then project);
 * an `error` = published but unreachable, which must NOT be written at all.
 */
async function writePathFor(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  store: SupabaseSandboxStore,
  userId: string,
  packageId: string,
): Promise<{ committer: Committer | null } | { error: string }> {
  const resolution = await committerFor(supabase, store, userId, packageId);
  if (resolution.kind === "unavailable") return { error: resolution.reason };
  return {
    committer: resolution.kind === "github" ? resolution.committer : null,
  };
}

/**
 * The `packages.manifest` DB column is a derived read cache of the manifest
 * FILE (alembic.json), which `updateManifest` owns. Column readers (e.g.
 * edit/page.tsx) would otherwise keep serving the pre-change copy, so refresh
 * it from the manifest the write path just returned — never by re-deriving it.
 */
async function refreshManifestColumn(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  packageId: string,
  manifest: PackageManifest,
): Promise<void> {
  await supabase.from("packages").update({ manifest }).eq("id", packageId);
}

/** The manifest as it now stands, read from the authoritative file copy. Used
 *  by the operations whose package-ops signature returns nothing. */
async function currentManifest(
  store: SupabaseSandboxStore,
  packageId: string,
): Promise<PackageManifest> {
  return manifestFromFiles(await store.listFiles(packageId));
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
    const writePath = await writePathFor(supabase, store, user.id, packageId);
    if ("error" in writePath) return { ok: false, error: writePath.error };
    const slug = pageName?.trim() || undefined;
    const chapter = await createChapter(
      store,
      packageId,
      { title: title.trim(), slug },
      writePath.committer,
    );
    await refreshManifestColumn(supabase, packageId, chapter.manifest);
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
    const writePath = await writePathFor(supabase, store, user.id, packageId);
    if ("error" in writePath) return { ok: false, error: writePath.error };
    const manifest = await renameChapter(store, packageId, slug, title.trim(), writePath.committer);
    await refreshManifestColumn(
      supabase,
      packageId,
      manifest,
    );
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
    const writePath = await writePathFor(supabase, store, user.id, packageId);
    if ("error" in writePath) return { ok: false, error: writePath.error };
    const manifest = await reorderChapters(store, packageId, orderedSlugs, writePath.committer);
    await refreshManifestColumn(
      supabase,
      packageId,
      manifest,
    );
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function deleteChapterAction(
  packageId: string,
  slug: string,
  // The chapter's file path, kept in the signature for the caller's clarity;
  // package-ops derives the path it deletes from the manifest itself.
  _path: string,
): Promise<ChapterResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const writePath = await writePathFor(supabase, store, user.id, packageId);
    if ("error" in writePath) return { ok: false, error: writePath.error };
    const manifest = await deleteChapter(store, packageId, slug, writePath.committer);
    await refreshManifestColumn(
      supabase,
      packageId,
      manifest,
    );
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

/**
 * Rename a chapter's page name (file name + public URL). Moves every one of the
 * chapter's documents to the new name. Changes the chapter's public URL — the
 * UI warns before calling this.
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
    const writePath = await writePathFor(supabase, store, user.id, packageId);
    if ("error" in writePath) return { ok: false, error: writePath.error };
    const { slug, manifest } = await renameChapterPageName(
      store,
      packageId,
      oldSlug,
      newSlug.trim(),
      writePath.committer,
    );
    await refreshManifestColumn(
      supabase,
      packageId,
      manifest ?? (await currentManifest(store, packageId)),
    );
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
    const writePath = await writePathFor(supabase, store, user.id, packageId);
    if ("error" in writePath) return { ok: false, error: writePath.error };
    await setUnitTerm(store, packageId, parsed.data, writePath.committer);
    await refreshManifestColumn(
      supabase,
      packageId,
      await currentManifest(store, packageId),
    );
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}
