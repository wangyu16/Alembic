import type { AIProvider } from "./provider";
import { stripBlockMarkers } from "./drafting";
import { A11Y_STRUCTURE_ALT_SYSTEM } from "./prompts";

export interface StructureAltInput {
  /** The chemical structure source embedded in a .ketcher.svg carrier — KetJSON, molfile, or SMILES. */
  source: string;
  /** Optional surrounding study-guide context to make the description pedagogically relevant. */
  context?: string;
}

export interface StructureAltSuggestion {
  altText: string;
}

/** Final length guard applied after sanitization. */
const MAX_LENGTH = 200;

/**
 * Clean a model's raw alt text into plain text: drop any block markers, trim,
 * strip wrapping quotes/backticks, collapse internal whitespace to single
 * spaces, and clip to the maximum length.
 */
function sanitizeAltText(raw: string): string {
  let text = stripBlockMarkers(raw).trim();
  // Collapse all internal whitespace (including newlines) to single spaces.
  text = text.replace(/\s+/g, " ").trim();
  // Strip a single layer of wrapping quotes or backticks.
  text = stripWrappingQuotes(text);
  if (text.length > MAX_LENGTH) {
    text = text.slice(0, MAX_LENGTH).trim();
  }
  return text;
}

function stripWrappingQuotes(text: string): string {
  const pairs: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["“", "”"],
    ["‘", "’"],
  ];
  for (const [open, close] of pairs) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
      return text.slice(open.length, text.length - close.length).trim();
    }
  }
  return text;
}

/**
 * Ask the provider for concise, screen-reader-appropriate alt text describing a
 * chemical structure. The model receives the raw structure source
 * (KetJSON / molfile / SMILES) and, optionally, surrounding study-guide context
 * so the description is pedagogically relevant.
 *
 * The output names the molecule / functional groups / key features when they
 * are inferable from the source, omits any "image of" / "structure of"
 * preamble, and is sanitized and clipped before being returned to the app.
 */
export async function suggestStructureAltText(
  provider: AIProvider,
  input: StructureAltInput,
): Promise<StructureAltSuggestion> {
  const contextLine =
    input.context && input.context.trim()
      ? `Surrounding study-guide content for context:\n${input.context}`
      : "";

  const prompt = [
    `Chemical structure source (KetJSON, molfile, or SMILES):\n${input.source}`,
    contextLine,
    "Write alt text describing this chemical structure.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const { text } = await provider.generateText({
    system: A11Y_STRUCTURE_ALT_SYSTEM,
    prompt,
    temperature: 0.3,
  });

  return {
    altText: sanitizeAltText(text),
  };
}
