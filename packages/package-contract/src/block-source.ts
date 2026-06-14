/**
 * Reading and writing study-guide blocks in orz-markdown source.
 *
 * Block identity lives in the plain-text source as the native attrs marker
 * `{{attrs[#blk-…]}}` on a heading (confirmed canonical form, see the M0
 * spike). This module is the contract's owner of that surface syntax: it
 * splits source into heading-bounded blocks and serializes them back, with
 * NO markdown parser dependency — pure text operations keep the contract pure.
 *
 * The default block unit is the H2-bounded section (per the contract). Content
 * before the first H2 is preserved as a preamble; sub-headings (H3+) stay
 * within their section's body.
 */

import { BLOCK_ID_PATTERN } from "./blocks";

export interface StudyGuideBlock {
  /** null for a heading that has no marker yet (new or imported content). */
  id: string | null;
  /** Heading text with the marker stripped, trimmed. */
  title: string;
  /** Markdown content after the heading line, trimmed. */
  body: string;
}

export interface ParsedStudyGuide {
  /** Content before the first H2 block (e.g. an H1 chapter title). May be "". */
  preamble: string;
  blocks: StudyGuideBlock[];
}

const H2_RE = /^##\s+(.*)$/;
const FENCE_RE = /^(```|~~~)/;
/** The canonical block-ID marker; capture the ID. */
export const BLOCK_MARKER_RE = /\{\{attrs\[#(blk-[a-z0-9]+)\]\}\}/;

/** Render the canonical marker for a block ID. */
export function formatBlockMarker(id: string): string {
  return `{{attrs[#${id}]}}`;
}

function blockFromHeading(headingText: string, bodyLines: string[]): StudyGuideBlock {
  const markerMatch = headingText.match(BLOCK_MARKER_RE);
  const id = markerMatch?.[1] && BLOCK_ID_PATTERN.test(markerMatch[1])
    ? markerMatch[1]
    : null;
  const title = headingText.replace(BLOCK_MARKER_RE, "").trim();
  const body = bodyLines.join("\n").trim();
  return { id, title, body };
}

/**
 * Parse a study-guide markdown file into its preamble and H2-bounded blocks.
 * Code fences are respected — a `## ` line inside a fence is not a heading.
 */
export function parseStudyGuide(source: string): ParsedStudyGuide {
  const lines = source.split("\n");
  const preambleLines: string[] = [];
  const blocks: StudyGuideBlock[] = [];

  let currentHeading: string | null = null;
  let currentBody: string[] = [];
  let inFence = false;
  let fence = "";

  const flush = () => {
    if (currentHeading !== null) {
      blocks.push(blockFromHeading(currentHeading, currentBody));
      currentHeading = null;
      currentBody = [];
    }
  };

  for (const line of lines) {
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fence = fenceMatch[1]!;
      } else if (line.startsWith(fence)) {
        inFence = false;
      }
    }

    const headingMatch = !inFence ? line.match(H2_RE) : null;
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1] ?? "";
    } else if (currentHeading !== null) {
      currentBody.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  flush();

  return { preamble: preambleLines.join("\n").trim(), blocks };
}

/** Serialize one block to canonical orz-markdown source (heading + body). */
export function formatBlock(block: StudyGuideBlock): string {
  const marker = block.id ? formatBlockMarker(block.id) : "";
  const heading = `## ${block.title}${marker}`;
  return block.body ? `${heading}\n\n${block.body}` : heading;
}

/**
 * Serialize a study guide back to source. Canonical and idempotent: parsing
 * the output and serializing again yields the same string.
 */
export function serializeStudyGuide(
  preamble: string,
  blocks: StudyGuideBlock[],
): string {
  const parts: string[] = [];
  if (preamble.trim()) parts.push(preamble.trim());
  for (const block of blocks) parts.push(formatBlock(block));
  return parts.join("\n\n") + "\n";
}
