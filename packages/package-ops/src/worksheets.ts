import {
  artifactRecordPath,
  assertPathAllowedInRepo,
  DerivedArtifactRecordSchema,
  hashBlockContent,
  newArtifactId,
  type DerivedArtifactRecord,
  type StudyGuideBlock,
} from "@alembic/package-contract";
import { generateWorksheet, type AIProvider } from "@alembic/ai-assist";
import type { PackageFile, PackageStore } from "./store";
import { loadStudyGuide } from "./study-guide";

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "worksheet"
  );
}

function worksheetPath(title: string, artifactId: string): string {
  return `materials/worksheets/${slug(title)}-${artifactId.slice(4, 10)}.md`;
}

function recordFile(record: DerivedArtifactRecord): PackageFile {
  return {
    repo: "public",
    path: artifactRecordPath(record.artifactId),
    content: JSON.stringify(record, null, 2) + "\n",
  };
}

export interface GenerateWorksheetInput {
  provider: AIProvider;
  blockIds: string[];
  packageTitle?: string;
  now?: () => Date;
}

/**
 * Generate a worksheet from selected study-guide blocks and persist both the
 * worksheet file and its derived-artifact record (source block IDs + content
 * hashes for later staleness detection).
 */
export async function generateWorksheetArtifact(
  store: PackageStore,
  packageId: string,
  input: GenerateWorksheetInput,
): Promise<{ record: DerivedArtifactRecord; markdown: string }> {
  const guide = await loadStudyGuide(store, packageId);
  const byId = new Map(guide.blocks.filter((b) => b.id).map((b) => [b.id!, b]));
  const selected = input.blockIds
    .map((id) => byId.get(id))
    .filter((b): b is StudyGuideBlock => Boolean(b));
  if (selected.length === 0) {
    throw new Error("No matching study-guide sections to generate from.");
  }

  const result = await generateWorksheet(input.provider, {
    packageTitle: input.packageTitle,
    sections: selected.map((b) => ({ title: b.title, body: b.body })),
  });

  const artifactId = newArtifactId();
  const path = worksheetPath(result.title, artifactId);
  const record = DerivedArtifactRecordSchema.parse({
    artifactId,
    kind: "worksheet",
    path,
    title: result.title,
    sourceBlocks: selected.map((b) => ({
      blockId: b.id!,
      contentHash: hashBlockContent(b),
    })),
    status: "fresh",
    generatedAt: (input.now?.() ?? new Date()).toISOString(),
  });

  const worksheetFile: PackageFile = {
    repo: "public",
    path,
    content: result.markdown.endsWith("\n")
      ? result.markdown
      : result.markdown + "\n",
  };
  assertPathAllowedInRepo(worksheetFile.path, "public");
  const recFile = recordFile(record);
  assertPathAllowedInRepo(recFile.path, "public");

  await store.putFiles(packageId, [worksheetFile, recFile]);
  return { record, markdown: result.markdown };
}

export interface ArtifactStatus {
  record: DerivedArtifactRecord;
  /** True when a source block changed since generation (and not divergent). */
  stale: boolean;
  /** Source block IDs no longer present in the study guide. */
  missingBlocks: string[];
}

const ARTIFACT_DIR = ".alembic/artifacts/";

async function readRecords(
  store: PackageStore,
  packageId: string,
): Promise<DerivedArtifactRecord[]> {
  const files = await store.listFiles(packageId);
  const records: DerivedArtifactRecord[] = [];
  for (const f of files) {
    if (f.repo !== "public" || !f.path.startsWith(ARTIFACT_DIR)) continue;
    try {
      records.push(DerivedArtifactRecordSchema.parse(JSON.parse(f.content)));
    } catch {
      // Skip unreadable/foreign records; repos are source of truth.
    }
  }
  return records;
}

