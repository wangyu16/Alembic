import type { AIProvider } from "./provider";
import { stripBlockMarkers } from "./drafting";
import { A11Y_ALT_TEXT_SYSTEM, A11Y_LINK_TEXT_SYSTEM } from "./prompts";

export type A11yFixRule = "img-alt" | "link-text";

export interface A11yFixInput {
  rule: A11yFixRule;
  /** The surrounding study-guide text/markdown for context (may be trimmed by the caller). */
  context: string;
  /** For img-alt: the image src/filename if known. For link-text: the link's URL and current text. */
  target?: string;
}

export interface A11yFixSuggestion {
  rule: A11yFixRule;
  /** The suggested replacement: concise alt text, or descriptive link text. Plain text, no markdown, no surrounding quotes. */
  suggestion: string;
}

/** Max length per rule, applied after sanitization as a final guard. */
const MAX_LENGTH: Record<A11yFixRule, number> = {
  "img-alt": 200,
  "link-text": 80,
};

/**
 * Clean a model's raw suggestion into plain text: drop any block markers,
 * trim, strip wrapping quotes/backticks, collapse internal whitespace to single
 * spaces, and clip to the per-rule maximum length.
 */
function sanitizeSuggestion(raw: string, rule: A11yFixRule): string {
  let text = stripBlockMarkers(raw).trim();
  // Collapse all internal whitespace (including newlines) to single spaces.
  text = text.replace(/\s+/g, " ").trim();
  // Strip a single layer of wrapping quotes or backticks.
  text = stripWrappingQuotes(text);
  const max = MAX_LENGTH[rule];
  if (text.length > max) {
    text = text.slice(0, max).trim();
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
 * Ask the provider for a concrete accessibility fix for a single issue.
 *
 * Supported rules:
 * - "img-alt": concise descriptive alt text for an image (≈ ≤ 120 chars, no
 *   "image of" preamble) based on the surrounding context and filename.
 * - "link-text": short descriptive link text (2–8 words) describing the link's
 *   destination/purpose, never "click here".
 *
 * The model output is sanitized before being returned to the app.
 */
export async function suggestA11yFix(
  provider: AIProvider,
  input: A11yFixInput,
): Promise<A11yFixSuggestion> {
  const system =
    input.rule === "img-alt" ? A11Y_ALT_TEXT_SYSTEM : A11Y_LINK_TEXT_SYSTEM;

  const targetLine =
    input.target && input.target.trim()
      ? input.rule === "img-alt"
        ? `Image filename/src: ${input.target}`
        : `Link URL / current text: ${input.target}`
      : "";

  const task =
    input.rule === "img-alt"
      ? "Write alt text for the image referenced in this study-guide content."
      : "Write link text for the hyperlink referenced in this study-guide content.";

  const prompt = [
    targetLine,
    `Surrounding study-guide content for context:\n${input.context}`,
    task,
  ]
    .filter(Boolean)
    .join("\n\n");

  const { text } = await provider.generateText({
    system,
    prompt,
    temperature: 0.3,
  });

  return {
    rule: input.rule,
    suggestion: sanitizeSuggestion(text, input.rule),
  };
}
