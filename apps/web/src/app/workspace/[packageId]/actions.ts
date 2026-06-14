"use server";

import { redirect } from "next/navigation";
import type { StudyGuideBlock } from "@alembic/package-contract";
import {
  BlockIdIntegrityError,
  saveStudyGuide,
  type StudyGuideDoc,
} from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";

export interface SaveResult {
  ok: boolean;
  /** Blocks with any newly-minted IDs, so the client can sync. */
  blocks?: StudyGuideBlock[];
  error?: string;
}

export async function saveStudyGuideAction(
  packageId: string,
  doc: StudyGuideDoc,
): Promise<SaveResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");

  const store = new SupabaseSandboxStore(supabase);
  const events = supabaseEventLogger(supabase);
  const started = Date.now();

  try {
    const { blocks } = await saveStudyGuide(store, packageId, doc);
    await events.log({
      type: "save.completed",
      userId: user.id,
      packageId,
      durationMs: Date.now() - started,
      detail: { path: doc.path, blockCount: blocks.length },
      occurredAt: new Date().toISOString(),
    });
    return { ok: true, blocks };
  } catch (e) {
    const error =
      e instanceof BlockIdIntegrityError
        ? "Some sections have invalid or duplicate identifiers and could not be saved."
        : "Your changes could not be saved. Please try again.";
    return { ok: false, error };
  }
}
