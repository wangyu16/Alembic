"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  COURSE_CONCEPT_MAP_PATH,
  CommitFailedError,
  CommitUnavailableError,
  ManifestConflictError,
  loadCourseConceptMap,
  updateManifest,
  writeThrough,
  type Committer,
} from "@alembic/package-ops";
import type { PackageManifest } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { committerFor } from "@/lib/committer";
import { manifestFromFiles } from "@/lib/manifest-read";

/**
 * Course-level details on the one write path
 * (docs/specs/storage-and-write-paths.md §3): the manifest through
 * `updateManifest` (the single manifest owner, with compare-and-swap), files
 * through `writeThrough`. A published package that cannot reach its online
 * home is refused rather than written locally.
 */

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

/** Educator-facing wording for a same-time edit by another tab or person. */
const CONFLICT_MESSAGE =
  "Someone changed this course at the same time. Reload and try again.";

/** Turn a write-path failure into educator-facing copy, or null if it is not
 *  one (the caller then keeps its own generic message). */
function writeError(e: unknown): string | null {
  if (e instanceof ManifestConflictError) return CONFLICT_MESSAGE;
  if (e instanceof CommitUnavailableError || e instanceof CommitFailedError) {
    return e.message;
  }
  return null;
}

/**
 * Resolve the package's write path once: `null` committer = trial package,
 * a committer = published, `error` = published but unreachable (refuse).
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

/** Refresh the derived `packages.manifest` read cache from the manifest the
 *  write path just returned (never by re-deriving it). */
async function refreshManifestColumn(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  packageId: string,
  manifest: PackageManifest,
): Promise<void> {
  await supabase.from("packages").update({ manifest }).eq("id", packageId);
}

export interface DescriptionResult {
  ok: boolean;
  markdown?: string;
  error?: string;
}

/**
 * Set a space's global viewing theme (manifest-level, so every chapter in that
 * space is consistent — not the transient editor cookie or per-file settings).
 * The study-guide space is stored as the canonical `manifest.theme` (also the
 * course default); other spaces (e.g. `practice`) get an independent override in
 * `manifest.themes[space]`.
 */
export async function setCourseThemeAction(
  packageId: string,
  theme: string,
  space: string = "study-guide",
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const record = await store.getPackage(packageId);
    if (!record) return { ok: false, error: "Package not found." };
    // Base every manifest write on the FILE manifest (the source of truth) —
    // record.manifest is a stale read cache and would erase newer chapters.
    const base = manifestFromFiles(await store.listFiles(packageId));
    const isDefault = space === "study-guide";
    const current = isDefault ? base.theme : base.themes?.[space];
    if (current === theme) return { ok: true }; // unchanged — no commit

    const writePath = await writePathFor(supabase, store, user.id, packageId);
    if ("error" in writePath) return { ok: false, error: writePath.error };

    const { manifest } = await updateManifest(
      store,
      writePath.committer,
      packageId,
      (m) =>
        isDefault
          ? { ...m, theme }
          : { ...m, themes: { ...m.themes, [space]: theme } },
      { summary: "Set course theme (Alembic)" },
    );
    await refreshManifestColumn(supabase, packageId, manifest);
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: writeError(e) ?? "Couldn't save the theme. Please try again.",
    };
  }
}

/** Soft cap for the plain-text course description (Course details card). A
 *  "use server" module may only export async functions, so this stays
 *  module-private — `studio-shell.tsx` keeps its own matching constant for
 *  the live client-side counter. */
const COURSE_DESCRIPTION_MAX_WORDS = 200;

function wordCount(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

export interface CourseInfo {
  instructor?: string;
  courseNumber?: string;
  department?: string;
  /** One paragraph, plain text — shown on the published home page, Discover,
   *  and LRMI. Soft-capped at `COURSE_DESCRIPTION_MAX_WORDS` words. */
  description?: string;
  /** Discovery tags/keywords. */
  keywords?: string[];
}

/**
 * Persist the "Course details" card: identity fields (instructor, course
 * number, department/institute) plus the published description and
 * tags/keywords. Additive manifest fields; empty values clear rather than
 * being stored as "". No-op (no commit) when nothing actually changed.
 */
export async function setCourseInfoAction(
  packageId: string,
  info: CourseInfo,
): Promise<{ ok: boolean; error?: string }> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const record = await store.getPackage(packageId);
    if (!record) return { ok: false, error: "Package not found." };
    // Base every manifest write on the FILE manifest (the source of truth) —
    // record.manifest is a stale read cache and would erase newer chapters.
    const base = manifestFromFiles(await store.listFiles(packageId));
    const clean = (s?: string) => {
      const t = s?.trim();
      return t ? t : undefined;
    };
    const description = (info.description ?? "").trim();
    if (wordCount(description) > COURSE_DESCRIPTION_MAX_WORDS) {
      return {
        ok: false,
        error: `Keep the course description to ${COURSE_DESCRIPTION_MAX_WORDS} words or fewer.`,
      };
    }
    const keywords = (info.keywords ?? [])
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    const nextContext = {
      ...base.courseContext,
      instructor: clean(info.instructor),
      courseNumber: clean(info.courseNumber),
      department: clean(info.department),
    };
    const currentContext = base.courseContext;
    const unchanged =
      currentContext.instructor === nextContext.instructor &&
      currentContext.courseNumber === nextContext.courseNumber &&
      currentContext.department === nextContext.department &&
      base.description === description &&
      JSON.stringify(base.keywords ?? []) === JSON.stringify(keywords);
    if (unchanged) return { ok: true };

    const writePath = await writePathFor(supabase, store, user.id, packageId);
    if ("error" in writePath) return { ok: false, error: writePath.error };

    const { manifest } = await updateManifest(
      store,
      writePath.committer,
      packageId,
      // Patch against whatever the manifest says now (a retry replays this
      // against a fresh copy), so only these fields are ever overwritten.
      (m) => ({
        ...m,
        courseContext: {
          ...m.courseContext,
          instructor: nextContext.instructor,
          courseNumber: nextContext.courseNumber,
          department: nextContext.department,
        },
        description,
        keywords,
      }),
      { summary: "Set course info (Alembic)" },
    );
    await refreshManifestColumn(supabase, packageId, manifest);
    revalidatePath(`/workspace/${packageId}`);
    revalidatePath("/portal");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: writeError(e) ?? "Couldn't save the course info. Please try again.",
    };
  }
}

/** The current course concept-map markdown (free-form; metadata/course.md). */
export async function loadCourseConceptMapAction(
  packageId: string,
): Promise<{ markdown: string | null }> {
  const { supabase } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  return { markdown: await loadCourseConceptMap(store, packageId) };
}

/**
 * Persist the course concept map (free-form notes — concepts/topics,
 * correlations, course-level learning objectives — any structure). Never
 * touches `manifest.description`/`keywords` and never affects the published
 * home page or Discover.
 */
export async function saveCourseConceptMapAction(
  packageId: string,
  markdown: string,
): Promise<DescriptionResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const writePath = await writePathFor(supabase, store, user.id, packageId);
    if ("error" in writePath) return { ok: false, error: writePath.error };
    await writeThrough(store, writePath.committer, packageId, {
      changes: [
        { repo: "public", path: COURSE_CONCEPT_MAP_PATH, content: markdown },
      ],
      summary: "Update course concept map (Alembic)",
    });
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true, markdown };
  } catch (e) {
    return {
      ok: false,
      error: writeError(e) ?? "Couldn't save the concept map. Please try again.",
    };
  }
}
