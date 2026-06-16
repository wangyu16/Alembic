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

/** Parse imported markdown into study-guide blocks (IDs minted later on save). */
export function parseImportedMarkdown(markdown: string): StudyGuideBlock[] {
  return parseStudyGuide(markdown).blocks;
}
