"use server";

import { redirect } from "next/navigation";
import {
  conceptMapPath,
  objectivesPath,
  type Concept,
  type Objective,
} from "@alembic/package-contract";
import {
  loadConceptMap,
  loadObjectives,
  saveConceptMap,
  saveObjectives,
} from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { syncFilesToGitHub } from "@/lib/github";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

export interface PlanningData {
  concepts: Concept[];
  objectives: Objective[];
}

export interface PlanningResult {
  ok: boolean;
  data?: PlanningData;
  error?: string;
}

/** Load the course-level concept map + objectives (the hidden planning layer). */
export async function loadPlanningAction(packageId: string): Promise<PlanningResult> {
  const { supabase } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const { concepts } = await loadConceptMap(store, packageId, "course");
    const { objectives } = await loadObjectives(store, packageId, "course");
    return { ok: true, data: { concepts, objectives } };
  } catch {
    return { ok: false, error: "Couldn't load the concept map." };
  }
}

/**
 * Save the course-level concept map + objectives through the validated write
 * path, then sync both files to the public repo (they live in the public repo
 * and are adaptable, but are not rendered on the student site).
 */
export async function savePlanningAction(
  packageId: string,
  data: PlanningData,
): Promise<PlanningResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const conceptMap = { scope: "course" as const, concepts: data.concepts };
    const objectives = { scope: "course" as const, objectives: data.objectives };
    // Zod-validated inside the ops; an invalid map throws and writes nothing.
    await saveConceptMap(store, packageId, conceptMap);
    await saveObjectives(store, packageId, objectives);
    await syncFilesToGitHub(
      supabase,
      store,
      user.id,
      packageId,
      [
        { path: conceptMapPath("course"), content: JSON.stringify(conceptMap, null, 2) },
        { path: objectivesPath("course"), content: JSON.stringify(objectives, null, 2) },
      ],
      "Update concept map & objectives (Alembic)",
    );
    return { ok: true, data: { concepts: conceptMap.concepts, objectives: objectives.objectives } };
  } catch {
    return { ok: false, error: "Couldn't save the concept map. Check the entries and try again." };
  }
}
