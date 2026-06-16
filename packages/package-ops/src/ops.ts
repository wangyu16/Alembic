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
import {
  loadConceptMap,
  saveConceptMap,
  loadObjectives,
  saveObjectives,
} from "./planning";
import {
  saveQuestionTemplate,
  loadQuestionTemplate,
  listQuestionTemplates,
  saveBlueprint,
  loadBlueprint,
  listBlueprints,
  saveQuestionItem,
  loadQuestionItem,
  listQuestionItems,
  saveAnswerKey,
  loadAnswerKey,
  isReleased,
} from "./assessments";
import type {
  ProposedChangeSet,
  ConceptMap,
  Objectives,
  QuestionTemplate,
  AssessmentBlueprint,
  QuestionItem,
  AnswerKey,
} from "@alembic/package-contract";

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

  /** Hidden planning layer: concept map (topics + correlations/prerequisites). */
  loadConceptMap(scope: "course" | "chapter", slug?: string): Promise<ConceptMap>;
  saveConceptMap(map: ConceptMap, slug?: string): Promise<void>;
  /** Hidden planning layer: per-scope learning objectives. */
  loadObjectives(scope: "course" | "chapter", slug?: string): Promise<Objectives>;
  saveObjectives(objectives: Objectives, slug?: string): Promise<void>;

  /** Assessment layer: question templates (public-safe). */
  saveQuestionTemplate(t: QuestionTemplate): Promise<void>;
  loadQuestionTemplate(id: string): Promise<QuestionTemplate | null>;
  listQuestionTemplates(): Promise<QuestionTemplate[]>;
  /** Assessment layer: assessment blueprints (public-safe). */
  saveBlueprint(b: AssessmentBlueprint): Promise<void>;
  loadBlueprint(id: string): Promise<AssessmentBlueprint | null>;
  listBlueprints(): Promise<AssessmentBlueprint[]>;
  /** Assessment layer: generated question items / stems (public-safe). */
  saveQuestionItem(item: QuestionItem): Promise<void>;
  loadQuestionItem(id: string): Promise<QuestionItem | null>;
  listQuestionItems(): Promise<QuestionItem[]>;
  /** Assessment layer: answer keys (instructor-only; PRIVATE repo). */
  saveAnswerKey(key: AnswerKey): Promise<void>;
  loadAnswerKey(itemId: string): Promise<AnswerKey | null>;
  /** Pure embargo time check: is a blueprint released at `now`? */
  isReleased(blueprint: AssessmentBlueprint, now: Date): boolean;

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

    loadConceptMap: (scope, slug) => loadConceptMap(store, packageId, scope, slug),
    saveConceptMap: (map, slug) => saveConceptMap(store, packageId, map, slug),
    loadObjectives: (scope, slug) => loadObjectives(store, packageId, scope, slug),
    saveObjectives: (objectives, slug) =>
      saveObjectives(store, packageId, objectives, slug),

    saveQuestionTemplate: (t) => saveQuestionTemplate(store, packageId, t),
    loadQuestionTemplate: (id) => loadQuestionTemplate(store, packageId, id),
    listQuestionTemplates: () => listQuestionTemplates(store, packageId),
    saveBlueprint: (b) => saveBlueprint(store, packageId, b),
    loadBlueprint: (id) => loadBlueprint(store, packageId, id),
    listBlueprints: () => listBlueprints(store, packageId),
    saveQuestionItem: (item) => saveQuestionItem(store, packageId, item),
    loadQuestionItem: (id) => loadQuestionItem(store, packageId, id),
    listQuestionItems: () => listQuestionItems(store, packageId),
    saveAnswerKey: (key) => saveAnswerKey(store, packageId, key),
    loadAnswerKey: (itemId) => loadAnswerKey(store, packageId, itemId),
    isReleased: (blueprint, now) => isReleased(blueprint, now),

    gatherCoherenceContext: () => gatherCoherenceContext(store, packageId),
    applyProposedChangeSet: (set, opts) =>
      applyProposedChangeSet(store, packageId, set, opts),
  };
}
