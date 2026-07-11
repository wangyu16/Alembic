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

- **M1 — `orz-markdown` ✅** (1.4.0, commit `eeafbff`). Hoisted `scanNymlBlocks`
  into `nyml-blocks.ts`; added `doc-meta.ts` (`DocMeta`, `extractDocMeta`,
  `mergeDocMeta`, `renderDocMetaHead`, `renderDocMetaIsland`,
  `parseDocMetaIsland`) + a `./doc-meta` subpath export. 15 tests, incl. the
  save round-trip that guards the whole design.
- **M2 — `orz-paged` ✅** (0.6.0). `src/doc/nyml.ts` re-exports the hoisted
  scanner (render-paged.ts unchanged); `metadata?` threaded through
  `composeInlineHtml`; meta block extracted + stripped; head + island emitted.
  132 tests pass.
- **M3 — `orz-mdhtml` ✅** (0.8.0). `metadata?` through `composeInlineMdHtml`;
  meta block stripped from the embedded/previewed source; head + island emitted.
- **M4 — `orz-slides` ✅** (0.7.0). Deck config (`title`/`author`) seeds the
  metadata, host wins (§6); `deck.config.footer` still drives the on-slide
  footer; nothing stripped. 54 tests pass.
- **M5 — Alembic ✅** (code; deploy pending M6's worker redeploy).
  `GenerateInput.metadata` threaded through the full chain:
  `generateSelfContained` (generators) → worker `GenerateFileJob` +
  `handleGenerateFile` → the `/generate` endpoint (**untrusted `metadata`
  sanitized fail-closed** in `parseMetadata`) → `worker-client` POST body. A new
  `lib/doc-metadata.ts` (`docMetaForPackage`) is the single translator from a
  package manifest to `DocMeta` (license via `licenseUrl`/`licenseLabel`, author
  = `courseContext.instructor`, `source` = public repo URL). Wired into both the
  publish path (`site-actions`, all four per-chapter files) and the editing path
  (`hosted-actions`, study guide + slides). `DocMeta` is re-exported from
  `@alembic/generators` (worker) and `@alembic/renderer` (web) so neither side
  depends on orz-markdown directly. 6 tests against the **real published**
  builders (rel=license/author/island present for md/slides/paged; bare docs
  clean). **Not covered:** the worker-DOWN fallback (`@alembic/renderer`'s own
  md/slides builders) omits metadata — a rare degraded path, documented in
  `worker-client`.
- **M6 — release ✅.** Published in dependency order: `orz-markdown@1.4.0`
  first (verified resolvable), then each tool with its lockstep `-browser`
  subpackage — `orz-mdhtml`/`-browser@0.8.0`, `orz-slides`/`-browser@0.7.0`,
  `orz-paged`/`-browser@0.6.0`. Each tool matches its `-browser` (the mismatch
  that once shipped blank slides was checked). Four sibling repos pushed;
  Alembic's deps bumped + committed with the lockfile. **Fly worker redeployed**
  (`alembic-worker` v8): `/health` now reports `orz-markdown@1.4.0`, machine
  healthy (1/1 checks). The worker's `/generate` is `WORKER_TOKEN`-gated, so the
  live emission is proven via `/health`'s version string + the generators tests
  against the identical published builders, not a direct call.

M6 was an **operator action** (npm publish + Fly redeploy), performed on the
owner's explicit request. **Remaining owner follow-ups:** rotate the npm token
that was shared in chat; a real CHEM 320 republish will then carry `rel=license`
on each chapter (spot-check one).

### Cross-repo dev note

The four repos are siblings, **not** an npm workspace: each tool carries its own
installed copy of `orz-markdown` (was 1.3.2). For local build/test during
M2–M4, the built `orz-markdown@1.4.0` `dist/` + `package.json` were synced into
each tool's `node_modules/orz-markdown`, and each tool's declared dependency was
bumped to `^1.4.0`. A real `npm install` after M6 publishes 1.4.0 reproduces
this cleanly; the synced copies are gitignored (`node_modules`).

## 8. Verification

- Unit: `extractDocMeta` strips the block; `mergeDocMeta` lets the host win;
  `renderDocMetaHead` escapes; CC0 emits no `©` anywhere (the rights-notice rule
  from `course-site.ts` applies here too if a visible notice is ever added).
- Round-trip: build a file with injected metadata, simulate an in-file save
  (`serializeDoc`), assert the `<head>` tags and `#orz-meta` island survive.
  This is the test that protects the whole design.
- Alembic: a generated study guide for CHEM 320 carries `rel="license"` pointing
  at the CC BY 4.0 deed and `author` = the instructor.
