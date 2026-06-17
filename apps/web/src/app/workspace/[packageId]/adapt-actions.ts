"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  serializeStudyGuide,
  type License,
} from "@alembic/package-contract";
import {
  adaptBlocksInto,
  loadStudyGuide,
  detectUpstreamUpdates,
  applyUpstreamUpdate,
  loadAdaptationProvenance,
  AdaptationNotAllowedError,
  ADAPTATIONS_PROVENANCE_PATH,
  type UpstreamUpdate,
  type PullUpdateMode,
} from "@alembic/package-ops";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SupabaseSandboxStore } from "@/lib/sandbox-store";
import { supabaseEventLogger } from "@/lib/events";
import { syncFilesToGitHub } from "@/lib/github";
import { recordChange } from "@/lib/changes";

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/signin");
  return { supabase, user };
}

export interface AdaptSource {
  id: string;
  title: string;
  license: License;
}

/** The user's OTHER packages, offered as adaptation sources. */
export async function listAdaptSourcesAction(packageId: string): Promise<AdaptSource[]> {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("packages")
    .select("id, title, manifest")
    .neq("id", packageId)
    .order("created_at", { ascending: false });
  return (
    (data as { id: string; title: string; manifest: { license?: License } }[] | null) ?? []
  ).map((p) => ({ id: p.id, title: p.title, license: p.manifest?.license ?? "CC-BY-4.0" }));
}

export interface AdaptResult {
  ok: boolean;
  adapted?: number;
  error?: string;
}

/**
 * Adapt the source package's first chapter into the current package's active
 * chapter: license-gated, with new ids + recorded lineage + attribution. The
 * adapted sections are appended (the educator can then edit/curate them).
 */
export async function adaptChapterAction(
  packageId: string,
  sourcePackageId: string,
  targetPath: string,
): Promise<AdaptResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const target = await store.getPackage(packageId);
    const sourceRec = await store.getPackage(sourcePackageId);
    if (!target || !sourceRec) return { ok: false, error: "Package not found." };

    const res = await adaptBlocksInto(store, {
      source: { packageId: sourcePackageId }, // source default chapter, all blocks
      target: { packageId, path: targetPath, license: target.manifest.license },
      attribution: {
        packageId: sourcePackageId,
        title: sourceRec.title,
        license: sourceRec.manifest.license,
        attribution: `Adapted from "${sourceRec.title}"`,
        adaptedAt: new Date().toISOString(),
      },
    });
    if (res.newBlockIds.length === 0) return { ok: false, error: "The source has no sections to adapt." };

    // Sync the updated target chapter + the provenance record to GitHub.
    const doc = await loadStudyGuide(store, packageId, targetPath);
    const provFile = (await store.listFiles(packageId)).find(
      (f) => f.repo === "public" && f.path === ADAPTATIONS_PROVENANCE_PATH,
    );
    await syncFilesToGitHub(
      supabase, store, user.id, packageId,
      [
        { path: targetPath, content: serializeStudyGuide(doc.preamble, doc.blocks) },
        ...(provFile ? [{ path: ADAPTATIONS_PROVENANCE_PATH, content: provFile.content }] : []),
      ],
      `Adapt sections from "${sourceRec.title}" (Alembic)`,
    );
    await supabaseEventLogger(supabase).log({
      type: "adaptation.completed",
      userId: user.id,
      packageId,
      detail: { sourcePackageId, blocks: res.newBlockIds.length },
      occurredAt: new Date().toISOString(),
    });
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true, adapted: res.newBlockIds.length };
  } catch (e) {
    if (e instanceof AdaptationNotAllowedError) return { ok: false, error: e.reason };
    return { ok: false, error: "Couldn't adapt that content. Please try again." };
  }
}

export interface AdaptedBlock {
  targetBlockId: string;
  title: string;
}

/** M28 — adapted blocks in this chapter that have an upstream source to suggest back to. */
export async function listAdaptedBlocksAction(
  packageId: string,
  path: string,
): Promise<AdaptedBlock[]> {
  const { supabase } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const lineage = await loadAdaptationProvenance(store, packageId);
    if (lineage.length === 0) return [];
    const bySource = new Map(lineage.map((r) => [r.targetBlockId, r]));
    const doc = await loadStudyGuide(store, packageId, path);
    return doc.blocks
      .filter((b) => b.id && bySource.has(b.id) && bySource.get(b.id)!.sourcePath)
      .map((b) => ({ targetBlockId: b.id!, title: b.title }));
  } catch {
    return [];
  }
}

