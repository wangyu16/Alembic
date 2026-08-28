// Incoming-text normalization — carrier extraction at the door.
//
// Storage & write paths spec §4: Replace is an upsert into the slot, and
// "carriers are source-extracted at the door". When an educator picks a
// downloaded self-contained document (`.md.html` / `.slides.html` — rendered
// HTML with the editable source embedded in an island) to replace a PLAIN
// markdown/text file, storing the raw HTML would silently corrupt the
// document. This module extracts the embedded source instead, so the plain
// file receives plain text — byte-exact — never the envelope.
//
// PURE: no IO, no framework imports. String work is delegated to
// @alembic/carriers (itself pure).

import { extractSource, hasCarrier } from "@alembic/carriers";

/**
 * Typed failure for a carrier whose island is present but unreadable. The
 * message is educator-facing (never surfaces Git/carrier internals); actions
 * catch this and return it as their `error` string.
 */
export class IncomingTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncomingTextError";
  }
}

/** Plain markdown/text extensions whose files must hold SOURCE, not a carrier
 * envelope. Compound carrier extensions (`.md.html`, `.slides.html`, …) end in
 * `.html`, so a suffix test against this list can never match them. */
const PLAIN_TEXT_EXTENSIONS = [".md", ".markdown", ".txt"] as const;

/** True iff `path` names a plain markdown/text file (case-insensitive). A
 * dual-extension carrier path like `slides/x.md.html` is NOT plain text. */
function isPlainTextPath(path: string): boolean {
  const lower = path.toLowerCase();
  return PLAIN_TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Normalize educator-provided text for a target path before validation and
 * storage.
 *
 * - Target is a plain markdown/text file AND `content` is a carrier (has a
 *   source island) → return the embedded source exactly as embedded.
 * - Carrier detected but its source can't be extracted → throw
 *   {@link IncomingTextError} (educator-facing message).
 * - Anything else (plain text for a plain target, carrier content aimed at a
 *   carrier path, HTML without an island, …) → return `content` unchanged.
 */
export function normalizeIncomingText(targetPath: string, content: string): string {
  if (!isPlainTextPath(targetPath)) return content;
  if (!hasCarrier(content)) return content;
  try {
    return extractSource(content).source;
  } catch {
    throw new IncomingTextError(
      "That file looks like a saved web page, but its embedded text couldn't be read. Re-download the document and edit from that copy.",
    );
  }
}
