"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  COURSE_CONCEPT_MAP_PATH,
  loadCourseConceptMap,
  setCourseConceptMap,
} from "@alembic/package-ops";
import { parseManifest } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { mirrorManifestToSandbox, syncFilesToGitHub } from "@/lib/github";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
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
 * `manifest.themes[space]`. Persists to the manifest row + commits alembic.json.
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
    const isDefault = space === "study-guide";
    const current = isDefault ? record.manifest.theme : record.manifest.themes?.[space];
    if (current === theme) return { ok: true }; // unchanged — no commit
    const manifest = parseManifest(
      isDefault
        ? { ...record.manifest, theme }
        : { ...record.manifest, themes: { ...record.manifest.themes, [space]: theme } },
    );
    await supabase.from("packages").update({ manifest }).eq("id", packageId);
    await mirrorManifestToSandbox(store, packageId, manifest);
    await syncFilesToGitHub(
      supabase, store, user.id, packageId,
      [{ path: "alembic.json", content: JSON.stringify(manifest, null, 2) + "\n" }],
      "Set course theme (Alembic)",
    );
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't save the theme. Please try again." };
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
      ...record.manifest.courseContext,
      instructor: clean(info.instructor),
      courseNumber: clean(info.courseNumber),
      department: clean(info.department),
    };
    const currentContext = record.manifest.courseContext;
    const unchanged =
      currentContext.instructor === nextContext.instructor &&
      currentContext.courseNumber === nextContext.courseNumber &&
      currentContext.department === nextContext.department &&
      record.manifest.description === description &&
      JSON.stringify(record.manifest.keywords ?? []) === JSON.stringify(keywords);
    if (unchanged) return { ok: true };
    const manifest = parseManifest({
      ...record.manifest,
      courseContext: nextContext,
      description,
      keywords,
    });
    await supabase.from("packages").update({ manifest }).eq("id", packageId);
    await mirrorManifestToSandbox(store, packageId, manifest);
    await syncFilesToGitHub(
      supabase, store, user.id, packageId,
      [{ path: "alembic.json", content: JSON.stringify(manifest, null, 2) + "\n" }],
      "Set course info (Alembic)",
    );
    revalidatePath(`/workspace/${packageId}`);
    revalidatePath("/portal");
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't save the course info. Please try again." };
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
    await setCourseConceptMap(store, packageId, markdown);
    await syncFilesToGitHub(
      supabase, store, user.id, packageId,
      [{ path: COURSE_CONCEPT_MAP_PATH, content: markdown }],
      "Update course concept map (Alembic)",
    );
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true, markdown };
  } catch {
    return { ok: false, error: "Couldn't save the concept map. Please try again." };
  }
}
