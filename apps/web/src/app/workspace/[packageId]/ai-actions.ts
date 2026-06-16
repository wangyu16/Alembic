"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { draftSection } from "@alembic/ai-assist";
import {
  generateWorksheetArtifact,
  keepWorksheetMine,
  loadStudyGuide,
  regenerateWorksheetArtifact,
} from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
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
    : "The AI request didn't complete. Please try again.";
}

export interface DraftResult {
  ok: boolean;
  error?: string;
}

/**
 * Draft a section with AI, then route it into the Tier-2 review queue rather
 * than applying it directly — the educator accepts/edits/rejects it there
 * (goal.md Tier-2 batch review). `path` is the chapter the draft targets.
 */
export async function draftSectionAction(
  packageId: string,
  instruction: string,
  path: string,
): Promise<DraftResult> {
  const { supabase, user } = await requireUser();
  if (!instruction.trim()) return { ok: false, error: "Describe the section first." };

  const store = new SupabaseSandboxStore(supabase);
  const events = supabaseEventLogger(supabase);
  const started = Date.now();
  try {
    const guide = await loadStudyGuide(store, packageId, path);
    const context = guide.blocks.length
      ? `Existing sections: ${guide.blocks.map((b) => b.title).join("; ")}`
      : undefined;
    const provider = governedProvider(supabase, {
      userId: user.id,
      packageId,
      kind: "draft-section",
    });
    const draft = await draftSection(provider, { instruction, context });
    await recordChange(supabase, {
      packageId,
      userId: user.id,
      tier: 2,
      kind: "draft-section",
      summary: `Draft: ${draft.title}`,
      detail: { path, title: draft.title, body: draft.body },
      status: "pending",
    });
    await events.log({
      type: "ai.draft.requested",
      userId: user.id,
      packageId,
      durationMs: Date.now() - started,
      detail: { instructionChars: instruction.length },
      occurredAt: new Date().toISOString(),
    });
    await events.log({
      type: "review.queued",
      userId: user.id,
      packageId,
      detail: { kind: "draft-section" },
      occurredAt: new Date().toISOString(),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function generateWorksheetAction(
  packageId: string,
  blockIds: string[],
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const events = supabaseEventLogger(supabase);
  try {
    const record = await store.getPackage(packageId);
    const provider = governedProvider(supabase, {
      userId: user.id,
      packageId,
      kind: "worksheet",
    });
    const { record: artifact } = await generateWorksheetArtifact(store, packageId, {
      provider,
      blockIds,
      packageTitle: record?.title,
    });
    await events.log({
      type: "artifact.generated",
      userId: user.id,
      packageId,
      detail: { kind: "worksheet", sourceCount: blockIds.length },
      occurredAt: new Date().toISOString(),
    });
    void artifact;
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function regenerateWorksheetAction(
  packageId: string,
  artifactId: string,
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const events = supabaseEventLogger(supabase);
  try {
    const record = await store.getPackage(packageId);
    const provider = governedProvider(supabase, {
      userId: user.id,
      packageId,
      kind: "worksheet",
    });
    await regenerateWorksheetArtifact(store, packageId, artifactId, {
      provider,
      packageTitle: record?.title,
    });
    await events.log({
      type: "artifact.regenerated",
      userId: user.id,
      packageId,
      detail: { artifactId },
      occurredAt: new Date().toISOString(),
    });
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

export async function keepWorksheetMineAction(
  packageId: string,
  artifactId: string,
): Promise<ActionResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const events = supabaseEventLogger(supabase);
  try {
    await keepWorksheetMine(store, packageId, artifactId);
    await events.log({
      type: "artifact.kept-divergent",
      userId: user.id,
      packageId,
      detail: { artifactId },
      occurredAt: new Date().toISOString(),
    });
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}
