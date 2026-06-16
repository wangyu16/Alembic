import type { StudyGuideBlock } from "@alembic/package-contract";
import type { PackageStore } from "./store";
import { loadStudyGuide, saveStudyGuide, type StudyGuideDoc } from "./study-guide";
import {
  createChapter,
  deleteChapter,
  listChapters,
  renameChapter,
  reorderChapters,
  type ChapterInfo,
} from "./chapters";
import {
  listAssets,
  readAsset,
  writeAsset,
  type AssetInfo,
  type ReadAssetResult,
  type WriteAssetInput,
  type WriteAssetResult,
} from "./assets";
import { listArtifacts, type ArtifactStatus } from "./worksheets";
import {
  applyProposedChangeSet,
  gatherCoherenceContext,
  type ApplyProposedChangeSetOptions,
  type ApplyProposedChangeSetResult,
  type CoherenceContext,
} from "./coherence";
import type { ProposedChangeSet } from "@alembic/package-contract";

/**
 * The canonical package **content** operations, bound to one (store, package).
 *
 * This is the stable boundary every writer targets — the web server actions,
 * the future local studio (M17.1, over a `LocalPackageStore`), and the Phase-3
 * agent/worker. They differ only in the `PackageStore` they pass; the
 * operations — and therefore the two-repo + block-ID + layer validation inside
 * them — are identical. New write paths MUST go through here, never around it,
 * so there is exactly one validated way to change a package (see
 * docs/specs/forward-compatibility.md).
 *
 * Scope is deliberately **content I/O** (study guide, chapters, carrier assets,
 * derived-artifact listing). AI generation, GitHub sync, and governance are
 * separate concerns layered on top by the caller — not part of this surface.
 */
export interface PackageOps {
  loadStudyGuide(path?: string): Promise<StudyGuideDoc>;
  saveStudyGuide(doc: StudyGuideDoc): Promise<{ blocks: StudyGuideBlock[] }>;

  listChapters(): Promise<ChapterInfo[]>;
  createChapter(input: { title: string; slug?: string }): Promise<ChapterInfo>;
  renameChapter(slug: string, newTitle: string): Promise<void>;
  reorderChapters(orderedSlugs: string[]): Promise<void>;
  deleteChapter(slug: string): Promise<void>;

  listAssets(): Promise<AssetInfo[]>;
  readAsset(path: string): Promise<ReadAssetResult>;
  writeAsset(input: WriteAssetInput): Promise<WriteAssetResult>;

  listArtifacts(): Promise<ArtifactStatus[]>;

  /** Read-only course projection the Tier-B coherence agent reasons over. */
  gatherCoherenceContext(): Promise<CoherenceContext>;
  /** Apply an accepted ProposedChangeSet through the validated write path. */
  applyProposedChangeSet(
    set: ProposedChangeSet,
    opts?: ApplyProposedChangeSetOptions,
  ): Promise<ApplyProposedChangeSetResult>;
}

/** Bind the content operations to a store + package — the same surface for
 * cloud (Supabase store), local studio (FSA store), and the agent/worker. */
export function packageOps(store: PackageStore, packageId: string): PackageOps {
  return {
    loadStudyGuide: (path) => loadStudyGuide(store, packageId, path),
    saveStudyGuide: (doc) => saveStudyGuide(store, packageId, doc),

    listChapters: () => listChapters(store, packageId),
    createChapter: (input) => createChapter(store, packageId, input),
    renameChapter: (slug, newTitle) => renameChapter(store, packageId, slug, newTitle),
    reorderChapters: (orderedSlugs) => reorderChapters(store, packageId, orderedSlugs),
    deleteChapter: (slug) => deleteChapter(store, packageId, slug),

    listAssets: () => listAssets(store, packageId),
    readAsset: (path) => readAsset(store, packageId, path),
    writeAsset: (input) => writeAsset(store, packageId, input),

    listArtifacts: () => listArtifacts(store, packageId),

    gatherCoherenceContext: () => gatherCoherenceContext(store, packageId),
    applyProposedChangeSet: (set, opts) =>
      applyProposedChangeSet(store, packageId, set, opts),
  };
}
