import type { StudyGuideBlock } from "@alembic/package-contract";
import type { StudyGuideDoc } from "./study-guide";

export interface TidyResult {
  /** True iff the normalized doc differs from the input. */
  changed: boolean;
  /** A new doc (input is never mutated) with normalized whitespace. */
  doc: StudyGuideDoc;
}

/**
 * Tier-1 "tidy formatting" transform: a pure, idempotent, content-NEUTRAL
 * whitespace normalization of a study guide.
 *
 * It NEVER changes meaning, headings, block identity, or which blocks exist —
 * block `id`, `title`, order, and count are preserved exactly. Only the
 * whitespace of `preamble` and each block `body` is normalized.
 *
 * Normalizations applied to each text field:
 *  1. CRLF (`\r\n`) and lone CR (`\r`) line endings → LF (`\n`).
 *  2. Strip trailing spaces/tabs at the end of every line (`/[ \t]+$/`).
 *  3. Collapse 3+ consecutive blank lines to a single blank line.
 *  4. Trim leading/trailing blank lines of the whole field.
 *
 * Safety note re: fenced code blocks — trailing-space trimming and CRLF
 * normalization are whitespace-only and safe everywhere, including inside
 * fences. Blank-line collapsing is applied document-wide (we do NOT parse
 * fences); this is acceptable because collapsing runs of blank lines inside a
 * code fence does not change the program's meaning, and keeping the transform
 * fence-unaware keeps it simple and predictable. All non-whitespace characters
 * are preserved exactly.
 */
export function tidyStudyGuide(doc: StudyGuideDoc): TidyResult {
  const preamble = normalizeField(doc.preamble);

  const blocks: StudyGuideBlock[] = doc.blocks.map((b) => ({
    ...b,
    body: normalizeField(b.body),
  }));

  const changed =
    preamble !== doc.preamble ||
    blocks.some((b, i) => b.body !== doc.blocks[i]!.body);

  return {
    changed,
    doc: { path: doc.path, preamble, blocks },
  };
}

/** Apply the whitespace normalization rules to a single text field. */
function normalizeField(text: string): string {
  // 1. Normalize line endings to LF (handles CRLF and lone CR).
  let out = text.replace(/\r\n?/g, "\n");

  // 2. Strip trailing spaces/tabs at the end of every line.
  out = out.replace(/[ \t]+$/gm, "");

  // 3. Collapse 3+ consecutive blank lines (a run of newlines producing
  //    2+ empty lines) to a single blank line.
  out = out.replace(/\n{3,}/g, "\n\n");

  // 4. Trim leading/trailing blank lines of the whole field. A blank line is
  //    empty or whitespace-only. We only remove whole leading/trailing blank
  //    lines plus the final trailing newline; we do NOT strip indentation from
  //    the first/last content line (that would alter code-block content).
  out = out.replace(/^(?:[ \t]*\n)+/, "").replace(/\n+$/, "");

  return out;
}
