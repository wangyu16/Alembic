import type { AIProvider } from "./provider";
import { stripBlockMarkers } from "./drafting";
import { COURSE_METADATA_SYSTEM } from "./prompts";

export interface CourseMetadataInput {
  title: string;
  discipline?: string;
  /** Outline or excerpt of the content (chapter titles, section headings, prose). */
  content?: string;
  /** "course" (whole course) or "chapter" — tunes the framing. */
  scope?: "course" | "chapter";
}

/**
 * Generate a discovery/reuse description (markdown) for a course or chapter —
 * a summary paragraph plus a "## Topics" list — to seed `metadata/course.md`
 * (the single source of truth from which `manifest.description`/LRMI/portal are
 * derived). Provider-injected; the caller persists via `setCourseDescription`.
 * Never invents content beyond what the input implies.
 */
export async function generateCourseDescription(
  provider: AIProvider,
  input: CourseMetadataInput,
): Promise<{ markdown: string }> {
  const prompt = [
    `Title: ${input.title}`,
    input.discipline ? `Discipline: ${input.discipline}` : "",
    `Scope: ${input.scope ?? "course"}`,
    input.content ? `Content outline/excerpt:\n\n${input.content}` : "(No content yet — describe at a high level from the title.)",
  ]
    .filter(Boolean)
    .join("\n");

  const { text } = await provider.generateText({
    system: COURSE_METADATA_SYSTEM,
    prompt,
    temperature: 0.4,
  });

  return { markdown: stripBlockMarkers(text).trim() };
}
