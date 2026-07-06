"use server";

import { redirect } from "next/navigation";
import { parseStudyGuide, serializeStudyGuide } from "@alembic/package-contract";
import { loadStudyGuide } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { generateEditableFile, workerConfigured } from "@/lib/worker-client";
import { saveStudyGuideAction } from "./actions";

/**
 * E3 — hosted study-guide editing. The chapter's committed source of record
 * stays lean markdown (`study-guide/NN.md`, owner decision); the self-contained
 * `.md.html` is generated on demand purely as the EDITING SURFACE. The workspace
 * hosts the file's own in-file editor (orz-host-save) and, on save, persists the
 * extracted markdown back through the validated `saveStudyGuide` path.
 */

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

export interface ChapterHtmlResult {
  ok: boolean;
  /** True only when a real, editable (protocol-bearing) file was produced. */
  editable?: boolean;
  /** The self-contained `.md.html` to host (present only when editable). */
  html?: string;
  error?: string;
}

/**
 * Generate the chapter's `.md.html` for hosted editing. Returns `editable:false`
 * (no html) when no worker is configured or generation fails — the caller then
 * falls back to the block editor rather than mounting a view-only file.
 */
export async function generateChapterHtmlAction(
  packageId: string,
  path: string,
  title?: string,
): Promise<ChapterHtmlResult> {
  const { supabase } = await requireUser();
  if (!workerConfigured()) return { ok: true, editable: false };
  try {
    const store = new SupabaseSandboxStore(supabase);
    const doc = await loadStudyGuide(store, packageId, path);
    const markdown = serializeStudyGuide(doc.preamble, doc.blocks);
    const html = await generateEditableFile({ kind: "md", markdown, title });
    return { ok: true, editable: true, html };
  } catch {
    // No reachable worker / generation error — degrade to the block editor.
    return { ok: true, editable: false };
  }
}

export interface HostSaveResult {
  ok: boolean;
  error?: string;
}

/**
 * Persist a save the hosted `.md.html` editor initiated (orz-host-save). The
 * file hands back both its markdown `source` and the full `rendered` document;
 * per the lean-source model we persist ONLY the extracted markdown, parsed and
 * written through `saveStudyGuideAction` (block-ID validation + reconcile-first
 * GitHub sync). The full file is the editing surface, never committed.
 */
export async function hostSaveStudyGuideAction(
  packageId: string,
  path: string,
  payload: { source: string; rendered: string },
): Promise<HostSaveResult> {
  await requireUser();
  if (!payload.source.trim()) {
    return { ok: false, error: "The document arrived empty — nothing was saved." };
  }
  const { preamble, blocks } = parseStudyGuide(payload.source);
  const res = await saveStudyGuideAction(packageId, { path, preamble, blocks });
  // A GitHub-sync warning (outside changes) still means the local save landed;
  // surface it as the ack message so the educator sees it in the file.
  return { ok: res.ok, error: res.error ?? res.warning };
}
