"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  PackageRenameError,
  normalizeTitle,
  withTitle,
  updateManifest,
  CommitFailedError,
  CommitUnavailableError,
  ManifestConflictError,
  ManifestNotFoundError,
} from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { clientForUser } from "@/lib/github";
import { committerFor } from "@/lib/committer";
import { supabaseEventLogger } from "@/lib/events";

export interface LifecycleResult {
  ok: boolean;
  error?: string;
}

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

/**
 * Rename a package's display title. The title lives in the manifest
 * (`alembic.json`, the source of truth), so the rename goes through
 * `updateManifest` — the ONE manifest owner: read the FILE manifest → patch →
 * commit (published packages) → compare-and-swap the projection, retrying on a
 * concurrent write. The `packages` row is then refreshed from the manifest
 * `updateManifest` returns, never from a separately-built copy, so the column
 * can never drift from the file. `packageId` and repo names never change.
 */
export async function renamePackageAction(
  packageId: string,
  title: string,
): Promise<LifecycleResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const started = Date.now();
  try {
    // Validate the title (PackageRenameError → educator message) before any IO.
    const newTitle = normalizeTitle(title);

    const resolved = await committerFor(supabase, store, user.id, packageId);
    if (resolved.kind === "unavailable") {
      return { ok: false, error: resolved.reason };
    }
    const { manifest } = await updateManifest(
      store,
      resolved.kind === "github" ? resolved.committer : null,
      packageId,
      (m) => withTitle(m, newTitle),
      { summary: "Rename course (Alembic)" },
    );

    const { error } = await supabase
      .from("packages")
      .update({ title: manifest.title, manifest })
      .eq("id", packageId);
    if (error) {
      return { ok: false, error: "Could not save the new name. Please try again." };
    }
    await supabaseEventLogger(supabase).log({
      type: "package.renamed",
      userId: user.id,
      packageId,
      durationMs: Date.now() - started,
      detail: {},
      occurredAt: new Date().toISOString(),
    });
    revalidatePath("/workspace");
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof PackageRenameError) return { ok: false, error: e.message };
    if (
      e instanceof CommitFailedError ||
      e instanceof CommitUnavailableError ||
      e instanceof ManifestConflictError ||
      e instanceof ManifestNotFoundError
    ) {
      return { ok: false, error: e.message };
    }
    return { ok: false, error: "That rename didn't complete. Please try again." };
  }
}

/**
 * Permanently delete a trial (unpublished) package. Removes the `packages` row;
 * FK cascades clean up sandbox files and any portal listing. There is no
 * recovery. Refuses to run on a GitHub-published package — those archive
 * instead (see archivePackageAction).
 */
export async function deletePackageAction(
  packageId: string,
): Promise<LifecycleResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record) return { ok: false, error: "That package no longer exists." };
  if (record.storage === "github") {
    return {
      ok: false,
      error: "Published packages are archived, not deleted. Archive it instead.",
    };
  }
  const { error } = await supabase.from("packages").delete().eq("id", packageId);
  if (error) {
    return { ok: false, error: "Could not delete the package. Please try again." };
  }
  await supabaseEventLogger(supabase).log({
    type: "package.deleted",
    userId: user.id,
    packageId,
    detail: { storage: "sandbox" },
    occurredAt: new Date().toISOString(),
  });
  revalidatePath("/workspace");
  return { ok: true };
}

/**
 * Archive a GitHub-published package: hide it from the workspace and unlist it
 * from the public portal, but leave both repos with the educator and keep the
 * row so it can be restored. The live site keeps working — repos are untouched.
 */
export async function archivePackageAction(
  packageId: string,
): Promise<LifecycleResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  if (!record) return { ok: false, error: "That package no longer exists." };
  if (record.storage !== "github") {
    return {
      ok: false,
      error: "Only published packages are archived. Trial packages are deleted.",
    };
  }
  const { error } = await supabase
    .from("packages")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", packageId);
  if (error) {
    return { ok: false, error: "Could not archive the package. Please try again." };
  }
  // Unlist from the public index — the owner is no longer managing it here.
  await supabase.from("portal_registrations").delete().eq("package_id", packageId);
  await supabaseEventLogger(supabase).log({
    type: "package.archived",
    userId: user.id,
    packageId,
    detail: {},
    occurredAt: new Date().toISOString(),
  });
  revalidatePath("/workspace");
  revalidatePath("/portal");
  return { ok: true };
}

/** Restore an archived package back into the workspace. */
export async function restorePackageAction(
  packageId: string,
): Promise<LifecycleResult> {
  const { supabase, user } = await requireUser();
  const { error } = await supabase
    .from("packages")
    .update({ archived_at: null })
    .eq("id", packageId);
  if (error) {
    return { ok: false, error: "Could not restore the package. Please try again." };
  }
  await supabaseEventLogger(supabase).log({
    type: "package.restored",
    userId: user.id,
    packageId,
    detail: {},
    occurredAt: new Date().toISOString(),
  });
  revalidatePath("/workspace");
  return { ok: true };
}

/**
 * Reconcile archived published packages against GitHub: if an archived
 * package's public repo is gone (the educator deleted it on GitHub), purge the
 * archived row — Alembic only mirrors reality, it never deletes repos itself.
 * Best-effort: any per-package failure (network, not connected) is swallowed so
 * the workspace always renders. Returns the ids that were purged.
 */
export async function reconcileArchivedPackages(): Promise<string[]> {
  const { supabase, user } = await requireUser();
  const { data: rows } = await supabase
    .from("packages")
    .select("id, public_repo")
    .eq("storage", "github")
    .not("archived_at", "is", null);
  if (!rows?.length) return [];

  const gh = await clientForUser(supabase, user.id);
  if (!gh) return []; // publishing not connected — can't check; leave archived.

  const purged: string[] = [];
  for (const row of rows) {
    const repo = row.public_repo as { owner: string; name: string } | null;
    if (!repo?.owner || !repo?.name) continue;
    try {
      const exists = await gh.client.repoExists({ owner: repo.owner, repo: repo.name });
      if (exists) continue;
      const { error } = await supabase.from("packages").delete().eq("id", row.id);
      if (error) continue;
      purged.push(row.id);
      await supabaseEventLogger(supabase).log({
        type: "package.purged",
        userId: user.id,
        packageId: row.id,
        detail: {},
        occurredAt: new Date().toISOString(),
      });
    } catch {
      // Transient failure — never mistake it for a deletion; try again later.
    }
  }
  if (purged.length) revalidatePath("/workspace");
  return purged;
}
