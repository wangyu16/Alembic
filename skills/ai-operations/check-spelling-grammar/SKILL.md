---
name: check-spelling-grammar
description: Correct spelling, grammar, and punctuation in an educational document without changing its meaning, wording style, structure, or formatting. Use when running the "Check spelling & grammar" AI operation on any editable page (study guide, concept map, assessment guide, private notes, course description).
---

# AI operation: `check-spelling-grammar`

The authoritative rules for the workspace AI assistant's **Check spelling &
grammar** action. Also the template every other AI-operation skill follows.

- **id:** `check-spelling-grammar` · **mode:** `edit` · **applies to:** every editable page (`*`)
- **routing:** `spelling-grammar` · **change kind:** `editor-ai-edit` · **event:** `ai.edit.requested`
- **input:** the current file's Markdown source · **output:** the corrected Markdown source (whole file)

## What it does

A **correctness-only** pass. Fix spelling, grammar, and punctuation errors and
nothing else. This is the lightest-touch edit operation: the reader should see
the same document with mistakes removed, not a reworded one (that is
`improve-language`).

## Rules

Change **only**:

- Misspellings (respecting the document's locale; keep discipline terms and
  proper nouns).
- Grammar errors — agreement, tense, articles, run-ons, fragments.
- Punctuation and obvious typos (doubled words, stray spaces).

Preserve **exactly** — never alter:

- **Meaning and content.** Do not add, remove, or reinterpret information.
- **Voice and word choice** beyond what a correction strictly requires.
- **Structure** — headings, lists, order, paragraph breaks.
- **Markdown syntax** and every **block-ID marker** (`{{attrs[#blk-…]}}`). Block
  IDs are immutable and must survive verbatim (see the renderer's block-ID
  rules).
- **Math** (`$…$`, `$$…$$`), code spans/blocks, links, image references and
  sizing (`![alt](src =WxH)`), and any `{{…}}` directives.
- **Chemistry notation** (mhchem `$\ce{…}$`, SMILES) — treat as opaque; never
  "correct" a formula.

## Output

Return the **entire file** as valid Markdown (not a diff, not a fragment, no
commentary or code fence around it). If there is nothing to correct, return the
input unchanged. The educator reviews a before/after diff and approves before
anything is saved.

## Examples

**Correct an error, keep everything else:**

```
- Input:  ## Reaction Rates {{attrs[#blk-a1]}}\n\nThe rate of a reaction depend on temperture.
- Output: ## Reaction Rates {{attrs[#blk-a1]}}\n\nThe rate of a reaction depends on temperature.
```

**Leave notation and IDs untouched:**

```
- Input:  Its combustion: $\ce{CH4 + 2O2 -> CO2 + 2H2O}$ {{attrs[#blk-b2]}}
- Output: Its combustion: $\ce{CH4 + 2O2 -> CO2 + 2H2O}$ {{attrs[#blk-b2]}}   (no change — already correct)
```

## Do not

- Do not rephrase for style, concision, or tone — that is `improve-language`.
- Do not restructure, retitle, or reorder.
- Do not touch block IDs, math, code, or chemistry.
- Do not emit anything but the corrected document.
