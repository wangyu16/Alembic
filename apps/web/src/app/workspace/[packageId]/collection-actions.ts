"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { classForPath, type CollectionScope } from "@alembic/package-contract";
import { collectionItemPath } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { syncFilesToGitHub, syncPrivateFilesToGitHub } from "@/lib/github";
import { syncPackageRegistry } from "@/lib/register";
import { uploadVerdict } from "@/lib/collection-upload";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

export interface UploadCollectionFileInput {
  /** The collection's contract space directory (e.g. `assets`, `current`,
   *  `private-instructor`). Decides scope layout and — via the two-repo
   *  invariant — which repo the file may land in. */
  space: string;
  /** Target repository. Must agree with `space` (see the invariant check). */
  repo: "public" | "private";
  /** Course-wide, or bound to one live chapter. */
  scope: CollectionScope;
  /** The educator's free folder path under the scope (no semantics). */
  folder?: string;
  /** Bare filename (no path). */
  filename: string;
  /** File content — UTF-8 text as-is, or base64 for a binary (caller encodes). */
  content: string;
  /** Whether `content` is a base64-encoded binary (see `isBinaryPath`). */
  isBinary: boolean;
  /** Decoded byte length, for the size policy. */
  sizeBytes: number;
}

export interface UploadCollectionFileResult {
  ok: boolean;
  /** The repo-relative path the file landed at (to insert a reference / cite). */
  path?: string;
  /** Non-blocking nudge (e.g. a large file). */
  warning?: string;
  error?: string;
}

/**
 * The generalized collection writer (collections framework, CF2;
 * docs/specs/collections-framework.md §2, §3, §5).
 *
 * Writes ONE uploaded file into a collection: it resolves the target path from
 * (space, scope, folder, filename), enforces the two-repo invariant early,
 * applies the storage + size policy, persists through the store, commits when
 * the package is published, and re-projects the registry so the file registers.
 *
 * Supersedes the hardcoded `importFileAction` (materials/figures only); that
 * action still exists and is untouched until callers migrate.
 */
export async function uploadCollectionFileAction(
  packageId: string,
  input: UploadCollectionFileInput,
): Promise<UploadCollectionFileResult> {
  const { supabase, user } = await requireUser();

  // Two-repo invariant, enforced early (fail-closed): a `private*` space must
  // go to the private repo; everything else to public. `validateCommitPlan`
  // (via syncFilesToGitHub) is the backstop, but reject a mismatch up front so
  // private-instructor content can never be aimed at the public repo.
  const wantsPrivate = input.space.startsWith("private");
  if (wantsPrivate && input.repo !== "private") {
    return { ok: false, error: "That file can't go there." };
  }
  if (!wantsPrivate && input.repo !== "public") {
    return { ok: false, error: "That file can't go there." };
  }

  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record) return { ok: false, error: "We couldn't find that course." };

  // Build the write target. `collectionItemPath` throws on traversal / absolute
  // paths — catch it and return a clean message rather than leaking internals.
  let target: string;
  try {
    target = collectionItemPath(
      input.space,
      input.scope,
      input.folder ? `${input.folder}/${input.filename}` : input.filename,
    );
  } catch {
    return { ok: false, error: "That file name or folder isn't allowed." };
  }

  // Resolve the handling class (informational — drives affordances/permalinks
  // downstream; kept for the return/logging). Per-package types extend the
  // built-in registry.
  const handlingClass = classForPath(target, record.manifest.fileTypes);
  void handlingClass;

  const verdict = uploadVerdict({
    isBinary: input.isBinary,
    isPublished: record.storage === "github",
    sizeBytes: input.sizeBytes,
  });
  if (!verdict.ok) return { ok: false, error: verdict.error };

  // Persist (the one validated write path), then best-effort commit (published
  // → real commit; sandbox → no-op) and registry projection. Store base64
  // as-is for binaries; do not decode.
  await store.putFiles(packageId, [
    { repo: input.repo, path: target, content: input.content },
  ]);
  // Route the commit by repo: the public helper only ever targets the public
  // repo (github.ts), so a private-space file must go through the private one or
  // it would silently never reach GitHub. Both are no-ops for a sandbox package.
  const commit = input.repo === "private" ? syncPrivateFilesToGitHub : syncFilesToGitHub;
  await commit(
    supabase,
    store,
    user.id,
    packageId,
    [{ path: target, content: input.content }],
    "Upload file (Alembic)",
  );
  await syncPackageRegistry(supabase, packageId);

  revalidatePath(`/workspace/${packageId}`);
  return { ok: true, path: target, warning: verdict.warning };
}
