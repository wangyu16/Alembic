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
  newBlockId,
  newPackageId,
  parseManifest,
  parseStudyGuide,
  serializeStudyGuide,
  type AdaptationSource,
  type License,
  type PackageManifest,
} from "@alembic/package-contract";
import type { PackageFile, PackageStore } from "./store";
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
  const sourceDoc = await loadStudyGuide(store, input.source.packageId, input.source.path);
  const wanted = input.source.blockIds;
  const selected =
    wanted && wanted.length
      ? sourceDoc.blocks.filter((b) => b.id && wanted.includes(b.id))
      : sourceDoc.blocks.filter((b) => b.id);

  return adaptGivenBlocksInto(store, {
    target: input.target,
    source: input.attribution,
    sourcePath: sourceDoc.path,
    blocks: selected.map((b) => ({ sourceBlockId: b.id!, title: b.title, body: b.body })),
  });
}

/** A pre-read source block to adapt (read by the caller — possibly cross-owner). */
export interface AdaptSourceBlock {
  sourceBlockId: string;
  title: string;
  body: string;
}

export interface AdaptGivenBlocksInput {
  target: { packageId: string; path: string; license: License };
  /** Lineage/attribution for the source (license gates `canAdapt`). */
  source: AdaptationSource;
  /** Source chapter path the blocks came from (recorded in lineage). */
  sourcePath: string;
  /** Pre-read source blocks (the caller reads them — same-owner or, for the
   *  cross-owner ecosystem (M31), via an elevated read of a public package). */
  blocks: AdaptSourceBlock[];
}

/**
 * Adapt pre-read source blocks into a target chapter — the shared primitive
 * behind same-owner adaptation and cross-owner (portal) adaptation. The caller
 * supplies the source blocks (read however is appropriate for the owner
 * relationship); this only ever WRITES the target through `saveStudyGuide` and
 * the public provenance record. License-gated; fresh ids; recorded lineage.
 */
export async function adaptGivenBlocksInto(
  store: PackageStore,
  input: AdaptGivenBlocksInput,
): Promise<AdaptBlocksResult> {
  const compat = canAdapt(input.source.license, input.target.license);
  if (!compat.ok) {
    throw new AdaptationNotAllowedError(compat.reason ?? "Licenses are not compatible.");
  }
  if (input.blocks.length === 0) {
    return { newBlockIds: [], lineage: [] };
  }

  const targetDoc = await loadStudyGuide(store, input.target.packageId, input.target.path);
  const before = targetDoc.blocks.length;
  const { blocks } = await saveStudyGuide(store, input.target.packageId, {
    path: input.target.path,
    preamble: targetDoc.preamble,
    blocks: [
      ...targetDoc.blocks,
      ...input.blocks.map((b) => ({ id: null, title: b.title, body: b.body })),
    ],
  });

  // The appended blocks are the last N, in source order.
  const appended = blocks.slice(before);
  const lineage: AdaptedBlockRef[] = appended.map((b, i) => ({
    targetBlockId: b.id!,
    sourcePackageId: input.source.packageId,
    sourceBlockId: input.blocks[i]!.sourceBlockId,
    sourcePath: input.sourcePath,
    sourceContentHash: hashAdaptedBlock(input.blocks[i]!),
    ...(input.source.snapshot ? { snapshot: input.source.snapshot } : {}),
  }));

  const existing = await loadAdaptationProvenance(store, input.target.packageId);
  const next = [...existing, ...lineage];
  assertPathAllowedInRepo(ADAPTATIONS_PROVENANCE_PATH, "public");
  await store.putFiles(input.target.packageId, [
    { repo: "public", path: ADAPTATIONS_PROVENANCE_PATH, content: JSON.stringify(next, null, 2) },
  ]);

  return { newBlockIds: appended.map((b) => b.id!), lineage };
}

export interface ForkPackageInput {
  source: {
    packageId: string;
    manifest: PackageManifest;
    /** The source's PUBLIC files (private content never travels in a fork). */
    publicFiles: PackageFile[];
  };
  target: { ownerId: string; title?: string; license: License };
  /** Required attribution string for the lineage (e.g. "Title by Author, CC-BY"). */
  attribution: string;
  snapshot?: string;
  url?: string;
  /** Injected for deterministic tests. */
  now?: () => Date;
  newBlockId?: () => string;
}

