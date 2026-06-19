"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { applyEditorEdit } from "@alembic/package-ops";
import type { RepoKind } from "@alembic/package-contract";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { syncFilesToGitHub, syncPrivateFilesToGitHub } from "@/lib/github";

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
