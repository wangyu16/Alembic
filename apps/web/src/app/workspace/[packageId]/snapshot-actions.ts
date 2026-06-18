"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { commitFiles } from "@alembic/github-bridge";
import { generateCitationCff } from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { clientForUser, recordSyncedSha } from "@/lib/github";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

/** A valid git tag from an educator-typed name ("Fall 2026" → "fall-2026"). */
function tagFromName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, 60) || "snapshot"
  );
}

async function publicRepo(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, packageId: string) {
  const store = new SupabaseSandboxStore(supabase);
  const record = await store.getPackage(packageId);
  const repo = record?.storage === "github" ? record.manifest.publicRepo : null;
  return { record, repo };
}

export interface SnapshotResult {
  ok: boolean;
  tag?: string;
  error?: string;
}

/**
 * Create a snapshot = an immutable Git tag on the public repo at its current
 * head (M15.1). Captures the whole package — content and carrier assets — so
 * citations and adaptations can target a fixed version, not a moving head.
 */
export async function createSnapshotAction(
  packageId: string,
  name: string,
): Promise<SnapshotResult> {
  const { supabase, user } = await requireUser();
  if (!name.trim()) return { ok: false, error: "Name this snapshot (e.g. “Fall 2026”)." };
  const { repo } = await publicRepo(supabase, packageId);
  if (!repo) return { ok: false, error: "Publish to GitHub before taking a snapshot." };
  const gh = await clientForUser(supabase, user.id);
  if (!gh) return { ok: false, error: "Reconnect publishing to take a snapshot." };

  const coords = { owner: repo.owner, repo: repo.name };
  const tag = tagFromName(name);
  try {
    const branch = await gh.client.getDefaultBranch(coords);
    const head = await gh.client.getBranchHead(coords, branch);
    await gh.client.createTag(coords, tag, head.commitSha);
    await supabaseEventLogger(supabase).log({
      type: "snapshot.created",
      userId: user.id,
      packageId,
      detail: { tag },
      occurredAt: new Date().toISOString(),
    });
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true, tag };
  } catch (e) {
    const exists = e instanceof Error && /422/.test(e.message);
    return {
      ok: false,
      error: exists ? `A snapshot named “${tag}” already exists.` : "Couldn't create the snapshot.",
    };
  }
}

export interface SnapshotInfo {
  name: string;
  /** GitHub tag page. */
  url: string;
  commitSha: string;
}

/** List snapshots (tags) for a published package, with citable URLs. */
export async function listSnapshotsAction(packageId: string): Promise<SnapshotInfo[]> {
  const { supabase, user } = await requireUser();
  const { repo } = await publicRepo(supabase, packageId);
  if (!repo) return [];
  const gh = await clientForUser(supabase, user.id);
  if (!gh) return [];
  try {
    const tags = await gh.client.listTags({ owner: repo.owner, repo: repo.name });
    const base = `https://github.com/${repo.owner}/${repo.name}`;
    return tags.map((t) => ({
      name: t.name,
      url: `${base}/releases/tag/${t.name}`,
      commitSha: t.commitSha,
    }));
  } catch {
    return [];
  }
}

export interface CitationResult {
  ok: boolean;
  error?: string;
}

/**
 * Generate and commit a `CITATION.cff` to the public repo (M15.3). Optionally
 * stamped with a snapshot version so the citation targets that version.
 */
export async function addCitationAction(
  packageId: string,
  version?: string,
): Promise<CitationResult> {
  const { supabase, user } = await requireUser();
  const { record, repo } = await publicRepo(supabase, packageId);
  if (!repo || !record) return { ok: false, error: "Publish to GitHub first." };
  const gh = await clientForUser(supabase, user.id);
  if (!gh) return { ok: false, error: "Reconnect publishing first." };

  const cff = generateCitationCff(record.manifest, {
    version,
    authorName: gh.owner,
    url: `https://github.com/${repo.owner}/${repo.name}`,
    dateReleased: new Date().toISOString().slice(0, 10),
  });
  try {
    const { commitSha } = await commitFiles(
      gh.client,
      { owner: repo.owner, repo: repo.name },
      { repo: "public", summary: "Add CITATION.cff (Alembic)", changes: [{ path: "CITATION.cff", content: cff }] },
    );
    // Advance the synced pointer so this commit isn't read as foreign.
    await recordSyncedSha(supabase, packageId, commitSha);
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't write CITATION.cff." };
  }
}
