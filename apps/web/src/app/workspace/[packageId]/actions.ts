"use server";

import { redirect } from "next/navigation";
import type { StudyGuideBlock } from "@alembic/package-contract";
import {
  BlockIdIntegrityError,
  prepareStudyGuideSave,
  type StudyGuideDoc,
} from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { committerFor } from "@/lib/committer";
import { writeChanges } from "./write-changes";

export interface SaveResult {
  ok: boolean;
  /** Blocks with any newly-minted IDs, so the client can sync. */
  blocks?: StudyGuideBlock[];
  error?: string;
  /** Non-fatal note, e.g. the text saved but isn't a section yet. */
  warning?: string;
}

/**
 * Save a study-guide chapter from the studio editor.
 *
 * Repo-first (docs/specs/storage-and-write-paths.md §3): validate and
 * canonicalize the bytes, decide the write path ONCE (`committerFor`), then
 * make the change permanent before it is projected. A published package whose
 * online home is unreachable refuses the save and says so — it never degrades
 * to a here-only write with a warning, which is what this action used to do.
 */
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

  // 1. Validate + canonicalize (mint IDs, reject broken ones, path + reference
  //    guards, serialize). Nothing has been written anywhere yet.
  let file: { repo: "public" | "private"; path: string; content: string };
  let blocks: StudyGuideBlock[];
  try {
    const prepared = prepareStudyGuideSave(doc);
    file = prepared.file;
    blocks = prepared.blocks;
  } catch (e) {
    const error =
      e instanceof BlockIdIntegrityError
        ? "Some sections have invalid or duplicate identifiers and could not be saved."
        : "Your changes could not be saved. Please try again.";
    return { ok: false, error };
  }

  // 2. One place decides the write path; 3. commit, then project.
  const resolution = await committerFor(supabase, store, user.id, packageId);
  const written = await writeChanges({
    store,
    resolution,
    packageId,
    changes: [file],
    summary: `Update ${doc.path}`,
  });
  if (!written.ok) return { ok: false, error: written.error };

  await events.log({
    type: "save.completed",
    userId: user.id,
    packageId,
    durationMs: Date.now() - started,
    detail: { path: doc.path, blockCount: blocks.length },
    occurredAt: new Date().toISOString(),
  });

  // A section only exists once it sits under a "## Heading" line (H1 is
  // reserved for the chapter's own auto-rendered title) — content typed
  // above the first "##" saves fine but becomes preamble, not a section, and
  // silently doesn't count toward "has study-guide content" at publish time.
  // Flag it here, at the moment it happens, rather than only at the
  // publish-gate message the educator sees much later.
  const warning: string | undefined =
    blocks.length === 0 && doc.preamble.trim()
      ? 'Saved — but this needs a "## Heading" line above your text to count as a section. A single "#" is reserved for the page title; add "##" (or a lower level) before your first section.'
      : undefined;

  return { ok: true, blocks, ...(warning ? { warning } : {}) };
}
