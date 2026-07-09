import {
  artifactRecordPath,
  assertPathAllowedInRepo,
  assertPublicMarkdownReferences,
  DerivedArtifactRecordSchema,
  hashBlockContent,
  newArtifactId,
  type DerivedArtifactRecord,
} from "@alembic/package-contract";
import { buildSlidesHtml, slidesSourceFromBlocks } from "@alembic/renderer";
import type { PackageFile, PackageStore } from "./store";
import { loadStudyGuide } from "./study-guide";

/* -------------------------------------------------------------------------- *
 * Authored slide decks (the `slides` space).
 *
 * Distinct from the DERIVED artifacts below: an authored deck is a first-class
 * per-chapter document whose committed source of record is the orz-slides deck
 * markdown at `slides/<slug>.md`. It is seeded from the chapter's study guide on
 * first open, then edited independently through the hosted `.slides.html`
 * framework — the same lifecycle as the study guide and practice, but the source
 * is a deck (no block-ID model). The self-contained `.slides.html` is generated
 * on demand as the editing surface / published view, never committed.
 * -------------------------------------------------------------------------- */

/** Repo path for a chapter's authored slide deck (its study-guide file stem). */
export function chapterSlidesPath(slug: string): string {
  return `slides/${slug}.md`;
}

export interface SlidesDeckDoc {
  path: string;
  /** orz-slides deck source (markdown, slides split by `<!-- slide -->`). */
  source: string;
}

/** Load a chapter's authored deck source (empty string when none exists yet). */
export async function loadSlidesDeck(
  store: PackageStore,
  packageId: string,
  path: string,
): Promise<SlidesDeckDoc> {
  const files = await store.listFiles(packageId);
  const file = files.find((f) => f.repo === "public" && f.path === path);
  return { path, source: file?.content ?? "" };
}

/**
 * Save a chapter's authored deck source through the validated write path. The
 * deck is stored verbatim (no block-ID reconcile — decks aren't block docs), but
 * the two-repo invariant (`assertPathAllowedInRepo`, fail-closed) and the public
 * reference guard (`assertPublicMarkdownReferences`) still gate every write.
 */
export async function saveSlidesDeck(
  store: PackageStore,
  packageId: string,
  doc: SlidesDeckDoc,
): Promise<void> {
  assertPathAllowedInRepo(doc.path, "public");
  assertPublicMarkdownReferences(doc.source);
  await store.putFiles(packageId, [
    { repo: "public", path: doc.path, content: doc.source },
  ]);
}

/**
 * Slide decks (M13) are DERIVED documents: generated from a chapter's
 * study-guide blocks (one section → one slide), emitted as a self-contained
 * `.slides.html` carrier (embedded deck source + rendered deck), and tracked as
 * a derived artifact (source block hashes) so edits flag the deck stale — the
 * same lifecycle as worksheets. One deck per chapter (deterministic path), so
 * regeneration overwrites in place.
 */

const SLIDES_DIR = "materials/slides";
const ARTIFACT_DIR = ".alembic/artifacts/";

/** Deterministic deck path for a chapter (its study-guide file stem). */
function slidesPath(studyGuidePath: string): string {
  const base = studyGuidePath.split("/").pop() ?? "study-guide.md";
  const stem = base.replace(/\.md$/, "") || "slides";
  return `${SLIDES_DIR}/${stem}.slides.html`;
}

function recordFile(record: DerivedArtifactRecord): PackageFile {
  return {
    repo: "public",
    path: artifactRecordPath(record.artifactId),
    content: JSON.stringify(record, null, 2) + "\n",
  };
}

/** Find an existing slides artifact record for a deck path (for idempotent regen). */
async function existingSlidesId(
  store: PackageStore,
  packageId: string,
  deckPath: string,
): Promise<string | null> {
  const files = await store.listFiles(packageId);
  for (const f of files) {
    if (f.repo !== "public" || !f.path.startsWith(ARTIFACT_DIR)) continue;
    try {
      const rec = DerivedArtifactRecordSchema.parse(JSON.parse(f.content));
      if (rec.kind === "slides" && rec.path === deckPath) return rec.artifactId;
    } catch {
      /* skip foreign/unreadable records */
    }
  }
  return null;
}

export interface GenerateSlidesInput {
  /** Chapter study-guide path; defaults to the package's single chapter. */
  path?: string;
  packageTitle?: string;
  now?: () => Date;
  /** Override the carrier builder (e.g. worker-backed, live-editable). Defaults
   *  to the in-process renderer build so package-ops needs no worker /
   *  Node-only generator dependency. */
  generate?: SlidesCarrierGenerator;
}

/** Builds a `.slides.html` carrier from deck source (injectable). */
export type SlidesCarrierGenerator = (input: {
  title: string;
  source: string;
}) => Promise<string> | string;

/**
 * Generate (or regenerate) a chapter's slide deck. Deterministic per chapter:
 * re-running overwrites the same `.slides.html` and reuses the artifact id, so
 * staleness clears on regenerate. No AI — slides are a pure projection of blocks.
 */
export async function generateSlidesArtifact(
  store: PackageStore,
  packageId: string,
  input: GenerateSlidesInput = {},
): Promise<{ record: DerivedArtifactRecord; carrier: string }> {
  const guide = await loadStudyGuide(store, packageId, input.path);
  const source = slidesSourceFromBlocks(
    guide.blocks.map((b) => ({ title: b.title, body: b.body })),
  );
  const title = input.packageTitle ? `${input.packageTitle} — Slides` : "Slides";
  const carrier = await (input.generate ?? buildSlidesHtml)({ title, source });

  const deckPath = slidesPath(guide.path);
  const artifactId = (await existingSlidesId(store, packageId, deckPath)) ?? newArtifactId();
  const record = DerivedArtifactRecordSchema.parse({
    artifactId,
    kind: "slides",
    path: deckPath,
    title,
    sourceBlocks: guide.blocks
      .filter((b) => b.id)
      .map((b) => ({ blockId: b.id!, contentHash: hashBlockContent(b) })),
    status: "fresh",
    generatedAt: (input.now?.() ?? new Date()).toISOString(),
  });

  const deckFile: PackageFile = { repo: "public", path: deckPath, content: carrier };
  assertPathAllowedInRepo(deckFile.path, "public");
  const recFile = recordFile(record);
  assertPathAllowedInRepo(recFile.path, "public");

  await store.putFiles(packageId, [deckFile, recFile]);
  return { record, carrier };
}
