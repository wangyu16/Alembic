import type { AIProvider } from "./provider";
import { DRAFT_SECTION_SYSTEM, WORKSHEET_SYSTEM } from "./prompts";

/** Remove any block-ID markers a model emitted — the platform owns IDs. */
export function stripBlockMarkers(markdown: string): string {
  return markdown.replace(/\{\{attrs\[#blk-[a-z0-9]+\]\}\}/g, "");
}

function firstHeading(markdown: string, level: 1 | 2): string | null {
  const re = level === 1 ? /^#\s+(.+)$/m : /^##\s+(.+)$/m;
  const m = markdown.match(re);
  return m?.[1]?.trim() ?? null;
}

export interface DraftedSection {
  title: string;
  body: string;
}

/**
 * Draft a single new study-guide section from an instruction (and optional
 * surrounding context). Returns a title + body; the caller mints the block ID.
 * The output is sanitized of any stray block markers.
 */
export async function draftSection(
  provider: AIProvider,
  input: { instruction: string; context?: string },
): Promise<DraftedSection> {
  const prompt = [
    input.context ? `Existing study guide for context:\n${input.context}\n` : "",
    `Write a study-guide section for: ${input.instruction}`,
  ]
    .filter(Boolean)
    .join("\n");

  const { text } = await provider.generateText({
    system: DRAFT_SECTION_SYSTEM,
    prompt,
    temperature: 0.6,
  });

  const clean = stripBlockMarkers(text).trim();
  const title = firstHeading(clean, 2) ?? input.instruction.slice(0, 80);
  // Body is everything after the first heading line (or the whole text).
  const headingIdx = clean.search(/^##\s+/m);
  let body = clean;
  if (headingIdx >= 0) {
    const afterHeading = clean.slice(headingIdx).replace(/^##\s+.+(\r?\n)?/, "");
    body = afterHeading.trim();
  }
  return { title, body };
}

export interface GeneratedWorksheet {
  title: string;
  /** Full worksheet markdown (the artifact file content). */
  markdown: string;
}

/**
 * Generate a student worksheet derived from selected study-guide sections.
 * Never produces an answer key (kept private). Output sanitized of markers.
 */
export async function generateWorksheet(
  provider: AIProvider,
  input: {
    packageTitle?: string;
    sections: Array<{ title: string; body: string }>;
  },
): Promise<GeneratedWorksheet> {
  const sectionText = input.sections
    .map((s, i) => `### Section ${i + 1}: ${s.title}\n${s.body}`)
    .join("\n\n");
  const prompt = [
    input.packageTitle ? `Package: ${input.packageTitle}` : "",
    `Create a worksheet covering these study-guide sections:\n\n${sectionText}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const { text } = await provider.generateText({
    system: WORKSHEET_SYSTEM,
    prompt,
    temperature: 0.7,
  });

  const markdown = stripBlockMarkers(text).trim();
  const title =
    firstHeading(markdown, 1) ??
    (input.packageTitle ? `${input.packageTitle} — Worksheet` : "Worksheet");
  return { title, markdown };
}
