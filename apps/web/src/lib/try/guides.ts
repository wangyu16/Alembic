/**
 * Try mode's structure and format guides — INTERIM (version "interim-1").
 * Coursewerk is to provide the real guides (FC-16 v1, design §12.5); until
 * they arrive, these short guides, written from Alembic's own formats and
 * the orz-markdown / orz-slides syntax references, stand in. Swap by
 * replacing this module; try mode records which version made a sample.
 */
export const GUIDES_VERSION = "interim-1";

export type PartId = "concepts" | "assessment" | "study-guide" | "slides" | "practice";

export interface PartSpec {
  id: PartId;
  title: string;
  /** "What this is for" — shown to the visitor beside the step. */
  purpose: string;
  path: (slug: string) => string;
  kind: "md" | "slides";
  maxTokens: number;
  guide: string;
}

const HEADER = (title: string) =>
  `Begin the file with exactly this header, then a blank line:\n{{nyml\nkind: document\nformat: 1\ntitle: ${title}\n}}`;

const ORZ = `Write orz-markdown (CommonMark plus):
- math: $...$ inline, $$ on their own lines for display; chemistry with \\ce{...} inside math.
- callouts: a line "::: info" (or success, warning, danger), the content, then a line ":::".
- columns: "::::: cols" / ":::: col" / content / "::::" / ":::: col" / content / "::::" / ":::::" (one more colon on each outer level than what is inside).
- diagrams: {{mermaid
graph LR
  A[First] --> B[Second]
}}  (the closing }} alone on its line).
- charts: {{chart
type: bar
labels: A, B, C
data: 3, 5, 2
}}  (types: bar, line, pie, doughnut; "series: Name = 1, 2, 3" for several series).
- chemical structures (only when the topic is chemistry): {{smiles CCO}}.
- tables: GitHub-style pipe tables. Captions: "**Table N.** ..." on the line before a table; "*Figure N.* ..." as a paragraph after a figure.
Never use HTML. Never use code fences for diagrams or charts. No images (there are no image files).`;

export const PARTS: PartSpec[] = [
  {
    id: "concepts", title: "Concept map", path: (s) => `concepts/${s}.md`, kind: "md", maxTokens: 1500,
    purpose: "The chapter's plan: the key ideas and how they connect. In the real product you approve it before materials are written.",
    guide: `Write a concept map for the chapter: 5 to 8 key concepts.
- "# Concept map: <topic>", one sentence on the chapter's scope.
- A {{mermaid}} graph (graph TD) with the concepts as nodes and labelled arrows for how they relate.
- "## Concepts": a numbered list; each item is the concept in bold, then one or two sentences.
- "## Prerequisites": 2-3 bullets.
Keep it under 350 words.`,
  },
  {
    id: "assessment", title: "Assessment guide", path: (s) => `assessment-support/${s}.md`, kind: "md", maxTokens: 1500,
    purpose: "What students should be able to do, and how each objective is checked.",
    guide: `Write an assessment guide: 3 or 4 learning objectives.
- "# Assessment guide: <topic>".
- A pipe table "| Objective | Evidence of learning | How it is assessed |" preceded by "**Table 1.** Objectives and assessment.".
- "## Notes for the instructor": 3 bullets (common misconceptions to watch for).
Use measurable verbs (explain, calculate, compare). Under 350 words.`,
  },
  {
    id: "study-guide", title: "Study guide", path: (s) => `study-guide/${s}.md`, kind: "md", maxTokens: 3200,
    purpose: "The main reading for students, organised by the concept map.",
    guide: `Write the study guide: about 800 to 1100 words.
- "# <topic>", a short introduction.
- 3 or 4 sections with "## " headings following the concept map.
- Use, where they fit the topic: one display equation, one table with a caption, one {{mermaid}} or {{chart}} figure with a caption, one "::: info" callout with a key idea, and one two-column comparison (cols).
- End with "## Summary" (4-5 bullets).
Clear, accurate, at the requested level.`,
  },
  {
    id: "slides", title: "Slides", path: (s) => `slides/${s}.slides.md`, kind: "slides", maxTokens: 3000,
    purpose: "A short deck to teach the chapter in class.",
    guide: `Write a slide deck of 8 to 10 slides in orz-slides format.
- Every slide starts with a line "<!-- slide -->" (alone on its line); there is no "---".
- Slide 1: "<!-- slide template=title -->", then "# <topic>", "## <subtitle>", then a byline line.
- Normal slides: start with ONE "## " title, then short bullets (at most 5, each under 12 words).
- Exactly one two-column slide: "<!-- slide 2col -->", "## Title", then "<!-- @left -->", its content, "<!-- @right -->", its content.
- One slide with a {{mermaid}} or {{chart}} figure.
- Last slide: "<!-- slide template=closing -->", "# Questions?".
- Optional speaker notes: "<!-- @notes -->" then a sentence.
Never use "#" (h1) on a normal slide.`,
  },
  {
    id: "practice", title: "Practice", path: (s) => `practice/${s}.md`, kind: "md", maxTokens: 2800,
    purpose: "Questions for students to check their understanding, with worked answers.",
    guide: `Write a practice set: 5 to 7 questions with worked answers.
- "# Practice: <topic>".
- Each question: "## Question N" then the question; mix recall, application and one calculation or analysis if the topic allows.
- After each question, its answer inside a collapsible spoiler:
::: spoiler Answer
the worked answer (steps, then the result)
:::
Under 900 words.`,
  },
];

export function systemPrompt(spec: PartSpec, title: string): string {
  return `You write one part of a short sample chapter for an open course, as a demo of Alembic (an authoring tool for educators).
${ORZ}

${HEADER(title)}

${spec.guide}

Output ONLY the file: the header and the content. No preamble, no closing remarks.`;
}
