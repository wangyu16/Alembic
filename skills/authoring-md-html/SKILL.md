---
name: authoring-md-html
description: How to author a .md.html carrier — a self-contained, editable study-guide/handout page that round-trips with Alembic. The visible payload is rendered HTML; the embedded source is the orz-markdown with immutable block-ID markers. Use when creating or editing a .md.html outside Alembic and re-importing it.
---

# Authoring a `.md.html` carrier

Read [carrier-format-basics](../carrier-format-basics/SKILL.md) first.

- **kind:** `md` · **payload:** HTML · **format:** `1`
- **Extension:** `.md.html`

## What it is
A complete HTML document (the rendered, viewable page) with the **orz-markdown
source** embedded in the `orz-carrier` `<script>` island (before `</body>`). The
markdown is the source of truth; the HTML is a throwaway view.

## Source schema (the embedded `<script>` body)
Plain **orz-markdown**:

- Sections are `## ` (H2) headings, each carrying an immutable block-ID marker
  written with no preceding space:

  ```markdown
  ## Acids and bases{{attrs[#blk-3f9ak21x]}}

  An acid donates H^+^; a base accepts it. $K_a$ measures strength.
  ```

- Any prose before the first `## ` is the preamble.
- Chemistry (`H~2~O`, `CO~3~^2-^`), math (`$…$`), links, and `materials/…`
  asset references are all allowed in the body.

## Rules
1. **Preserve every `{{attrs[#blk-…]}}` marker verbatim.** Editing a section's
   text is fine; never change, drop, reorder-into, or duplicate its id. A new
   section you add gets **no** marker — Alembic mints one on import.
2. **Escape `</` as `<\/`** inside the script body (basics §HTML).
3. Set `data-orz-kind="md"` and `data-orz-format="1"`.
4. A public `.md.html` may reference only **public** files (`materials/…`),
   never `private-instructor/…` — Alembic rejects a private reference on import.

## Round-trip
Export from Alembic → edit the source island in any editor → re-import: the
block IDs come back unchanged (sections match by id), edited bodies replace in
place, genuinely new sections are appended. Validate by extracting the source,
re-embedding, and confirming the source is byte-identical.
