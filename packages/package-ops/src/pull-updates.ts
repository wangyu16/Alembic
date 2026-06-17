/**
 * Pull updates: upstream → adapter (Phase 5, M27).
 *
 * When an adapted block's SOURCE changes upstream, the adapter can take the
 * update or keep their own version — with the divergence recorded. Detection is
 * the M3 staleness pattern over the adaptation lineage (`provenance/adaptations.json`,
 * M26): each entry stores the source block's content hash at adaptation time;
 * if the source block's current hash differs, an update is available.
 *
 * "take" replaces the adapter's block with the upstream content; "keep"
 * acknowledges the change and stops flagging it (recorded divergence). Both
 * advance the stored hash so the item clears. AI-assisted merge is layered on
 * by the caller (single-call provider) — this module is pure store I/O.
 */

import { serializeStudyGuide } from "@alembic/package-contract";
import type { PackageStore } from "./store";
import { loadStudyGuide, saveStudyGuide } from "./study-guide";
import {
  ADAPTATIONS_PROVENANCE_PATH,
  hashAdaptedBlock,
  loadAdaptationProvenance,
  type AdaptedBlockRef,
} from "./adaptation";

export interface UpstreamUpdate {
  targetBlockId: string;
  /** The adapter's current title for context. */
  targetTitle: string;
  sourcePackageId: string;
  sourceBlockId: string;
  /** Upstream's current title/body (what "take" would apply). */
  upstreamTitle: string;
  upstreamBody: string;
}

/**
 * List adapted blocks whose upstream source has changed since adaptation.
 * Skips entries that predate hash/path tracking (legacy) or whose source block
 * or target block no longer exists.
 */
export async function detectUpstreamUpdates(
  store: PackageStore,
  packageId: string,
  targetPath: string,
): Promise<UpstreamUpdate[]> {
  const lineage = await loadAdaptationProvenance(store, packageId);
  if (lineage.length === 0) return [];

  const targetDoc = await loadStudyGuide(store, packageId, targetPath);
  const targetById = new Map(targetDoc.blocks.filter((b) => b.id).map((b) => [b.id!, b]));

  // Cache source chapters so we don't reload per entry.
  const sourceCache = new Map<string, Awaited<ReturnType<typeof loadStudyGuide>>>();
  const updates: UpstreamUpdate[] = [];

  for (const ref of lineage) {
    if (!ref.sourceContentHash || !ref.sourcePath) continue; // legacy entry
    const target = targetById.get(ref.targetBlockId);
    if (!target) continue; // adapter deleted it

    const cacheKey = `${ref.sourcePackageId}::${ref.sourcePath}`;
    let sourceDoc = sourceCache.get(cacheKey);
    if (!sourceDoc) {
      sourceDoc = await loadStudyGuide(store, ref.sourcePackageId, ref.sourcePath);
      sourceCache.set(cacheKey, sourceDoc);
    }
    const sourceBlock = sourceDoc.blocks.find((b) => b.id === ref.sourceBlockId);
    if (!sourceBlock) continue; // source removed the block

    if (hashAdaptedBlock(sourceBlock) !== ref.sourceContentHash) {
      updates.push({
        targetBlockId: ref.targetBlockId,
        targetTitle: target.title,
        sourcePackageId: ref.sourcePackageId,
        sourceBlockId: ref.sourceBlockId,
        upstreamTitle: sourceBlock.title,
        upstreamBody: sourceBlock.body,
      });
    }
  }
  return updates;
}

async function advanceHash(
  store: PackageStore,
  packageId: string,
  targetBlockId: string,
  newHash: string,
): Promise<void> {
  const lineage = await loadAdaptationProvenance(store, packageId);
  const next: AdaptedBlockRef[] = lineage.map((r) =>
    r.targetBlockId === targetBlockId ? { ...r, sourceContentHash: newHash } : r,
  );
  await store.putFiles(packageId, [
    { repo: "public", path: ADAPTATIONS_PROVENANCE_PATH, content: JSON.stringify(next, null, 2) },
  ]);
}

export type PullUpdateMode = "take" | "keep";

export interface PullUpdateResult {
  applied: boolean;
  /** The resulting target chapter content (for GitHub sync), when changed. */
  content?: string;
}

/**
 * Resolve an available upstream update for one adapted block:
 *  - "take": replace the adapter's block title/body with the upstream content;
 *  - "keep": leave the adapter's block as-is (recorded divergence).
 * Both advance the stored source hash so the item stops being flagged. Returns
 * the updated chapter content when "take" changed it (caller syncs to GitHub).
 */
export async function applyUpstreamUpdate(
  store: PackageStore,
  packageId: string,
  targetPath: string,
  targetBlockId: string,
  mode: PullUpdateMode,
): Promise<PullUpdateResult> {
  const lineage = await loadAdaptationProvenance(store, packageId);
  const ref = lineage.find((r) => r.targetBlockId === targetBlockId);
  if (!ref || !ref.sourcePath) return { applied: false };

  const sourceDoc = await loadStudyGuide(store, ref.sourcePackageId, ref.sourcePath);
  const sourceBlock = sourceDoc.blocks.find((b) => b.id === ref.sourceBlockId);
  if (!sourceBlock) return { applied: false }; // upstream removed it; nothing to pull
  const newHash = hashAdaptedBlock(sourceBlock);

  if (mode === "keep") {
    await advanceHash(store, packageId, targetBlockId, newHash);
    return { applied: true };
  }

  // take: replace the adapter's block content with upstream, preserving the id.
  const doc = await loadStudyGuide(store, packageId, targetPath);
  const block = doc.blocks.find((b) => b.id === targetBlockId);
  if (!block) return { applied: false };
  block.title = sourceBlock.title;
  block.body = sourceBlock.body;
  const { blocks } = await saveStudyGuide(store, packageId, doc);
  await advanceHash(store, packageId, targetBlockId, newHash);
  return { applied: true, content: serializeStudyGuide(doc.preamble, blocks) };
}