/**
 * M28 — suggest the adapter's improved version of an adapted block BACK to the
 * upstream source author. Platform-mediated (goal.md): records a Tier-3
 * `suggest-back` change ON the upstream package's review queue; the author
 * accepts/rejects it there. Optional GitHub-PR materialization is a follow-up.
 */
export async function suggestBackAction(
  packageId: string,
  targetBlockId: string,
  note: string,
): Promise<AdaptResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const lineage = await loadAdaptationProvenance(store, packageId);
    const ref = lineage.find((r) => r.targetBlockId === targetBlockId);
    if (!ref || !ref.sourcePath) return { ok: false, error: "No upstream source recorded for that section." };

    // The adapter's current (improved) version of the block.
    const files = await store.listFiles(packageId);
    const here = await store.getPackage(packageId);
    let suggested: { title: string; body: string } | null = null;
    for (const f of files) {
      if (f.repo !== "public" || !f.path.startsWith("study-guide/")) continue;
      const doc = await loadStudyGuide(store, packageId, f.path);
      const b = doc.blocks.find((x) => x.id === targetBlockId);
      if (b) { suggested = { title: b.title, body: b.body }; break; }
    }
    if (!suggested) return { ok: false, error: "That section no longer exists." };

    // Queue a Tier-3 suggest-back on the UPSTREAM package's review queue.
    await recordChange(supabase, {
      packageId: ref.sourcePackageId,
      userId: user.id,
      tier: 3,
      kind: "suggest-back",
      summary: `Suggested edit to "${suggested.title}"${here ? ` from "${here.title}"` : ""}`,
      detail: {
        path: ref.sourcePath,
        suggestBlockId: ref.sourceBlockId,
        suggestedTitle: suggested.title,
        suggestedBody: suggested.body,
        fromPackageId: packageId,
        note,
      },
      status: "pending",
    });
    await supabaseEventLogger(supabase).log({
      type: "suggestion.sent",
      userId: user.id,
      packageId,
      detail: { toPackageId: ref.sourcePackageId },
      occurredAt: new Date().toISOString(),
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't send the suggestion. Please try again." };
  }
}

/** M27 — list adapted blocks whose upstream source has changed. */
export async function listUpstreamUpdatesAction(
  packageId: string,
  targetPath: string,
): Promise<UpstreamUpdate[]> {
  const { supabase } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    return await detectUpstreamUpdates(store, packageId, targetPath);
  } catch {
    return [];
  }
}

/**
 * M27 — resolve one upstream update: "take" the upstream content or "keep" your
 * own (recorded divergence). Syncs the changed chapter + the provenance record.
 */
export async function applyUpstreamUpdateAction(
  packageId: string,
  targetPath: string,
  targetBlockId: string,
  mode: PullUpdateMode,
): Promise<AdaptResult> {
  const { supabase, user } = await requireUser();
  const store = new SupabaseSandboxStore(supabase);
  try {
    const res = await applyUpstreamUpdate(store, packageId, targetPath, targetBlockId, mode);
    if (!res.applied) return { ok: false, error: "That update is no longer available." };

    const provFile = (await store.listFiles(packageId)).find(
      (f) => f.repo === "public" && f.path === ADAPTATIONS_PROVENANCE_PATH,
    );
    const changes = [
      ...(res.content ? [{ path: targetPath, content: res.content }] : []),
      ...(provFile ? [{ path: ADAPTATIONS_PROVENANCE_PATH, content: provFile.content }] : []),
    ];
    await syncFilesToGitHub(
      supabase, store, user.id, packageId, changes,
      mode === "take" ? "Take upstream update (Alembic)" : "Keep local version (Alembic)",
    );
    await supabaseEventLogger(supabase).log({
      type: "upstream.update.applied",
      userId: user.id,
      packageId,
      detail: { mode, targetBlockId },
      occurredAt: new Date().toISOString(),
    });
    revalidatePath(`/workspace/${packageId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't apply that update. Please try again." };
  }
}
