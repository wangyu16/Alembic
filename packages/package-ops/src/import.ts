import {
  extractSource,
  getKindByExtension,
  hasCarrier,
} from "@alembic/carriers";
import { parseStudyGuide, type StudyGuideBlock } from "@alembic/package-contract";

/**
 * Import classification (M12). Lossless re-import is the carrier payoff: a file
 * Alembic (or a VS Code orz extension) wrote can be brought back and kept
 * editable, deterministically — no AI. This classifies an uploaded file:
 *
 * - asset carrier (.ketcher.svg / .plot.svg, …) → store the carrier as an asset
 * - document carrier (.md.html / .slides.html) → extract its markdown source
 * - plain markdown (.md / .markdown / .txt) → use as-is
 * - anything else (e.g. .docx / .pdf) → unsupported here (foreign import is the
 *   lossy, AI-assisted, worker-side path, designed separately)
 */
export type ImportClassification =
  | { type: "asset"; kind: string; carrier: string }
  | { type: "document"; kind: string; markdown: string }
  | { type: "markdown"; markdown: string }
  | { type: "unknown"; reason: string };

const MARKDOWN_EXT = /\.(md|markdown|txt)$/i;

export function classifyImport(filename: string, content: string): ImportClassification {
  const kind = getKindByExtension(filename);
  if (kind) {
    if (kind.role === "asset") return { type: "asset", kind: kind.id, carrier: content };
    // document carrier → recover the embedded source
    try {
      const { source } = extractSource(content);
      return { type: "document", kind: kind.id, markdown: source };
    } catch {
      return { type: "unknown", reason: `Couldn't read the embedded source from ${filename}.` };
    }
  }
  if (MARKDOWN_EXT.test(filename)) return { type: "markdown", markdown: content };
  // Last resort: an unrecognized extension that still carries an island.
  if (hasCarrier(content)) {
    try {
      const { kind: k, source } = extractSource(content);
      return { type: "document", kind: k, markdown: source };
    } catch {
      /* fall through */
    }
  }
  return {
    type: "unknown",
    reason: "Unsupported file type. Import .md.html, .slides.html, .ketcher.svg, .plot.svg, or Markdown — or paste text to restructure with AI.",
  };
}

/**
 * Parse imported markdown into study-guide blocks. Block IDs embedded in the
 * source as `{{attrs[#blk-…]}}` markers are **recovered** here (a re-imported
 * Alembic/orz file carries them); blocks authored fresh outside arrive with
 * `id: null` and are minted on save. Use `reconcileImportedBlocks` to merge
 * these into an existing chapter without losing or duplicating IDs.
 */
export function parseImportedMarkdown(markdown: string): StudyGuideBlock[] {
  return parseStudyGuide(markdown).blocks;
}

export interface ReconcileImportResult {
  blocks: StudyGuideBlock[];
  /** Existing blocks whose content was replaced by a same-ID incoming block. */
  updated: number;
  /** Incoming blocks that became new sections (new ID or no ID). */
  added: number;
}

/**
 * Reconcile imported blocks into an existing study guide **by block ID** — the
 * lossless re-import path (the "edit outside Alembic → upload back" round-trip).
 * Block IDs are immutable, so:
 * - an incoming block whose recovered ID matches an existing block **replaces**
 *   that block's content in place (ID and position preserved) — no duplication;
 * - an incoming block with a new ID is appended, **keeping** its ID;
 * - an incoming block with no ID is appended for minting on save.
 * Existing blocks absent from the import are **kept** — import is
 * non-destructive; deletions stay an explicit editor action. Pure; no IO.
 */
export function reconcileImportedBlocks(
  existing: StudyGuideBlock[],
  incoming: StudyGuideBlock[],
): ReconcileImportResult {
  const incomingById = new Map<string, StudyGuideBlock>();
  for (const b of incoming) if (b.id) incomingById.set(b.id, b);

  let updated = 0;
  const merged = existing.map((b) => {
    if (b.id && incomingById.has(b.id)) {
      updated++;
      const inc = incomingById.get(b.id)!;
      return { ...b, title: inc.title, body: inc.body };
    }
    return b;
  });

  const existingIds = new Set(existing.map((b) => b.id).filter(Boolean));
  const appended: StudyGuideBlock[] = [];
  for (const b of incoming) {
    if (b.id && existingIds.has(b.id)) continue; // already replaced in place
    appended.push(b.id ? { id: b.id, title: b.title, body: b.body } : { id: null, title: b.title, body: b.body });
  }

  return { blocks: [...merged, ...appended], updated, added: appended.length };
}
