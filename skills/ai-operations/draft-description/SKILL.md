---
name: draft-description
description: Draft a course description (the canonical metadata/course.md shown on Discover) from the course title and chapter outline. Use when running the "Draft description" AI operation on the course page. Generative — proposes a fresh description the educator reviews before applying.
---

# AI operation: `draft-description`

The authoritative rules for the workspace AI assistant's **Draft description**
action on the course page.

- **id:** `draft-description` · **mode:** `generate` · **applies to:** the course page (`course`)
- **routing:** `course-metadata` · **change kind:** `draft-section` · **event:** `ai.draft.requested`
- **input:** course title + discipline + chapter outline · **output:** course description Markdown (whole document)

## What it does

Draft the **course description** — the canonical `metadata/course.md` from which
`manifest.description`, the LRMI metadata, and the public Discover entry are
derived. The educator reviews the proposal in a before/after diff and edits it
before saving; nothing is written automatically.

## Rules

- Open with a **one-paragraph overview** a colleague or student would read on
  Discover: what the course covers, its level, and its focus. This first
  paragraph is what the short public description is derived from — make it
  self-contained.
- Then fill the standard fields as headings/lists, matching the course
  description template: **Description**, **Tags / keywords**, **Objectives**,
  **Topics and concept map**. Draft **Objectives** and **Topics** from the
  chapter outline provided.
- Leave **Instructor** and **Institute** blank (the educator fills these) — do
  not invent names or affiliations.
- **Never invent content** beyond what the title, discipline, and chapter outline
  imply. If the outline is thin, keep the description high-level rather than
  fabricating specifics.
- Plain Markdown. No block-ID markers (this is metadata, not study-guide
  content). No preface, sign-off, or commentary — return only the description.

## Output

Return the **entire course description** as valid Markdown. The educator reviews
and edits before saving.

## Do not

- Do not fabricate instructor names, institutions, dates, or topics not implied
  by the input.
- Do not add block-ID markers or platform meta-commentary.
- Do not answer questions or converse — this is a one-shot draft.
