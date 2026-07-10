# Document metadata for the orz-family self-contained files

**Status:** design (2026-07-10). Spans four repos: `orz-markdown`, `orz-mdhtml`,
`orz-slides`, `orz-paged`, then Alembic.

## 1. Problem

A `.md.html` / `.slides.html` / `.paged.html` travels alone — that is the whole
promise. Today it carries **no author, no license, no link home**. A student who
downloads a study guide holds a file that says nothing about the terms under
which they may reuse it. For an OER platform that is the reuse story failing at
the last step.

Alembic has the facts (`manifest.license`, `courseContext.instructor`, the
public repo URL). It needs a way to put them *into* the file. And this must not
be an Alembic-shaped hole: **any** host platform, and any lone author writing a
file by hand, should be able to record document metadata.

## 2. Where the helper lives

**`orz-markdown`**, in a new `doc-meta` module. All three builders already
depend on it (`orz-markdown/runtime`, `orz-markdown/preview-frame`, the parser),
and it is the only thing they share. The alternative — implementing this three
times in three copy-pasted `template.ts` files — is how the brand SVG, icon set
and chrome CSS already drifted.

`orz-markdown` already owns the pieces:

- the **`nyml` block plugin** (`src/plugins/nyml.ts`), which renders a nyml block
  to a hidden `<script type="application/json" id="nyml-data">` — already
  non-visible;
- the **nyml parser** (`src/plugins/nyml_parser.ts`, `parseNymlV2`).

`orz-paged` separately grew a **generic block scanner** (`src/doc/nyml.ts`,
`scanNymlBlocks` → `{kind, fields, start, end}`). That scanner is the reusable
piece. **Hoist it into `orz-markdown`** and have paged import it: this removes a
duplicate rather than adding one.

## 3. The metadata block

A `kind: meta` nyml block, anywhere in the source (conventionally first):

```
{{nyml
kind: meta
title: Introduction to Polymers
author: Dr. Yu Wang
description: Chain growth, step growth, and molar-mass distributions.
license: CC-BY-4.0
license-url: https://creativecommons.org/licenses/by/4.0/
source: https://github.com/wangyu16/chem320-…-oer
date: 2026-09-01
}}
```

Non-visible by construction (nyml renders to a hidden script), so it satisfies
"save metadata in the file without showing it to the reader".

### `DocMeta`

Format-agnostic, deliberately not license-only — a general host injects more:

```ts
export interface DocMeta {
  title?: string;
  author?: string;
  description?: string;
  license?: { spdx?: string; name?: string; url?: string };
  source?: string;   // canonical URL of the document / its repository
  date?: string;     // ISO date of publication
  keywords?: string[];
}
```

## 4. Two channels, one precedence rule

1. **In the source** — the `kind: meta` block above. Travels with the markdown,
   survives every round-trip, and a lone author can type it.
2. **Injected by the host** — a new `metadata?: DocMeta` build option on
   `buildMdHtml` / `buildSlidesHtml` / `buildPagedHtml`.

**The host option wins, field by field.** A host that knows the license
authoritatively (Alembic knows it from the manifest) must not be overridden by a
stale block someone pasted in. Fields the host does not set fall through to the
source block.

## 5. Emission

Each builder's `buildHtml` emits, in `<head>`:

- `<meta name="author">`, `<meta name="description">`
- `<link rel="license" href="…">` (machine-readable; the same `rel` the
  published course home page now uses)
- `<script type="application/orz-meta+json" id="orz-meta">` — the full `DocMeta`,
  for reliable read-back by a host or a tool.

**Round-trip safety is already guaranteed** and was verified in the code, not
assumed: all three `serializeDoc()` implementations clone the entire
`documentElement` and overwrite **only** the source island's `textContent`
(`orz-mdhtml/assets/app.js:576`, and the analogues in slides/paged). Injected
`<head>` tags and the metadata island are carried through verbatim — across an
in-file edit **and** across the framework self-update path.

### The builder must NOT rewrite the source

A tempting design is to have the builder write the merged metadata back into the
source island as a `kind: meta` block, so it survives even "copy as markdown".
**Do not.** Alembic commits *lean markdown* as the source of record; injecting a
license block into every `.md` recreates exactly the per-file duplication we
rejected — it drifts the moment an educator edits it, an AI rewrite drops it, or
a fork inherits the source's license into a derivative that legally requires a
different one. The manifest stays the single source of truth, and Alembic
re-injects on every generate (which it already does — it regenerates the
`.md.html` from lean markdown each time).

A lone author who wants the metadata in their markdown simply writes the block.

## 6. Two hazards found while mapping this

- **`id="nyml-data"` is a fixed id.** The existing plugin emits that same id for
  every nyml block. A `kind: meta` block must therefore be **stripped from the
  body before rendering**, or a document with both a meta block and a data block
  emits two elements with one id. Stripping is required anyway: metadata belongs
  in `<head>`, not in the rendered body.
- **Format-specific config already exists and must not be broken.** orz-slides
  has a deck config (`author:`, `footer:`, `title:`) parsed from the deck source
  (`slide-parser.ts:49`); orz-paged has `{{nyml kind: document}}` settings
  (`doc/settings.ts`). `DocMeta` is **additive** and does not replace either.
  Precedence for an overlapping field (slides `author`): host option → deck
  config → nothing. The deck config keeps driving what it drives today (the
  rendered footer); `DocMeta.author` drives the `<head>`.

## 7. Subtasks

- **M1 — `orz-markdown`.** Hoist `scanNymlBlocks` out of orz-paged; add
  `doc-meta.ts`: `DocMeta`, `extractDocMeta(markdown) → {meta, body}` (strips the
  meta block), `mergeDocMeta(source, host)`, `renderDocMetaHead(meta)`,
  `renderDocMetaIsland(meta)`. Pure, unit-tested. Minor version bump.
- **M2 — `orz-paged`.** Import the hoisted scanner (delete the local copy);
  accept `metadata?`; emit head + island.
- **M3 — `orz-mdhtml`.** Accept `metadata?`; emit head + island; strip the meta
  block from the previewed body.
- **M4 — `orz-slides`.** Same, with the deck-config precedence rule of §6.
- **M5 — Alembic.** `GenerateInput.metadata`; `generateSelfContained` passes it
  through; the hosted-editor and publish paths supply license (from
  `manifest.license` + `licenseUrl`), author (`courseContext.instructor`),
  description, and the public repo URL as `source`.
- **M6 — release.** Bump + publish `orz-markdown`, then the three tools **and
  their lockstep `-browser` subpackages** (a `-browser` at a different version is
  the trap that once shipped blank published slides). Bump Alembic's deps.
  Redeploy the Fly worker.

M6 is an **operator action**: publishing to npm and redeploying production are
the owner's calls, not the agent's.

## 8. Verification

- Unit: `extractDocMeta` strips the block; `mergeDocMeta` lets the host win;
  `renderDocMetaHead` escapes; CC0 emits no `©` anywhere (the rights-notice rule
  from `course-site.ts` applies here too if a visible notice is ever added).
- Round-trip: build a file with injected metadata, simulate an in-file save
  (`serializeDoc`), assert the `<head>` tags and `#orz-meta` island survive.
  This is the test that protects the whole design.
- Alembic: a generated study guide for CHEM 320 carries `rel="license"` pointing
  at the CC BY 4.0 deed and `author` = the instructor.
