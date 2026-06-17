/**
 * Adaptation operations (Phase 5, M26.2).
 *
 * Copy content from a source package into a target package with NEW block ids
 * (block identity is never reused — CLAUDE.md rule 7), gated by Creative-Commons
 * license compatibility (`canAdapt`), recording per-block lineage in a public
 * `provenance/` record so attribution + upstream links travel with the work.
 *
 * Block-level: `adaptBlocksInto` appends selected source blocks to a target
 * chapter via `saveStudyGuide` (the one validated write path) and records
 * lineage. Whole-package forks set `manifest.adaptedFrom` at creation time
 * (the manifest field added in M26.1); this module records the block lineage.
 */

import {
  canAdapt,
  assertPathAllowedInRepo,
  hashContent,
  type AdaptationSource,
  type License,
} from "@alembic/package-contract";
import type { PackageStore } from "./store";
import { loadStudyGuide, saveStudyGuide } from "./study-guide";

/** Stable content hash of a source block (title + body) — drives M27 drift detection. */
export function hashAdaptedBlock(block: { title: string; body: string }): string {
  return hashContent(`${block.title}\n${block.body}`);
}

/** One adapted block's lineage (provenance/adaptations.json entry). */
export interface AdaptedBlockRef {
  targetBlockId: string;
  sourcePackageId: string;
  sourceBlockId: string;
  /** Source snapshot tag the adaptation was pinned to, if any. */
  snapshot?: string;
  /** Source chapter path the block came from (for pull-updates, M27). */
  sourcePath?: string;
  /** Hash of the source block at adaptation time — upstream drift = hash differs. */
  sourceContentHash?: string;
}

export const ADAPTATIONS_PROVENANCE_PATH = "provenance/adaptations.json";

export class AdaptationNotAllowedError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "AdaptationNotAllowedError";
  }
}

export interface AdaptBlocksInput {
  source: {
    packageId: string;
    /** Source chapter path (defaults to the package's default study guide). */
    path?: string;
    /** Which blocks to adapt; omit/empty = the whole chapter. */
    blockIds?: string[];
  };
  target: {
    packageId: string;
    /** Target chapter path the adapted blocks are appended to. */
    path: string;
    /** Target package license — gates compatibility. */
    license: License;
  };
  /** Lineage/attribution for the source (license gates `canAdapt`). */
  attribution: AdaptationSource;
}

export interface AdaptBlocksResult {
  newBlockIds: string[];
  lineage: AdaptedBlockRef[];
}

/** Load the public `provenance/adaptations.json` record, or [] if absent. */
export async function loadAdaptationProvenance(
  store: PackageStore,
  packageId: string,
): Promise<AdaptedBlockRef[]> {
  const files = await store.listFiles(packageId);
  const file = files.find(
    (f) => f.repo === "public" && f.path === ADAPTATIONS_PROVENANCE_PATH,
  );
  if (!file) return [];
  try {
    const parsed = JSON.parse(file.content) as unknown;
    return Array.isArray(parsed) ? (parsed as AdaptedBlockRef[]) : [];
  } catch {
    return [];
  }
}

/**
 * Adapt (copy) selected study-guide blocks from a source package into a target
 * chapter: license-gated, with fresh ids and recorded lineage.
 *
 *  1. `canAdapt(source.license, target.license)` — throw if incompatible.
 *  2. load the source chapter; select the requested blocks (or all).
 *  3. append copies as new blocks (id: null → minted) via `saveStudyGuide`.
 *  4. record per-block lineage in `provenance/adaptations.json` (public).
 */
export async function adaptBlocksInto(
  store: PackageStore,
  input: AdaptBlocksInput,
): Promise<AdaptBlocksResult> {
  const compat = canAdapt(input.attribution.license, input.target.license);
  if (!compat.ok) {
    throw new AdaptationNotAllowedError(compat.reason ?? "Licenses are not compatible.");
  }

  const sourceDoc = await loadStudyGuide(store, input.source.packageId, input.source.path);
  const wanted = input.source.blockIds;
  const selected =
    wanted && wanted.length
      ? sourceDoc.blocks.filter((b) => b.id && wanted.includes(b.id))
      : sourceDoc.blocks.filter((b) => b.id);
  if (selected.length === 0) {
    return { newBlockIds: [], lineage: [] };
  }

  const targetDoc = await loadStudyGuide(store, input.target.packageId, input.target.path);
  const before = targetDoc.blocks.length;
  const { blocks } = await saveStudyGuide(store, input.target.packageId, {
    path: input.target.path,
    preamble: targetDoc.preamble,
    blocks: [
      ...targetDoc.blocks,
      ...selected.map((b) => ({ id: null, title: b.title, body: b.body })),
    ],
  });

  // The appended blocks are the last `selected.length`, in source order.
  const appended = blocks.slice(before);
  const lineage: AdaptedBlockRef[] = appended.map((b, i) => ({
    targetBlockId: b.id!,
    sourcePackageId: input.source.packageId,
    sourceBlockId: selected[i]!.id!,
    sourcePath: sourceDoc.path,
    sourceContentHash: hashAdaptedBlock(selected[i]!),
    ...(input.attribution.snapshot ? { snapshot: input.attribution.snapshot } : {}),
  }));

  // Append to the public provenance record.
  const existing = await loadAdaptationProvenance(store, input.target.packageId);
  const next = [...existing, ...lineage];
  assertPathAllowedInRepo(ADAPTATIONS_PROVENANCE_PATH, "public");
  await store.putFiles(input.target.packageId, [
    { repo: "public", path: ADAPTATIONS_PROVENANCE_PATH, content: JSON.stringify(next, null, 2) },
  ]);

  return { newBlockIds: appended.map((b) => b.id!), lineage };
}
