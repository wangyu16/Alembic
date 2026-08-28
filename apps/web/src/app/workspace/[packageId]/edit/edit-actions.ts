"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { writeThrough } from "@alembic/package-ops";
import type { RepoKind } from "@alembic/package-contract";
import { editFile } from "@alembic/ai-assist";
import { operationById, PLATFORM_SCOPE } from "@alembic/ai-operations";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { committerFor } from "@/lib/committer";
import { prepareEditorSave, saveFailureMessage } from "@/lib/editor-save";
import { governedProvider, RateLimitError, BudgetExceededError } from "@/lib/ai";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

/**
 * What a save reports back. `ok` alone is what the current editors read; the
 * extra fields are the minimal saving-state contract for the UI (T12) and are
 * optional so existing consumers keep compiling:
 *
 *  - `committed` — true when the change reached the permanent (GitHub) copy.
 *    False on a trial package, where the platform store IS the truth; the save
 *    is still complete and permanent for that package.
 *  - `retryable` — on failure, whether pressing Save again could succeed
 *    (a commit that didn't go through) as opposed to content the contract
 *    refuses (a private reference), which needs an edit first.
 */
export interface FileSaveResult {
  ok: boolean;
  error?: string;
  committed?: boolean;
  retryable?: boolean;
}

/**
 * Save a file's content through the ONE validated write path
 * (docs/specs/storage-and-write-paths.md §3): validate → commit → project.
 *
 * `prepareEditorSave` performs exactly the checks `applyEditorEdit` did (two-repo
 * invariant, study-guide block-ID integrity, public reference guard) but writes
 * nothing; `writeThrough` then commits to the right repo FIRST and projects into
 * the store only from a successful commit. If the commit fails — or the package
 * is published and its online home is unreachable — nothing is changed anywhere
 * and the educator is told so. There is no silent local-only save: a save that
 * didn't reach permanence didn't happen (educator-version-contract.md, "Save").
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
    // 1. Validate + canonicalize. Throws before any IO happens.
    const write = prepareEditorSave({ path, repo, source: content });

    // 2. Decide the write path in one place. Published-but-unreachable is a
    //    refusal, never a degrade-to-local.
    const resolution = await committerFor(supabase, store, user.id, packageId);
    if (resolution.kind === "unavailable") {
      return { ok: false, error: resolution.reason, retryable: true };
    }

    // 3. Commit, then project.
    const result = await writeThrough(
      store,
      resolution.kind === "github" ? resolution.committer : null,
      packageId,
      { changes: [write], summary: `Update ${write.path}` },
    );

    revalidatePath(`/workspace/${packageId}/edit`);
    return { ok: true, committed: result.committed };
  } catch (e) {
    const { message, retryable } = saveFailureMessage(e);
    return { ok: false, error: message, retryable };
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
