"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  COURSE_DESCRIPTION_PATH,
  listChapters,
  loadCourseDescription,
  setCourseDescription,
} from "@alembic/package-ops";
import { parseManifest } from "@alembic/package-contract";
import { generateCourseDescription } from "@alembic/ai-assist";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { mirrorManifestToSandbox, syncFilesToGitHub } from "@/lib/github";
import { governedProvider, RateLimitError, BudgetExceededError } from "@/lib/ai";

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

export interface CourseInfo {
  instructor?: string;
  courseNumber?: string;
  department?: string;
}

/**
 * Persist the course-identity fields shown on the published home page
 * (instructor, course number, department/institute). Additive manifest fields
 * under `courseContext`; empty strings clear a field rather than being stored
 * as "". No-op (no commit) when nothing actually changed.
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
    const next = {
      ...record.manifest.courseContext,
      instructor: clean(info.instructor),
      courseNumber: clean(info.courseNumber),
      department: clean(info.department),
    };
    const current = record.manifest.courseContext;
    const unchanged =
      current.instructor === next.instructor &&
      current.courseNumber === next.courseNumber &&
      current.department === next.department;
    if (unchanged) return { ok: true };
    const manifest = parseManifest({ ...record.manifest, courseContext: next });
    await supabase.from("packages").update({ manifest }).eq("id", packageId);
    await mirrorManifestToSandbox(store, packageId, manifest);
    await syncFilesToGitHub(
      supabase, store, user.id, packageId,
      [{ path: "alembic.json", content: JSON.stringify(manifest, null, 2) + "\n" }],
      "Set course info (Alembic)",
    );
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't save the course info. Please try again." };
  }
}

/** The current canonical course description markdown (metadata/course.md). */
export async function loadCourseDescriptionAction(
  packageId: string,
): Promise<{ markdown: string | null }> {
  const { supabase } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  return { markdown: await loadCourseDescription(store, packageId) };
}

/** Persist an educator-edited course description (canonical metadata/course.md). */
export async function saveCourseDescriptionAction(
  packageId: string,
  markdown: string,
): Promise<DescriptionResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const { manifest, description } = await setCourseDescription(store, packageId, markdown);
    // manifest.description is derived → keep the projection row + LRMI in step.
    await supabase.from("packages").update({ manifest, title: manifest.title }).eq("id", packageId);
    await syncFilesToGitHub(
      supabase, store, user.id, packageId,
      [
        { path: COURSE_DESCRIPTION_PATH, content: markdown },
        { path: "alembic.json", content: JSON.stringify(manifest, null, 2) + "\n" },
      ],
      "Update course description (Alembic)",
    );
    revalidatePath(`/workspace/${packageId}`);
    revalidatePath("/portal");
    void description;
    return { ok: true, markdown };
  } catch {
    return { ok: false, error: "Couldn't save the description. Please try again." };
  }
}

/**
 * Generate a course description with AI from the course's title + chapter
 * outline, then persist it as the canonical metadata/course.md (single source —
 * manifest.description / LRMI / portal derive from it). The educator reviews and
 * can edit afterward.
 */
export async function generateCourseDescriptionAction(
  packageId: string,
): Promise<DescriptionResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const record = await store.getPackage(packageId);
    if (!record) return { ok: false, error: "Package not found." };
    const chapters = await listChapters(store, packageId);
    const outline = chapters.map((c) => `- ${c.title}`).join("\n");

    const provider = governedProvider(supabase, { userId: user.id, packageId, kind: "course-metadata" });
    const { markdown } = await generateCourseDescription(provider, {
      title: record.title,
      discipline: record.manifest.discipline,
      content: outline,
      scope: "course",
    });

    const { manifest } = await setCourseDescription(store, packageId, markdown);
    await supabase.from("packages").update({ manifest }).eq("id", packageId);
    await syncFilesToGitHub(
      supabase, store, user.id, packageId,
      [
        { path: COURSE_DESCRIPTION_PATH, content: markdown },
        { path: "alembic.json", content: JSON.stringify(manifest, null, 2) + "\n" },
      ],
      "Generate course description (Alembic)",
    );
    await supabaseEventLogger(supabase).log({
      type: "ai.draft.requested",
      userId: user.id,
      packageId,
      detail: { kind: "course-metadata" },
      occurredAt: new Date().toISOString(),
    });
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true, markdown };
  } catch (e) {
    if (e instanceof RateLimitError || e instanceof BudgetExceededError) {
      return { ok: false, error: e.message };
    }
    return { ok: false, error: "Couldn't generate a description. Please try again." };
  }
}
