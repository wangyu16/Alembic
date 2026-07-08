---
name: suggest-page-settings
description: Tune an orz-paged document's print layout — template, page size, margins, running headers/footers, page numbers, breaks — so an educator can change page settings without memorizing the syntax. Use when running "Suggest page settings" on a .paged.html source.
---

# AI operation: `suggest-page-settings`

Rules for the assistant's **Suggest page settings** action on orz-paged source.
Authoritative reference: **orz-paged-skills** (upstream) — templates, page
config, furniture, and themes.

- **id:** `suggest-page-settings` · **mode:** `edit` · **applies to:** `paged`
- **routing:** `editor-ai-edit` · **change kind:** `editor-ai-edit` · **event:** `ai.edit.requested`
- **input:** paged source (selection or whole document) · **output:** the same content, better paginated

## What it does

Choose and tune the **print layout** — the educator describes the document; the
assistant sets the page model. A **template owns layout** (page size, furniture,
which elements show); the config tunes it.

## The page model (essentials)

- **Templates:** `article`, `report`, `exam`, each in a **title-page** or
  **title-section** variant. Pick the one that fits the document's purpose.
- **Page config:** page size (**A4** / **Letter**), margins, running
  **headers/footers**, and **page numbers**.
- **Look:** `font_preset`, `decoration_color`, `page_background` where a
  distinct treatment fits (default is ink-on-paper).
- **Breaks:** use page-break controls so a section that should start on a fresh
  page does.

## Guidance

- Match the template to the genre (a worksheet/exam vs a reading vs a report).
- Keep margins and furniture consistent; don't over-decorate a print document.
- Preserve the content, headings, math (`$…$`), code, and chemistry verbatim.

## Output

Return the **whole document** as valid orz-paged source. Reviewed before apply.

## Do not

- Do not change the document's content, headings, math, code, or chemistry.
- Do not invent config keys not in the page model.
- Do not add commentary — return only the source.
