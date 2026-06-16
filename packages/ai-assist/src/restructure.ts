import type { AIProvider } from "./provider";
import { stripBlockMarkers } from "./drafting";
import { RESTRUCTURE_SYSTEM } from "./prompts";

export interface RestructureInput {
  /** Raw, possibly messy source text (e.g. lecture notes, an imported document's text). */
  text: string;
  /** Optional context, e.g. the package/course title. */
  context?: string;
}

export interface RestructuredBlock {
  title: string;
  body: string;
}

/**
 * Reorganize raw text into an ordered list of study-guide sections (title +
 * markdown body). Preserves the source's meaning; never invents facts. The
 * caller mints block IDs on save — output is sanitized of any stray markers.
 */
export async function restructureToBlocks(
  provider: AIProvider,
  input: RestructureInput,
): Promise<{ blocks: RestructuredBlock[] }> {
  const prompt = [
    input.context ? `Context: ${input.context}` : "",
    `Reorganize this raw source text into study-guide sections:\n\n${input.text}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const { text } = await provider.generateText({
    system: RESTRUCTURE_SYSTEM,
    prompt,
    temperature: 0.4,
  });

  const clean = stripBlockMarkers(text).trim();
  return { blocks: splitIntoBlocks(clean, input.context) };
}

/**
 * Split model markdown output into ordered blocks on level-2 headings.
 *
 * Rules:
 * - Each line starting with "## " begins a new block; its title is the heading
 *   text and its body is the lines until the next "## " heading (trimmed).
 * - Any non-empty text before the first "## " heading becomes a leading block
 *   titled "Overview".
 * - If there are no "## " headings at all, the whole (non-empty) text is one
 *   block titled from the context (or "Imported content").
 * - Each title and body is sanitized with stripBlockMarkers and trimmed.
 */
function splitIntoBlocks(
  markdown: string,
  context?: string,
): RestructuredBlock[] {
  const lines = markdown.split(/\r?\n/);
  const headingRe = /^##\s+(.+)$/;

  const blocks: RestructuredBlock[] = [];
  let preamble: string[] = [];
  let currentTitle: string | null = null;
  let currentBody: string[] = [];
  let seenHeading = false;

  const flush = () => {
    if (currentTitle === null) return;
    blocks.push({
      title: stripBlockMarkers(currentTitle).trim(),
      body: stripBlockMarkers(currentBody.join("\n")).trim(),
    });
    currentBody = [];
  };

  for (const line of lines) {
    const m = line.match(headingRe);
    if (m) {
      flush();
      seenHeading = true;
      currentTitle = m[1] ?? "";
    } else if (seenHeading) {
      currentBody.push(line);
    } else {
      preamble.push(line);
    }
  }
  flush();

  if (!seenHeading) {
    const body = stripBlockMarkers(markdown).trim();
    if (!body) return [];
    return [
      { title: (context?.trim() || "Imported content"), body },
    ];
  }

  const preambleText = stripBlockMarkers(preamble.join("\n")).trim();
  if (preambleText) {
    blocks.unshift({ title: "Overview", body: preambleText });
  }

  return blocks;
}
