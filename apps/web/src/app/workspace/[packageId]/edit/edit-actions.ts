"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { applyEditorEdit } from "@alembic/package-ops";
import type { RepoKind } from "@alembic/package-contract";
import { editFile } from "@alembic/ai-assist";
import { operationById, PLATFORM_SCOPE } from "@alembic/ai-operations";
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
 * In-editor AI: propose a revision of the current file. Either a registry
 * `operationId` (the server resolves its authoritative, skill-compiled
 * instruction + model routing) or a free-text `instruction` (custom ask). Both
 * are composed with the platform focus guardrail (`PLATFORM_SCOPE`) so the model
 * stays task-scoped to course-material building, then run through the governed
 * provider (entitlement + budget + logging + the AI seam). Returns the full
 * proposed content for the client to diff and the educator to approve (then
 * `saveFileAction` applies it as a validated, reviewed edit). Writes nothing.
 */
export async function proposeEditAction(
  packageId: string,
  currentSource: string,
  request: { operationId?: string; instruction?: string; selection?: boolean },
): Promise<ProposeEditResult> {
  const { supabase, user } = await requireUser();

  // Resolve the operation: a registry op supplies authoritative rules + routing;
  // otherwise fall back to the educator's free-text instruction (custom).
  let instruction = request.instruction ?? "";
  let routingKind = "editor-ai-edit";
  if (request.operationId) {
    const op = operationById(request.operationId);
    if (!op || op.mode !== "edit" || !op.instruction) {
      return { ok: false, error: "Unknown AI operation." };
    }
    instruction = op.instruction;
    routingKind = op.routingKind;
  }
  if (!instruction.trim()) return { ok: false, error: "Describe the edit you want." };

  try {
    const provider = governedProvider(supabase, { userId: user.id, packageId, kind: routingKind });
    const { proposed } = await editFile(provider, {
      source: currentSource,
      instruction,
      focus: PLATFORM_SCOPE,
      passage: request.selection ?? false,
    });
    return { ok: true, proposed };
  } catch (e) {
    if (e instanceof RateLimitError || e instanceof BudgetExceededError) {
      return { ok: false, error: e.message };
    }
    return { ok: false, error: "Couldn't get an AI suggestion. Please try again." };
  }
}

/**
 * In-editor AI (generate ops): produce new content for the current surface from
 * a registry `generate` operation — e.g. drafting the course description from
 * the title + chapter outline. Composed with `PLATFORM_SCOPE` and routed by the
 * op's `routingKind`. Returns the proposed content for the client to diff and
 * the educator to approve (applied via the host's own save). Writes nothing.
 */
export async function runGenerateOperationAction(
  packageId: string,
  operationId: string,
): Promise<ProposeEditResult> {
  await requireUser();
  void packageId;
  const op = operationById(operationId);
  if (!op || op.mode !== "generate") return { ok: false, error: "Unknown AI operation." };
  return { ok: false, error: "This AI operation isn't available yet." };
}
