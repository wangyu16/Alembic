/**
 * The five parts of a v3 chapter and the text each starts from when a person
 * starts it in the workspace (no agent needed). Pure.
 *
 * The starting texts follow the shape of the course's own documents (the
 * concept map's and assessment guide's sections, a title slide, practice as
 * question/answer tabs), so the course plan, the checks and the website
 * treat a started part like any other.
 */
import { assertPathAllowedInWorkingRepo, isReservedChapterSlug, WorkingManifestV3Schema, type WorkingManifestV3 } from "@alembic/package-contract";

export function chapterSlug(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "chapter-1";
}

/** A chapter's study guide as it starts, with its FC-18 header. */
export function firstStudyGuide(chapterTitle: string, uid: string): string {
  const title = chapterTitle.replace(/\}\}/g, "} }").replace(/[\r\n]+/g, " ");
  return `{{nyml\nkind: document\nformat: 1\ntitle: ${title}\nuid: ${uid}\n}}\n\n# ${title}\n\nStart writing here.\n`;
}

/** At most this many chapters are added in one go. */
export const MAX_NEW_CHAPTERS = 30;

/**
 * Add chapters (one title each, in order) to the end of the course, as drafts. Slugs come from the titles and
 * never collide with an existing or reserved one. Blank lines are skipped; titles are kept on one line.
 */
export function addChapters(m: WorkingManifestV3, titles: string[]): { manifest: WorkingManifestV3; added: Array<{ slug: string; title: string }> } {
  const taken = new Set(m.chapters.map((c) => c.slug));
  const added: Array<{ slug: string; title: string }> = [];
  for (const raw of titles) {
    const title = raw.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!title) continue;
    if (added.length >= MAX_NEW_CHAPTERS) throw new RangeError(`at most ${MAX_NEW_CHAPTERS} chapters at a time`);
    const stem = chapterSlug(title).slice(0, 55).replace(/-+$/, "") || "chapter";
    let slug = isReservedChapterSlug(stem) ? `${stem}-chapter` : stem;
    for (let n = 2; taken.has(slug); n++) slug = `${stem}-${n}`;
    taken.add(slug);
    added.push({ slug, title });
  }
  const manifest = WorkingManifestV3Schema.parse({ ...m, chapters: [...m.chapters, ...added.map((a) => ({ ...a, mode: "draft" as const }))] });
  return { manifest, added };
}

export type ChapterPart = "concepts" | "study-guide" | "slides" | "assessment-support" | "practice";

export const CHAPTER_PARTS: ReadonlyArray<{ part: ChapterPart; label: string }> = [
  { part: "concepts", label: "Concept map" },
  { part: "study-guide", label: "Study guide" },
  { part: "slides", label: "Slides" },
  { part: "assessment-support", label: "Assessment guide" },
  { part: "practice", label: "Practice" },
];

export function chapterPartPath(part: ChapterPart, slug: string): string {
  const path = part === "slides" ? `slides/${slug}.slides.md` : `${part}/${slug}.md`;
  assertPathAllowedInWorkingRepo(path);
  return path;
}

/** One line, safe inside the document header and a heading. */
const oneLine = (t: string) => t.replace(/\}\}/g, "} }").replace(/[\r\n]+/g, " ").trim().slice(0, 200) || "Untitled chapter";

const header = (title: string, uid: string, extra = "") => `{{nyml\nkind: document\n${extra}format: 1\ntitle: ${title}\nuid: ${uid}\n}}\n`;

export function chapterPartText(part: ChapterPart, chapterTitle: string, uid: string): string {
  const t = oneLine(chapterTitle);
  switch (part) {
    case "study-guide":
      return firstStudyGuide(t, uid);
    case "concepts":
      return `${header(`Concept Map: ${t}`, uid)}
# Concept Map: ${t}

## Source and Scope

What this chapter is based on (your notes, a textbook chapter), who it is for, and what it covers.

## Chapter Summary

The chapter's story in a paragraph: what students learn, and in what order.

## Prerequisites and Later Payoff

What students need first, and where this chapter is used later.

## Section-Level Concept Map and Objectives

### 1. First section

- **Objective 1a:** what students will be able to do.

## Common Student Bottlenecks

Where students usually get stuck, and why.
`;
    case "assessment-support":
      return `${header(`Assessment Guide: ${t}`, uid)}
# Assessment Guide: ${t}

## Source and Format

Which concept map this follows, and the kinds of questions used (multiple choice, short answer, workout).

## General Assessment Priorities

- What every question set for this chapter should check.

## Objective 1a: What students will be able to do

### Target understanding

What a student who has met this objective understands.

### Question guides

- A question that checks it, and what a good answer shows.
`;
    case "slides":
      return `{{nyml\nkind: document\ncarrier: slides\nuid: ${uid}\ntitle: ${t}\nratio: 16:9\ntheme: paper\n}}

<!-- slide template=title -->
# ${t}

<!-- slide -->
## What we'll cover

- First point
- Second point
`;
    case "practice":
      return `${header(`Practice: ${t}`, uid)}
# Practice: ${t}

:::: tabs
::: tab Q 1
*multiple-choice* Write the question here.

A. First option\\
B. Second option\\
C. Third option\\
D. Fourth option
:::
::: tab Answer
**A.** Why this is the answer.
:::
::::
`;
  }
}
