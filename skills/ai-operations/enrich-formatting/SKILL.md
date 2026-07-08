---
name: enrich-formatting
description: Enrich the formatting of an orz-markdown document using its native constructs (callouts, columns, tabs, TOC, highlights) where they aid readability, without changing meaning or structure. Use when running the "Enrich formatting" AI operation on study-guide content.
---

# AI operation: `enrich-formatting`

Rules for the assistant's **Enrich formatting** action on orz-markdown content.
Authoritative syntax reference: **orz-markdown-skills** (upstream), the
`{{name[args] body}}` + `::: container` grammar.

- **id:** `enrich-formatting` · **mode:** `edit` · **applies to:** `content` (study guide)
- **routing:** `editor-ai-edit` · **change kind:** `editor-ai-edit` · **event:** `ai.edit.requested`
- **input:** orz-markdown (selection or whole file) · **output:** the same content, better formatted

## What it does

Add orz-markdown formatting **where it genuinely helps a reader** — never as
decoration. The reader should get the same content, easier to scan.

## Constructs to reach for

- **Callouts:** `::: info` · `::: tip` · `::: warn` · `::: center` · `::: spoil Title`
- **Columns:** `:::: cols` wrapping `::: col` blocks.
- **Tabs:** `:::: tabs` wrapping `::: tab Label` blocks.
- **Table of contents:** `{{toc}}` (or `{{toc 2,3}}` for a level range).
- **Inline highlight / semantic span:** `{{sp[red] text}}`, `{{sp[success] ✓ Done}}`.
- Standard emphasis, lists, and tables where they clarify prose.

## Preserve exactly

- **Meaning, wording, and heading text** — do not rewrite content.
- **Block-ID markers** `{{attrs[#blk-…]}}` — immutable, verbatim.
- **Math** (`$…$`, `$$…$$`), code, links, images, and **chemistry** (`$\ce{…}$`,
  SMILES) — opaque; never reformat their internals.

## Output

Return the **whole passage** as valid orz-markdown. If nothing would genuinely
improve, return it unchanged. The educator reviews a diff before applying.

## Do not

- Do not over-format — a wall of callouts is worse than plain prose.
- Do not change meaning, headings, block IDs, math, code, or chemistry.
- Do not add commentary — return only the document.