export interface ForkedPackage {
  packageId: string;
  manifest: PackageManifest;
  files: PackageFile[];
  lineage: AdaptedBlockRef[];
}

const STUDY_GUIDE_PREFIX = "study-guide/";

/**
 * Whole-package fork (guardrail G4): clone a source package's PUBLIC content
 * into a new package the educator can edit directly. Block ids are **re-minted**
 * (never reused — rule 7); references to them in concepts/objectives/etc. are
 * remapped to the new ids; `manifest.adaptedFrom` is set and per-block lineage
 * is recorded in `provenance/adaptations.json`. Private content does not travel
 * (the source author's `private-instructor/` stays theirs). License-gated. Pure
 * (no IO) — the caller reads the source files and persists the result via
 * `store.createPackage`.
 */
export function forkPackage(input: ForkPackageInput): ForkedPackage {
  const compat = canAdapt(input.source.manifest.license, input.target.license);
  if (!compat.ok) {
    throw new AdaptationNotAllowedError(compat.reason ?? "Licenses are not compatible.");
  }
  const createdAt = (input.now?.() ?? new Date()).toISOString();
  const title = input.target.title ?? input.source.manifest.title;
  const packageId = newPackageId(title);
  const mint = input.newBlockId ?? newBlockId;

  // 1. Re-mint study-guide block ids; build old→new map + lineage.
  const idMap = new Map<string, string>();
  const lineage: AdaptedBlockRef[] = [];
  const cloned: PackageFile[] = [];
  for (const f of input.source.publicFiles) {
    if (f.repo !== "public") continue; // public layers only
    if (f.path === "alembic.json" || f.path === ADAPTATIONS_PROVENANCE_PATH) continue; // regenerated
    if (f.path.startsWith(STUDY_GUIDE_PREFIX)) {
      const parsed = parseStudyGuide(f.content);
      const reminted = parsed.blocks.map((b) => {
        if (!b.id) return b;
        const nid = mint();
        idMap.set(b.id, nid);
        lineage.push({
          targetBlockId: nid,
          sourcePackageId: input.source.packageId,
          sourceBlockId: b.id,
          sourcePath: f.path,
          sourceContentHash: hashAdaptedBlock(b),
          ...(input.snapshot ? { snapshot: input.snapshot } : {}),
        });
        return { ...b, id: nid };
      });
      cloned.push({ repo: "public", path: f.path, content: serializeStudyGuide(parsed.preamble, reminted) });
    } else {
      cloned.push({ repo: "public", path: f.path, content: f.content }); // remap below
    }
  }

  // 2. Remap block-id references in non-study-guide files (concepts/objectives).
  const remap = (s: string) => {
    let out = s;
    for (const [oldId, nid] of idMap) out = out.split(oldId).join(nid);
    return out;
  };
  const finalCloned = cloned.map((f) =>
    f.path.startsWith(STUDY_GUIDE_PREFIX) ? f : { ...f, content: remap(f.content) },
  );

  // 3. New manifest — drop the source's repo bindings; set lineage.
  const { publicRepo: _pub, privateRepo: _priv, ...base } = input.source.manifest;
  void _pub;
  void _priv;
  const manifest = parseManifest({
    ...base,
    packageId,
    title,
    license: input.target.license,
    adaptedFrom: {
      packageId: input.source.packageId,
      title: input.source.manifest.title,
      license: input.source.manifest.license,
      attribution: input.attribution,
      ...(input.snapshot ? { snapshot: input.snapshot } : {}),
      ...(input.url ? { url: input.url } : {}),
    },
    createdAt,
  });

  // 4. Assemble files: manifest + cloned public + fresh lineage + a private seed.
  const files: PackageFile[] = [
    { repo: "public", path: "alembic.json", content: JSON.stringify(manifest, null, 2) + "\n" },
    ...finalCloned,
    { repo: "public", path: ADAPTATIONS_PROVENANCE_PATH, content: JSON.stringify(lineage, null, 2) },
    {
      repo: "private",
      path: "private-instructor/notes/getting-started.md",
      content: `## Private notes\n\nNotes here are **never published**. (Adapted from ${input.source.manifest.title}.)\n`,
    },
  ];
  for (const f of files) assertPathAllowedInRepo(f.path, f.repo);

  return { packageId, manifest, files, lineage };
}
