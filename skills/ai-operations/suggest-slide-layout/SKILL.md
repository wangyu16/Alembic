---
name: suggest-slide-layout
description: Restructure a slide deck using the orz-slides comment-based layout grammar — slide markers, title bands, region splits, speaker notes — so an educator can change layout without memorizing the syntax. Use when running "Suggest slide layout" on a .slides.html source.
---

# AI operation: `suggest-slide-layout`

Rules for the assistant's **Suggest slide layout** action on orz-slides source.
Authoritative reference: **orz-slides-skills** (upstream) — the full layout
grammar, templates, regions, and floats.

- **id:** `suggest-slide-layout` · **mode:** `edit` · **applies to:** `slides`
- **routing:** `editor-ai-edit` · **change kind:** `editor-ai-edit` · **event:** `ai.edit.requested`
- **input:** slide source (selection or whole deck) · **output:** the same slides, better laid out

## What it does

Reshape slides for clarity using orz-slides' layout grammar — the educator
describes the content; the assistant applies the syntax.

## The grammar (essentials)

- **No bare `---`.** Every slide **begins with a `<!-- slide … -->` marker**,
  which is also the separator.
- An optional leading **`<!-- deck … -->`** block sets deck-wide config.
- A leading **`## Title`** becomes the slide's title band automatically.
- **Templates:** `<!-- slide template=title -->` for a title slide, etc.
- **Layout / regions:** split the content area and fill named regions —
  e.g. `<!-- slide 2col -->` then `<!-- @left -->` / `<!-- @right -->`; or a
  recursive `row` / `col` split grammar with ratios (e.g. `2col 3/2`).
- **Speaker notes:** `<!-- @notes -->`.

## Guidance

- **One idea per slide**; concise bullets over prose; a clean per-slide layout.
- Break dense slides into several; use regions to pair related content.
- Preserve meaning, math (`$…$`), code, and chemistry (`$\ce{…}$`) verbatim.

## Output

Return the **whole passage** as valid orz-slides source. Reviewed before apply.

## Do not

- Do not use bare `---` separators. Do not invent markers not in the grammar.
- Do not change the meaning of a slide's content, math, code, or chemistry.
- Do not add commentary — return only the source.
