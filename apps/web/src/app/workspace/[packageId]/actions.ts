"use server";

import { redirect } from "next/navigation";
import {
  serializeStudyGuide,
  type StudyGuideBlock,
} from "@alembic/package-contract";
import {
  BlockIdIntegrityError,
  saveStudyGuide,
  type StudyGuideDoc,
} from "@alembic/package-ops";
import { commitFiles } from "@alembic/github-bridge";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { clientForUser } from "@/lib/github";

export interface SaveResult {
  ok: boolean;
  /** Blocks with any newly-minted IDs, so the client can sync. */
  blocks?: StudyGuideBlock[];
  error?: string;
  /** Non-fatal note, e.g. saved locally but the GitHub sync failed. */
  warning?: string;
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

  let blocks: StudyGuideBlock[];
  try {
    ({ blocks } = await saveStudyGuide(store, packageId, doc));
  } catch (e) {
    const error =
      e instanceof BlockIdIntegrityError
        ? "Some sections have invalid or duplicate identifiers and could not be saved."
        : "Your changes could not be saved. Please try again.";
    return { ok: false, error };
  }

  await events.log({
    type: "save.completed",
    userId: user.id,
    packageId,
    durationMs: Date.now() - started,
    detail: { path: doc.path, blockCount: blocks.length },
    occurredAt: new Date().toISOString(),
  });

  // For GitHub-backed packages, the save is also a commit to the public repo.
  // Best-effort: the projection is already saved; surface a warning on failure.
  let warning: string | undefined;
  const record = await store.getPackage(packageId);
  const repo = record?.storage === "github" ? record.manifest.publicRepo : null;
  if (repo) {
    try {
      const gh = await clientForUser(supabase, user.id);
      if (gh) {
        const content = serializeStudyGuide(doc.preamble, blocks);
        await commitFiles(
          gh.client,
          { owner: repo.owner, repo: repo.name },
          {
            repo: "public",
            summary: `Update ${doc.path}`,
            changes: [{ path: doc.path, content }],
          },
        );
      } else {
        warning = "Saved. Reconnect publishing to sync changes to GitHub.";
      }
    } catch {
      warning = "Saved here, but syncing to GitHub didn't complete.";
    }
  }

  return { ok: true, blocks, ...(warning ? { warning } : {}) };
}
