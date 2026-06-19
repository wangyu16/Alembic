"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { loadStudyGuide } from "@alembic/package-ops";
import { serializeStudyGuide } from "@alembic/package-contract";
import { proofread } from "@alembic/ai-assist";
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

export interface ProofreadResult {
  ok: boolean;
  /** True when corrections were proposed (queued for review). */
  queued?: boolean;
  error?: string;
}

/**
 * Spelling/grammar check of a chapter: copy-edit the chapter markdown with AI
 * (meaning/notation/block-ids preserved) and, if anything changed, enqueue it as
 * a Tier-2 `editor-ai-edit` for review — never auto-applied. The review queue's
 * generic apply branch (G3) writes it through the validated path.
 */
export async function proofreadChapterAction(
  packageId: string,
  path: string,
): Promise<ProofreadResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const doc = await loadStudyGuide(store, packageId, path);
    const source = serializeStudyGuide(doc.preamble, doc.blocks);
    const provider = governedProvider(supabase, {
      userId: user.id,
      packageId,
      kind: "spelling-grammar",
    });
    const { corrected, changed } = await proofread(provider, { text: source });
    if (!changed) return { ok: true, queued: false };

    await recordChange(supabase, {
      packageId,
      userId: user.id,
      tier: 2,
      kind: "editor-ai-edit",
      summary: "Spelling & grammar corrections",
      detail: { path, repo: "public", content: corrected },
      status: "pending",
    });
    await supabaseEventLogger(supabase).log({
      type: "review.queued",
      userId: user.id,
      packageId,
      detail: { kind: "editor-ai-edit", check: "spelling-grammar" },
      occurredAt: new Date().toISOString(),
    });
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true, queued: true };
  } catch (e) {
    if (e instanceof RateLimitError || e instanceof BudgetExceededError) {
      return { ok: false, error: e.message };
    }
    return { ok: false, error: "Couldn't run the spelling & grammar check. Please try again." };
  }
}
