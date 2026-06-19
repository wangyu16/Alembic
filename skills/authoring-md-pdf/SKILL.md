---
name: authoring-md-pdf
description: How to author a .md.pdf carrier — a printable handout/reading whose visible payload is a PDF and whose embedded source is the editable markdown, so it round-trips with Alembic. Use when creating a printable PDF that must remain re-editable. (Format is planned/worker-tier; follow the round-trip rule when it ships.)
---

# Authoring a `.md.pdf` carrier (planned)

Read [carrier-format-basics](../carrier-format-basics/SKILL.md) first.

- **kind:** `pdf` (document) · **payload:** PDF · **format:** `1`
- **Extension:** `.md.pdf` · **Status:** planned (worker tier; M13.3)

## What it is
A printable **PDF** (handout, worksheet, or reading) with the **markdown source**
attached, so the file stays re-editable and re-importable — the same
generate-then-own model as `.md.html`/`.slides.html`, in a print-first format.

## Source schema
The same **orz-markdown** as `.md.html` (sections with immutable
`{{attrs[#blk-…]}}` markers when derived from study-guide content). Preserve
block IDs verbatim on edit.

## Embedding
A PDF has no `<script>`/`<metadata>` island, so the source is carried via a
PDF-native mechanism (an embedded-file attachment or a document-metadata stream)
plus the `kind`/`format` markers. The exact mechanism is fixed when the worker
ships; until then, treat `.md.pdf` as **export-only** and edit the `.md`/
`.md.html` source.

## Rules
1. Preserve block IDs (`{{attrs[#blk-…]}}`) verbatim.
2. Set kind `pdf`, format `1`.
3. Public PDFs reference only public files.

## Round-trip
When implemented: extract source → edit → re-embed is byte-identical; re-import
preserves block IDs. Validate via extract → re-embed equality.
