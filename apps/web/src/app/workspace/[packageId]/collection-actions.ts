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

// ── CF3: open / delete / rename within a collection ──────────────────────────
// Commits route by repo (private → the private helper), and deletions reach
// GitHub via a `content: null` change (github-bridge FileChange). All no-ops for
// a sandbox package.

/** Boundary-aware: `path` is at or under folder `prefix` (`a/b` never `a/bc`). */
function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function repoOf(space: string): "public" | "private" {
  return space.startsWith("private") ? "private" : "public";
}

/** Load one collection file's current content (for opening it in an editor). */
export async function loadCollectionFileAction(
  packageId: string,
  repo: "public" | "private",
  path: string,
): Promise<{ ok: boolean; content?: string; error?: string }> {
  const { supabase } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const files = await store.listFiles(packageId);
  const f = files.find((x) => x.repo === repo && x.path === path);
  if (!f) return { ok: false, error: "That file no longer exists." };
  return { ok: true, content: f.content };
}

/**
 * Delete a collection file, or a whole folder subtree. `space` fixes the repo
 * (two-repo invariant); a path that doesn't live under the space is refused.
 */
export async function deleteCollectionEntryAction(
  packageId: string,
  space: string,
  path: string,
  isFolder: boolean,
): Promise<{ ok: boolean; count?: number; error?: string }> {
  const { supabase, user } = await requireUser();
  const repo = repoOf(space);
  if (path.replace(/^\/+/, "").split("/")[0] !== space) {
    return { ok: false, error: "That path is outside the collection." };
  }
  const store = new SupabaseSandboxStore(supabase);
  const files = await store.listFiles(packageId);
  const targets = files.filter(
    (f) => f.repo === repo && (isFolder ? underPrefix(f.path, path) : f.path === path),
  );
  if (targets.length === 0) return { ok: false, error: "Nothing to delete." };

  await store.deleteFiles(packageId, targets.map((f) => ({ repo, path: f.path })));
  const commit = repo === "private" ? syncPrivateFilesToGitHub : syncFilesToGitHub;
  await commit(
    supabase,
    store,
    user.id,
    packageId,
    targets.map((f) => ({ path: f.path, content: null })),
    isFolder ? "Delete folder (Alembic)" : "Delete file (Alembic)",
  );
  await syncPackageRegistry(supabase, packageId);
  revalidatePath(`/workspace/${packageId}`);
  return { ok: true, count: targets.length };
}

/**
 * Rename/move a single collection file to `toPath` (same space/repo). The commit
 * removes the old path (`content: null`) and writes the new one.
 */
export async function renameCollectionFileAction(
  packageId: string,
  space: string,
  fromPath: string,
  toPath: string,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const { supabase, user } = await requireUser();
  const repo = repoOf(space);
  const from = fromPath.replace(/^\/+/, "");
  const to = toPath.replace(/^\/+/, "");
  if (from.split("/")[0] !== space || to.split("/")[0] !== space) {
    return { ok: false, error: "A move must stay inside the collection." };
  }
  if (to.includes("..")) return { ok: false, error: "Invalid destination." };
  if (from === to) return { ok: true, path: to };

  const store = new SupabaseSandboxStore(supabase);
  const files = await store.listFiles(packageId);
  const source = files.find((f) => f.repo === repo && f.path === from);
  if (!source) return { ok: false, error: "That file no longer exists." };
  if (files.some((f) => f.repo === repo && f.path === to)) {
    return { ok: false, error: "A file already exists at that name." };
  }

  await store.putFiles(packageId, [{ repo, path: to, content: source.content }]);
  await store.deleteFiles(packageId, [{ repo, path: from }]);
  const commit = repo === "private" ? syncPrivateFilesToGitHub : syncFilesToGitHub;
  await commit(
    supabase,
    store,
    user.id,
    packageId,
    [
      { path: from, content: null },
      { path: to, content: source.content },
    ],
    "Rename file (Alembic)",
  );
  await syncPackageRegistry(supabase, packageId);
  revalidatePath(`/workspace/${packageId}`);
  return { ok: true, path: to };
}