/** List artifacts with computed staleness against the current study guide. */
export async function listArtifacts(
  store: PackageStore,
  packageId: string,
): Promise<ArtifactStatus[]> {
  const [records, guide] = await Promise.all([
    readRecords(store, packageId),
    loadStudyGuide(store, packageId),
  ]);
  const currentHash = new Map(
    guide.blocks.filter((b) => b.id).map((b) => [b.id!, hashBlockContent(b)]),
  );

  return records.map((record) => {
    const missingBlocks = record.sourceBlocks
      .filter((s) => !currentHash.has(s.blockId))
      .map((s) => s.blockId);
    const changed = record.sourceBlocks.some(
      (s) => currentHash.get(s.blockId) !== undefined &&
        currentHash.get(s.blockId) !== s.contentHash,
    );
    const stale =
      record.status !== "divergent" && (changed || missingBlocks.length > 0);
    return { record, stale, missingBlocks };
  });
}

async function loadRecord(
  store: PackageStore,
  packageId: string,
  artifactId: string,
): Promise<DerivedArtifactRecord> {
  const records = await readRecords(store, packageId);
  const record = records.find((r) => r.artifactId === artifactId);
  if (!record) throw new Error(`Artifact ${artifactId} not found.`);
  return record;
}

/** Regenerate a worksheet from current block content; resets it to fresh. */
export async function regenerateWorksheetArtifact(
  store: PackageStore,
  packageId: string,
  artifactId: string,
  input: { provider: AIProvider; packageTitle?: string; now?: () => Date },
): Promise<{ record: DerivedArtifactRecord; markdown: string }> {
  const existing = await loadRecord(store, packageId, artifactId);
  const guide = await loadStudyGuide(store, packageId);
  const byId = new Map(guide.blocks.filter((b) => b.id).map((b) => [b.id!, b]));
  const selected = existing.sourceBlocks
    .map((s) => byId.get(s.blockId))
    .filter((b): b is StudyGuideBlock => Boolean(b));
  if (selected.length === 0) {
    throw new Error("None of this worksheet's source sections still exist.");
  }

  const result = await generateWorksheet(input.provider, {
    packageTitle: input.packageTitle,
    sections: selected.map((b) => ({ title: b.title, body: b.body })),
  });

  const record = DerivedArtifactRecordSchema.parse({
    ...existing,
    title: result.title,
    sourceBlocks: selected.map((b) => ({
      blockId: b.id!,
      contentHash: hashBlockContent(b),
    })),
    status: "fresh",
    generatedAt: (input.now?.() ?? new Date()).toISOString(),
    divergedAt: undefined,
  });

  await store.putFiles(packageId, [
    {
      repo: "public",
      path: existing.path,
      content: result.markdown.endsWith("\n")
        ? result.markdown
        : result.markdown + "\n",
    },
    recordFile(record),
  ]);
  return { record, markdown: result.markdown };
}

/**
 * "Keep mine": dismiss the stale flag. The artifact is marked intentionally
 * divergent and its recorded hashes are advanced to current so it won't
 * re-flag, with the divergence timestamp recorded.
 */
export async function keepWorksheetMine(
  store: PackageStore,
  packageId: string,
  artifactId: string,
  now: () => Date = () => new Date(),
): Promise<DerivedArtifactRecord> {
  const existing = await loadRecord(store, packageId, artifactId);
  const guide = await loadStudyGuide(store, packageId);
  const currentHash = new Map(
    guide.blocks.filter((b) => b.id).map((b) => [b.id!, hashBlockContent(b)]),
  );
  const record = DerivedArtifactRecordSchema.parse({
    ...existing,
    status: "divergent",
    divergedAt: now().toISOString(),
    sourceBlocks: existing.sourceBlocks.map((s) => ({
      blockId: s.blockId,
      contentHash: currentHash.get(s.blockId) ?? s.contentHash,
    })),
  });
  await store.putFiles(packageId, [recordFile(record)]);
  return record;
}
