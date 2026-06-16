"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  newQuestionTemplateId,
  questionTemplatePath,
  type Difficulty,
  type QuestionTemplate,
} from "@alembic/package-contract";
import {
  listQuestionItems,
  listQuestionTemplates,
  loadQuestionTemplate,
  saveQuestionTemplate,
} from "@alembic/package-ops";
import { generateQuestions } from "@alembic/ai-assist";
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

function friendly(e: unknown): string {
  if (e instanceof RateLimitError || e instanceof BudgetExceededError) return e.message;
  return e instanceof Error && e.message.includes("not configured")
    ? "AI isn't configured yet on this deployment."
    : "The request didn't complete. Please try again.";
}

export interface AssessmentActionResult {
  ok: boolean;
  error?: string;
  queued?: number;
}

/**
 * Create/replace a question TEMPLATE (the instructor's design — public-safe,
 * no answers). Saved directly (the educator's own authoring input, like the
 * planning layer) and synced to the public repo.
 */
export async function saveTemplateAction(
  packageId: string,
  fields: {
    prompt: string;
    difficulty: Difficulty;
    context?: string;
    conceptIds?: string[];
    objectiveIds?: string[];
    misconceptionTargets?: string[];
  },
): Promise<AssessmentActionResult> {
  const { supabase, user } = await requireUser();
  if (!fields.prompt.trim()) return { ok: false, error: "Describe what the template should ask." };
  const store = new SupabaseSandboxStore(supabase);
  try {
    const template: QuestionTemplate = {
      id: newQuestionTemplateId(),
      prompt: fields.prompt.trim(),
      context: fields.context?.trim() ?? "",
      conceptIds: fields.conceptIds ?? [],
      objectiveIds: fields.objectiveIds ?? [],
      difficulty: fields.difficulty,
      representations: [],
      parameters: [],
      misconceptionTargets: fields.misconceptionTargets ?? [],
    };
    await saveQuestionTemplate(store, packageId, template);
    await syncFilesToGitHub(
      supabase,
      store,
      user.id,
      packageId,
      [{ path: questionTemplatePath(template.id), content: JSON.stringify(template, null, 2) }],
      "Add question template (Alembic)",
    );
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't save the template. Please try again." };
  }
}

/**
 * Generate question ITEMS from a template with AI and route each into the
 * Tier-3 review queue (assessments are itemized review — never auto-applied).
 * The generated answer travels in the change detail; on accept (change-actions)
 * the item is written public and the answer key private.
 */
export async function generateItemsAction(
  packageId: string,
  templateId: string,
  count: number,
): Promise<AssessmentActionResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const events = supabaseEventLogger(supabase);
  try {
    const template = await loadQuestionTemplate(store, packageId, templateId);
    if (!template) return { ok: false, error: "That template no longer exists." };
    const record = await store.getPackage(packageId);
    const provider = governedProvider(supabase, {
      userId: user.id,
      packageId,
      kind: "assessment-item",
    });
    const { items } = await generateQuestions(provider, {
      template,
      count: Math.min(Math.max(count, 1), 10),
      courseTitle: record?.title,
    });
    for (const item of items) {
      await recordChange(supabase, {
        packageId,
        userId: user.id,
        tier: 3, // assessment-edit / answer-key — mandatory itemized review
        kind: "assessment-edit",
        summary: `Question (${template.difficulty}): ${item.stem.slice(0, 80)} — answer: ${item.answer.slice(0, 40)}`,
        detail: {
          templateId,
          stem: item.stem,
          choices: item.choices,
          objectiveIds: item.objectiveIds,
          answer: item.answer,
          rationale: item.rationale,
        },
        status: "pending",
      });
      await events.log({
        type: "review.queued",
        userId: user.id,
        packageId,
        detail: { kind: "assessment-edit" },
        occurredAt: new Date().toISOString(),
      });
    }
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true, queued: items.length };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export interface AssessmentSummary {
  templates: { id: string; prompt: string; difficulty: Difficulty }[];
  itemCount: number;
}

/** Templates + accepted-item count for the Assessments panel. */
export async function listAssessmentsAction(packageId: string): Promise<AssessmentSummary> {
  const { supabase } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const templates = await listQuestionTemplates(store, packageId);
    const items = await listQuestionItems(store, packageId);
    return {
      templates: templates.map((t) => ({ id: t.id, prompt: t.prompt, difficulty: t.difficulty })),
      itemCount: items.length,
    };
  } catch {
    return { templates: [], itemCount: 0 };
  }
}
