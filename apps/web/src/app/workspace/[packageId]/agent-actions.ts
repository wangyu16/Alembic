"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { validateProposedChangeSet } from "@alembic/package-contract";
import { createProviderCoherenceHarness } from "@alembic/ai-assist";
import {
  gatherCoherenceContext,
  blockIdsByChapter,
  chapterStudyGuidePath,
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
    : "The coherence review didn't complete. Please try again.";
}

export interface CoherenceAgentResult {
  ok: boolean;
  error?: string;
  /** Educator-facing summary of what the agent proposed. */
  summary?: string;
  /** One line per advisory finding. */
  findings?: string[];
  /** How many block-level changes were queued for review. */
  queued?: number;
}

/** Short, educator-facing label for one proposed operation in the review queue. */
function opSummary(op: {
  op: "update-block" | "create-block" | "reorder-blocks";
  rationale: string;
}): string {
  const lead =
    op.op === "update-block"
      ? "Revise a section"
      : op.op === "create-block"
        ? "Add a section"
        : "Reorder sections";
  return `Coherence — ${lead}: ${op.rationale}`;
}

/**
 * M18.4 — run the Tier-B coherence agent over the whole course and route its
 * proposed changes into the existing Tier-2 review queue (one item per block
 * operation). The agent is a *producer of reviewed changes*: nothing is applied
 * here — the educator accepts/edits/rejects each item, and accept applies it
 * through `packageOps` (change-actions `applyAccepted`, the one validated write
 * path). Gated by the governed provider (rate limit + per-user token budget).
 */
export async function runCoherenceAgentAction(
  packageId: string,
  task: string,
): Promise<CoherenceAgentResult> {
  const { supabase, user } = await requireUser();
  const trimmed = task.trim();
  if (!trimmed) return { ok: false, error: "Describe what to review first." };

  const store = new SupabaseSandboxStore(supabase);
  const events = supabaseEventLogger(supabase);
  const started = Date.now();

  await events.log({
    type: "agent.run.requested",
    userId: user.id,
    packageId,
    detail: { taskChars: trimmed.length },
    occurredAt: new Date().toISOString(),
  });

  try {
    const record = await store.getPackage(packageId);
    const context = await gatherCoherenceContext(store, packageId);
    const totalBlocks = context.chapters.reduce((n, c) => n + c.blocks.length, 0);
    if (totalBlocks === 0) {
      return { ok: false, error: "Add some content before running a coherence review." };
    }

    const provider = governedProvider(supabase, {
      userId: user.id,
      packageId,
      kind: "coherence-agent",
    });
    const harness = createProviderCoherenceHarness(provider);
    const set = await harness.run({
      task: trimmed,
      courseTitle: record?.title,
      chapters: context.chapters,
    });

    // Defensive re-validation against the live package before queuing.
    const { ok, issues } = validateProposedChangeSet(set, {
      blockIdsByChapter: blockIdsByChapter(context),
    });
    if (!ok) {
      await events.log({
        type: "agent.run.failed",
        userId: user.id,
        packageId,
        detail: { reason: "invalid-proposal", issues: issues.length },
        occurredAt: new Date().toISOString(),
      });
      return { ok: false, error: "The review produced changes that no longer fit the course. Please try again." };
    }

    // Queue one Tier-2 `coherence-edit` per operation.
    for (const op of set.operations) {
      await recordChange(supabase, {
        packageId,
        userId: user.id,
        tier: 2,
        kind: "coherence-edit",
        summary: opSummary(op),
        detail: {
          path: chapterStudyGuidePath(op.chapterSlug),
          chapterSlug: op.chapterSlug,
          op,
          rationale: op.rationale,
        },
        status: "pending",
      });
      await events.log({
        type: "review.queued",
        userId: user.id,
        packageId,
        detail: { kind: "coherence-edit" },
        occurredAt: new Date().toISOString(),
      });
    }

    await events.log({
      type: "agent.run.completed",
      userId: user.id,
      packageId,
      durationMs: Date.now() - started,
      detail: { operations: set.operations.length, findings: set.findings.length },
      occurredAt: new Date().toISOString(),
    });

    revalidatePath(`/workspace/${packageId}`);
    return {
      ok: true,
      summary: set.summary,
      findings: set.findings.map((f) => f.summary),
      queued: set.operations.length,
    };
  } catch (e) {
    await events.log({
      type: "agent.run.failed",
      userId: user.id,
      packageId,
      detail: { reason: "exception" },
      occurredAt: new Date().toISOString(),
    });
    return { ok: false, error: friendly(e) };
  }
}
