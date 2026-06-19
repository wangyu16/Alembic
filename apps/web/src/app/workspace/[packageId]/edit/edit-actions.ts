"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { applyEditorEdit } from "@alembic/package-ops";
import type { RepoKind } from "@alembic/package-contract";
import { editFile } from "@alembic/ai-assist";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { syncFilesToGitHub, syncPrivateFilesToGitHub } from "@/lib/github";
import { governedProvider, RateLimitError, BudgetExceededError } from "@/lib/ai";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

export interface FileSaveResult {
  ok: boolean;
  error?: string;
}

/**
 * Save a file's content through the validated write path (`applyEditorEdit`
 * re-asserts the two-repo invariant + study-guide block-ID/reference checks),
 * then mirror to the correct repo. The new shell's generic category editors use
 * this for markdown/text files.
 */
export async function saveFileAction(
  packageId: string,
  path: string,
  repo: RepoKind,
  content: string,
): Promise<FileSaveResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    await applyEditorEdit(store, packageId, { path, repo, source: content });
    if (repo === "private") {
      await syncPrivateFilesToGitHub(supabase, store, user.id, packageId, [{ path, content }], "Edit (Alembic)");
    } else {
      await syncFilesToGitHub(supabase, store, user.id, packageId, [{ path, content }], "Edit (Alembic)");
    }
    revalidatePath(`/workspace/${packageId}/edit`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't save. Check that nothing references a private file." };
  }
}

export interface ProposeEditResult {
  ok: boolean;
  proposed?: string;
  error?: string;
}

/**
 * In-editor AI: propose a revision of the current file per an instruction. The
 * host's `requestAI` — runs through the governed provider (entitlement + budget
 * + logging + the AI seam). Returns the full proposed content for the client to
 * diff and the educator to approve (then `saveFileAction` applies it as a
 * validated, reviewed edit). Does not write anything itself.
 */
export async function proposeEditAction(
  packageId: string,
  currentSource: string,
  instruction: string,
): Promise<ProposeEditResult> {
  const { supabase, user } = await requireUser();
  if (!instruction.trim()) return { ok: false, error: "Describe the edit you want." };
  try {
    const provider = governedProvider(supabase, { userId: user.id, packageId, kind: "editor-ai-edit" });
    const { proposed } = await editFile(provider, { source: currentSource, instruction });
    return { ok: true, proposed };
  } catch (e) {
    if (e instanceof RateLimitError || e instanceof BudgetExceededError) {
      return { ok: false, error: e.message };
    }
    return { ok: false, error: "Couldn't get an AI suggestion. Please try again." };
  }
}
