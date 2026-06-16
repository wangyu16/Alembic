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
import { draftOutlineFromPlan } from "@alembic/ai-assist";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { syncFilesToGitHub } from "@/lib/github";
import { governedProvider, RateLimitError, BudgetExceededError } from "@/lib/ai";
import { recordChange } from "@/lib/changes";

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

export interface OutlineResult {
  ok: boolean;
  queued?: number;
  error?: string;
}

/**
 * M9.6d — draft study-guide sections FROM the planning layer (concept-map-first
 * authoring): the AI proposes ordered sections covering the course objectives,
 * sequenced by prerequisites, routed into the Tier-2 review queue for `path`
 * (reusing the `import-blocks` accept path that appends reviewed sections).
 * Nothing is applied without review.
 */
export async function outlineFromPlanAction(
  packageId: string,
  path: string,
): Promise<OutlineResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const events = supabaseEventLogger(supabase);
  try {
    const record = await store.getPackage(packageId);
    const { concepts } = await loadConceptMap(store, packageId, "course");
    const { objectives } = await loadObjectives(store, packageId, "course");
    if (objectives.length === 0) {
      return { ok: false, error: "Add at least one objective first — the study guide is drafted from them." };
    }
    const provider = governedProvider(supabase, {
      userId: user.id,
      packageId,
      kind: "draft-section",
    });
    const { blocks } = await draftOutlineFromPlan(provider, {
      objectives: objectives.map((o) => ({ id: o.id, text: o.text, conceptIds: o.conceptIds })),
      concepts: concepts.map((c) => ({ id: c.id, label: c.label, prerequisites: c.prerequisites, related: c.related })),
      context: record?.title,
    });
    if (blocks.length === 0) return { ok: false, error: "The draft came back empty. Try again." };
    await recordChange(supabase, {
      packageId,
      userId: user.id,
      tier: 2,
      kind: "import-blocks",
      summary: `Draft from plan: ${blocks.length} section${blocks.length === 1 ? "" : "s"}`,
      detail: { path, blocks: blocks.map((b) => ({ title: b.title, body: b.body })) },
      status: "pending",
    });
    await events.log({
      type: "review.queued",
      userId: user.id,
      packageId,
      detail: { kind: "import-blocks", source: "plan" },
      occurredAt: new Date().toISOString(),
    });
    return { ok: true, queued: blocks.length };
  } catch (e) {
    if (e instanceof RateLimitError || e instanceof BudgetExceededError) {
      return { ok: false, error: e.message };
    }
    return { ok: false, error: "Couldn't draft from the plan. Please try again." };
  }
}
