# M0 Spike — orz-markdown Capability/Gap Report

Date: 2026-06-11 · Package tested: `orz-markdown@1.0.0` (the version installed in this repo, identical to npm `latest` and to the GitHub `main` branch of `wangyu16/orz-markdown`). Every behavioral claim below comes from source code read directly or from a test executed against the installed package; test inputs/outputs are reproduced verbatim.

## 1. Summary

orz-markdown is close to ready for Alembic v0.1 but is not there yet. The good news: a native attribute mechanism already exists (`{{attrs[#id]}}`) and **heading block IDs work today** — they override markdown-it-anchor's slug, survive heading-text edits, and unknown `{{...}}` syntax degrades safely to literal text. The blockers are around the edges of the contract, not the core: (1) the TOC plugin emits broken links to any heading that carries a custom ID (core-rule ordering bug); (2) finer-grained anchors on figures/equations/structures are not possible because plugin renderers ignore attributes; (3) the Agent Skill exists in the GitHub repo but is **not shipped in the npm package** and contains **no ID-preservation rules**; (4) the dual-extension embed/extract mechanism lives separately in each VS Code extension, is implemented three different ways, and **none of the three formats carries a format-version marker** — directly contradicting the goal.md longevity guarantee ("Every dual-extension file carries a small format-version marker"). All four are small, well-scoped changes the owner can make in orz-markdown (or a sibling module); the gap list in §6 is the work order.

## 2. Package inventory

- **Name/version:** `orz-markdown` 1.0.0 · MIT · author Yu Wang `<yuwang@orz.how>` · repo `github.com/wangyu16/orz-markdown` (public, exists). npm `latest` = 1.0.0, same as repo `package.json`.
- **Ships:** `dist/` (compiled JS + `.d.ts`) and `themes/` (10 theme CSS files + `common.css`) only — `"files": ["dist", "themes"]`. **No skill/docs files are in the published package.**
- **Module format:** README claims "standard ESM", but `dist/` is compiled CommonJS (no `"type": "module"`). Works via `require()` and via ESM default-import interop; worth knowing for bundling.
- **Parser config:** `new MarkdownIt({ html: true, linkify: true, typographer: true })` — raw HTML passes through verbatim (XSS responsibility is on the host, stated in README).

### Exports (from source)

| Export | Source | What it does |
|---|---|---|
| `md` (default + named) | `dist/index.js` | A fully configured singleton `MarkdownIt` instance with all plugins below pre-registered. One shared instance per process. |
| `register(def)` | `dist/registry.js` | Adds a custom plugin to a **module-level global Map** keyed by alias. `def = { type: 'block'\|'inline', aliases: string[], render(args, body, env) => string }`. This is the extension point Alembic could use to add its own `{{...}}` plugins without forking. |
| `prepareSources(src)` | `dist/prepare-sources.js` | Async pre-pass: finds `{{markdown https://...}}` / `{{md-include https://...}}`, fetches each URL, and splices the fetched text into the source. Failed fetches leave the directive in place. (SSRF surface — Alembic's worker must gate this.) |
| `orz-markdown/runtime` → `getBrowserRuntimeScript()` | `dist/runtime.js` | Returns a JS string for browser injection; currently implements QR-code click-to-expand overlay (`window.OrzMarkdownRuntime.init(root)`). Tabs JS is *not* here — it lives in the VS Code extensions. |
| `orz-markdown/themes/*` | `themes/` | 10 CSS themes; each `@import`s the shared `common.css`. |

### Custom `{{name[args] body}}` dispatcher

Two custom markdown-it rules (`dist/rules/block-dispatcher.js`, `dist/rules/inline-dispatcher.js`) parse `{{name[args] body}}` (single-line or multi-line, closing `}}`; `\{{` escapes). Unregistered names fail the `hasBlock`/`hasInline` lookup and **fall through as literal text** — confirmed by test H below. Tokens render via the registry's `render(args, body, env)`; **token-level `attrs` set on `plugin_block`/`plugin_inline` tokens are never emitted** (the renderer rule in `dist/index.js:141-157` calls only `def.render(...)`).

### Plugins registered

Official (in `dist/index.js`): `markdown-it-anchor` (auto-slugs every heading id, registered first; comment says "TOC depends on its id generation"), `markdown-it-container` (`success/info/warning/danger`, `left [width]/right/center`, `spoil` → `<details>`, `tabs/tab`, `cols [ratios]/col`, plus a catch-all `::: AnyClassName` → `<div class="AnyClassName">`), `footnote`, `imsize`, `mark`, `sub`, `sup`, `ins`, `task-lists`, `@traptitech/markdown-it-katex` with `enableMhchem: true` (+ `require('katex/contrib/mhchem')`).

Custom (in `dist/plugins/`):

| Plugin (aliases) | Type | Output |
|---|---|---|
| `attrs` | inline marker | Core rule `attrs_resolve` applies `[.cls #id key="val"]` to the **immediately preceding opening block token** (`state.tokens[i-1]` when `nesting === 1`), then deletes the marker. |
| `span` (`sp`) | inline | `<span class="args">…renderInline(body)…</span>` |
| `emoji` (`em`) | inline | Unicode emoji via `node-emoji`; unknown names render back as literal `{{emoji name}}` |
| `space` | inline | fixed-width inline spacer span |
| `qrcode` (`qr`) | inline | inline SVG QR (`qrcode-svg`), click-to-expand via runtime |
| `youtube` (`yt`) | block | responsive iframe embed |
| `mermaid` (`mm`) | block | `<div class="mermaid">escaped source</div>` — rendering deferred to client-side Mermaid.js |
| `smiles` (`sm`) | block | **chemistry**: `<div class="smiles-render"><canvas data-smiles="…" width="250" height="180"></canvas></div>` — drawn client-side by SmilesDrawer |
| `toc` | block | core rule `toc_resolve` collects headings (text + `id` attr) and builds `<ul class="toc-list">` |
| `markdown` (`md`, `md-include`) | block | reads a **local file** (`fs.readFileSync`, resolved against `env.markdownBasePath` or cwd) and recursively renders it; one level deep only. (Path-traversal surface for untrusted content.) |
| `yaml` (`yml`) | block | invisible `<script type="application/yaml">` carrying raw body |
| `nyml` | block | parses NYML (custom YAML-like format, `dist/plugins/nyml_parser.js`) → invisible `<script type="application/json" id="nyml-data">` |
| `test-block` / `test-inline` | both | fixtures |

**Chemistry-specific syntax found:** `{{smiles …}}`/`{{sm …}}` for 2D structures (SmilesDrawer, client-side), and mhchem inside KaTeX (`$\ce{2H2 + O2 -> 2H2O}$` renders correctly — test K). No molfile/CDX support, no Ketcher integration, no server-side structure rendering, no alt-text generation.

## 3. Block-ID support

Tests run with Node against the installed package (`/private/tmp/orz-smoke/test*.js`, since deleted). Actual input → output:

**A. Pandoc-style `{#id}` — NOT supported, and actively harmful:**

```
INPUT : ## Acid-Base Theory {#blk-abc12345}
OUTPUT: <h2 id="acid-base-theory-%7B%23blk-abc12345%7D" tabindex="-1">Acid-Base Theory {#blk-abc12345}</h2>
```

The braces render as literal heading text and get URL-encoded into the anchor slug. Alembic must not use this syntax.

**B/C. Native `{{attrs}}` — WORKS; overrides markdown-it-anchor:**

```
INPUT : ## Acid-Base Theory {{attrs[#blk-abc12345]}}
OUTPUT: <h2 id="blk-abc12345" tabindex="-1">Acid-Base Theory </h2>

INPUT : ## Acid-Base Theory {{attrs[id="blk-abc12345"]}}
OUTPUT: <h2 id="blk-abc12345" tabindex="-1">Acid-Base Theory </h2>
```

Why it works: `markdown-it-anchor`'s core rule runs first and sets the slug id; `attrs_resolve` is pushed onto the core ruler later (registration order in `dist/index.js`) and `attrSet('id', …)` overwrites it. The ID is stable under heading-text edits (test M: `## Totally Renamed Heading {{attrs[#blk-abc12345]}}` → `<h2 id="blk-abc12345">`). Note the trailing space left in the rendered heading text (cosmetic; absent when written as `## Title{{attrs[#blk-x1]}}`).

**E/G. Works on paragraphs and image-bearing paragraphs:**

```
INPUT : Some paragraph text. {{attrs[#blk-p1 .note]}}
OUTPUT: <p id="blk-p1" class="note">Some paragraph text. </p>

INPUT : ![titration curve](curve.png) {{attrs[#blk-fig1]}}
OUTPUT: <p id="blk-fig1"><img src="curve.png" alt="titration curve"> </p>
```

(The id lands on the wrapping `<p>`, not the `<img>` — acceptable as a figure-block anchor.)

**F/J. Does NOT work on plugin blocks (chemical structures) or equations:**

```
INPUT : {{smiles C1=CC=CC=C1}}\n{{attrs[#blk-struct1]}}
OUTPUT: <div class="smiles-render">…</div>\n<p id="blk-struct1"></p>

INPUT : $$\ce{2H2 + O2 -> 2H2O}$$\n{{attrs[#blk-eq01]}}
OUTPUT: <p class="katex-block ">…KaTeX…</p>\n<p id="blk-eq01"></p>
```

The id ends up on a stray **empty paragraph** after the element, not on the element itself. Two causes: a standalone `{{attrs}}` line forms its own paragraph (so "previous token" is its own `paragraph_open`), and even if attrs were attached to a `plugin_block` token, the renderer ignores token attrs entirely. SMILES/mermaid/youtube renderers receive an `args` parameter but discard it (`render(_args, body, _env)`).

**H. Unknown syntax is safe (forward-compatible):**

```
INPUT : {{blockid abc12345}} and inline {{ref xyz}}
OUTPUT: <p>{{blockid abc12345}} and inline {{ref xyz}}</p>
```

**I. TOC breaks when headings carry custom IDs — confirmed bug:**

```
INPUT : {{toc}}\n\n## Stoichiometry {{attrs[#blk-st01]}}\n\ntext\n\n## Stoichiometry\n\ntext
OUTPUT: <ul class="toc-list">
        <li …><a href="#stoichiometry">Stoichiometry </a></li>      ← dead link: no such id exists
        <li …><a href="#stoichiometry-1">Stoichiometry</a></li>
        </ul>
        <h2 id="blk-st01" …>Stoichiometry </h2>
        <h2 id="stoichiometry-1" …>Stoichiometry</h2>
```

Root cause (source): `dist/index.js` calls `registerToc(md)` **before** `registerAttrs(md)`, so the core ruler order is `…anchor… → toc_resolve → attrs_resolve`. `toc_resolve` reads `heading_open.attrGet('id')` while it still holds the anchor slug; `attrs_resolve` then replaces the id, orphaning the TOC link.

**Verdict: partially supported.** Heading-level block IDs (Alembic's default block unit) work natively today via `{{attrs[#…]}}`, with one real bug (TOC ordering) and one cosmetic artifact (trailing space). Optional finer-grained anchors on figures-as-paragraphs work; anchors on equations, SMILES structures, and other plugin blocks do not.

## 4. Dual-extension mechanism

The embed/extract mechanism does **not** live in orz-markdown. It is implemented independently, three different ways, inside each VS Code extension. All three extensions delegate markdown rendering to a fourth marketplace extension, `yuwang26.orz-md-preview` (repo `wangyu16/orz-md-preview-vscode`), which wraps the orz-markdown parser and themes.

### `.md.html` (`wangyu16/orz-md-html-vscode`)

- **Embed:** markdown stored in `<script type="text/markdown" id="md-source">…</script>` inserted before `</body>`; literal `</script>` in the source is escaped to `<\/script>`. Implementation: `embedMarkdown()` in `src/util/mdHtmlFormat.ts`.
- **Extract:** regex `/<script\s+type="text\/markdown"\s+id="md-source">([\s\S]*?)<\/script>/`, then unescape + trim (`extractMarkdown()`, same file). The extension exposes the file through a VS Code `FileSystemProvider` (`src/MdHtmlFs.ts`): reading yields the extracted markdown, writing re-renders the whole HTML shell and re-embeds.
- **Theme state:** `<meta name="orz-md-theme-index" content="N">` (indices 0–9 documented in the extension's `SKILL/SKILL.md`).
- **Rendering/assets:** saved file inlines the selected theme CSS in `<style>`, but loads KaTeX CSS, highlight.js, Mermaid, and SmilesDrawer from **CDN URLs** (jsdelivr/cdnjs/unpkg, pinned versions) plus inline tabs/render/copy scripts; also links a sibling `custom.css`. (In-IDE preview uses bundled offline vendor assets instead — `renderForPreview` vs `renderForOutput` in `src/Renderer.ts`.) A notable extra: a copy handler converts copied rendered selections back to markdown, including `{{smiles}}`/`{{mermaid}}`/KaTeX reconstruction from `data-smiles`/`data-source`/`<annotation>`.
- **Format-version marker: none.** Only the theme-index meta tag.

### `.md.pdf` (`wangyu16/orz-md-pdf-vscode`)

- **Embed:** standard PDF embedded-file attachment named `source.md` (`mimeType: text/markdown`) written with `pdf-lib`'s `doc.attach()` — `embedMarkdownInPdf()` in `extension/src/pipeline/embed.js`.
- **Extract:** walks the PDF catalog `Names → EmbeddedFiles → Names` tree for `source.md`, reads the stream, and inflates if zlib-compressed (first byte `0x78`) — `extractMarkdownFromPdf()`, same file. Round-trip is self-tested in that module. Because this is the standard PDF attachments mechanism, any compliant PDF tool can also extract the source.
- **Rendering:** paged.js layout, Chromium print-to-PDF; document settings (page size, font preset) carried in a `{{nyml kind: document …}}` block *inside the markdown itself*. "Export as Pure PDF" produces a copy without the attachment.
- **Format-version marker: none.**

### `.slides.html` (`wangyu16/orz-slides-html-vscode`)

- **Embed:** per-slide source blocks `<script type="text/orz-slide" data-index="N">…</script>`, each followed by the rendered Reveal.js `<section>`; deck-level `<script type="text/orz-settings">` (theme/aspect/transition JSON) and `<script type="text/orz-meta">` (author/affiliation/date JSON). Slide-level metadata uses `{{nyml …}}` inside the slide source. Implementation: `parseSlidesFile`/`serializeSlidesFile`/`updateSlideSource` in `src/fileIO.ts`.
- **Extract:** regexes over the script blocks; rendered sections are matched positionally ("the first `<section>` after each source block") with nesting-aware close matching.
- **Rendering/assets:** Reveal.js 5 + KaTeX + highlight.js from CDN; theme CSS inlined into the saved file (`inlineThemeCss`).
- **Format-version marker: none.**

**Conclusions:** the mechanisms are real, simple, and documented in skill files — but (a) there is no shared, versioned implementation Alembic can depend on (the goal.md requirement says the mechanism should be "versioned and documented" at the orz-markdown level); (b) no file format carries a version marker; (c) the html/slides escaping convention (`<\/script>`) is duplicated in both orz-markdown's own `yaml`/`nyml` plugins and the extensions, so it is a de-facto standard worth codifying.

## 5. Agent Skill

- **In the npm package: absent.** `package.json` `"files": ["dist", "themes"]`; verified the installed package contains only `dist/`, `themes/`, README, LICENSE.
- **In the GitHub repo (`wangyu16/orz-markdown`): present** at `orz-markdown-skills/` — `SKILL.md` (frontmatter `name: orz-markdown`), `references/{syntax.md, themes.md, css-classes.md}`, `assets/{template.html, minimal.css}`. It covers: rendering API, `prepareSources`, the five HTML-page requirements (theme CSS, KaTeX CSS, hljs, CDN scripts, runtime scripts), all 10 themes, and the full `{{…}}`/`:::` syntax including a one-line `attrs` example (`# Title {{attrs[id="hero"]}}`).
- **In the extensions:** `orz-md-html-vscode/SKILL/SKILL.md` (file model + editing rules for `.md.html`: edit only the `md-source` block, preserve the shell, escape `</script>`, theme-index table) and `orz-slides-html-vscode/skill/SKILL.md` (four-layer file model, ownership boundaries, slide kinds). `orz-md-pdf-vscode` has docs but no skill directory at repo root.
- **ID-preservation rules: none anywhere.** No skill mentions stable block IDs, immutability, ID rules during rewrites, or anything matching goal.md's "AI editors must preserve block IDs during rewrites — enforced through the orz-markdown Agent Skill."

## 6. Gap list

Priorities: **blocking-v0.1** (needed before Alembic's first end-to-end loop) / **needed-by-M4** / **later**.

1. **Fix TOC vs custom heading IDs (ordering bug).**
   *Alembic needs:* `{{toc}}` links that point at the real heading ids, since every study-guide heading will carry `{{attrs[#blk-…]}}`.
   *Today:* `toc_resolve` core rule runs before `attrs_resolve` (registration order in `src/index.ts`), so TOC hrefs use the markdown-it-anchor slug that the attrs plugin subsequently replaces → dead links (test I).
   *Change:* in orz-markdown, call `registerAttrs(md)` before `registerToc(md)` (or make `toc_resolve` read ids after all attr mutation, e.g. push it last). One-line fix plus a regression test.
   *Priority:* **blocking-v0.1**.

2. **Ship the Agent Skill in the npm package.**
   *Alembic needs:* a "built-in Agent Skill" it can install/mount for AI editors directly from the package dependency (goal.md Requirements).
   *Today:* the skill exists only in the GitHub repo (`orz-markdown-skills/`); the published tarball excludes it.
   *Change:* add the skill directory to `"files"` (e.g. `"skills"`) and expose it via an export or documented path (`orz-markdown/skills/SKILL.md`), so tooling can locate it programmatically.
   *Priority:* **blocking-v0.1**.

3. **Add ID-preservation rules to the Agent Skill.**
   *Alembic needs:* the skill to carry the block-identity contract: IDs are immutable, never reused, never regenerated from text; editing keeps the ID; replacing a block mints a new ID; every heading-bounded section carries `{{attrs[#blk-…]}}`; copied blocks get new IDs.
   *Today:* the skill documents attrs syntax only; zero ID semantics.
   *Change:* new section in `orz-markdown-skills/SKILL.md` (and/or a `references/block-ids.md`) stating the preservation rules. Alembic will still validate ID integrity on save, but the skill is the first line of defense for AI edits.
   *Priority:* **blocking-v0.1** (cheap, pure documentation).

4. **Versioned, documented embed/extract module with a format-version marker.**
   *Alembic needs:* one stable mechanism (goal.md §7: "Every dual-extension file carries a small format-version marker… extraction method is documented and stable"), callable from its renderer/worker without depending on VS Code extensions.
   *Today:* three independent implementations inside the extensions (regex script-block for `.md.html`, pdf-lib attachment `source.md` for `.md.pdf`, per-slide script blocks for `.slides.html`); **no version marker in any format**; nothing exported from orz-markdown.
   *Change:* add (in orz-markdown or a sibling `orz-artifacts` package) `embedSource`/`extractSource` for the three formats, emitting a marker — e.g. `<script type="text/markdown" id="md-source" data-orz-format="1">` (attribute is ignored by the existing extension regexes' `\s+id=` pattern, so coordinate: make extension regexes tolerant first), `<meta name="orz-format-version">` for `.slides.html`, and a `version` key or attachment description field for `.md.pdf` — plus a short spec document. Old unmarked files are defined as "format 0" and must remain extractable forever.
   *Priority:* **blocking-v0.1** (the dual-extension artifact is part of Alembic's thesis loop; retrofitting versioning later recreates the exact failure mode the marker exists to prevent).

5. **Attribute pass-through for plugin blocks (figures/equations/structures).**
   *Alembic needs:* optional fine-grained anchors on chemical structures, equations, and similar (`goal.md` Package Model: "Finer-grained anchors are optional for figures, equations, structures…").
   *Today:* `{{attrs}}` after a `{{smiles}}`/`$$…$$` block attaches the id to a stray empty `<p>` (tests F, J); plugin renderers receive `args` but ignore it, and the plugin token renderer ignores token attrs.
   *Change:* honor `[…]` args as attrs on the wrapper element for block plugins — e.g. `{{smiles[#blk-struct1] C1=CC=CC=C1}}` → `<div class="smiles-render" id="blk-struct1">`; same for `mermaid`, `youtube`. For KaTeX display math, either extend `attrs_resolve` to handle self-closing/`nesting===0` block tokens (KaTeX block emits a `<p class="katex-block">`) or document the empty-anchor-paragraph as the supported pattern.
   *Priority:* **needed-by-M4** (heading-level IDs suffice for v0.1; sub-element IDs unlock equation/structure-level adaptation).

6. **Heading trailing-space artifact.**
   *Alembic needs:* clean heading text (it feeds TOC entries, slugs for non-ID headings, and AI-visible content).
   *Today:* `## Title {{attrs[#x]}}` leaves a trailing space inside `<h2>` and in TOC link text (tests B, I); writing `Title{{attrs…}}` avoids it.
   *Change:* trim trailing whitespace text-node before the removed marker in `attrs_resolve`.
   *Priority:* **later** (cosmetic; Alembic can also just emit the no-space form).

7. **Confirmed non-gap: explicit heading IDs are expressible in native syntax today.** `{{attrs[#blk-abc12345]}}` and `{{attrs[id="blk-abc12345"]}}` both produce `id="blk-abc12345"`, overriding markdown-it-anchor deterministically (core-rule order is structural, not accidental — but worth pinning with a test in orz-markdown so a future plugin-order refactor can't silently break it). Alembic should standardize one canonical form (suggest `{{attrs[#blk-xxxxxxxx]}}`, no preceding space) in the package contract. Pandoc-style `{#id}` must be linted against (test A shows it corrupts both heading text and slug).

8. **Confirmed non-gap: unknown `{{…}}` syntax is forward-safe.** Unregistered plugin names render as literal text (test H), so Alembic-side custom plugins added via `register()` degrade gracefully in older renderers. Caveat: `register()` writes to a process-global registry shared by the singleton `md` — fine for Alembic's one-config-per-worker model, but no per-instance isolation exists.

9. **Renderer-host security posture (Alembic-side mitigation, orz-markdown documentation).**
   *Alembic needs:* to render educator/AI-supplied markdown in its worker tier.
   *Today:* `html: true` (raw-HTML/XSS by design), `{{md path}}` reads arbitrary local files relative to `env.markdownBasePath` *or absolute paths* (`path.isAbsolute` honored), `prepareSources` fetches arbitrary URLs.
   *Change:* in orz-markdown, accept an option (or document `env` keys) to disable/scope `markdown-include` and `prepareSources`; in Alembic, always set `markdownBasePath` to the package checkout and run rendering inside the sandboxed worker. Not a blocker because Alembic controls the host environment, but it must be a deliberate configuration, and an off-switch upstream would make it enforceable.
   *Priority:* **needed-by-M4**.

10. **CDN-dependent artifacts (decision needed, not necessarily an orz-markdown change).**
    *Alembic needs:* `.md.html`/`.slides.html` files that are "useful outside Alembic" long-term.
    *Today:* the extensions' saved outputs inline theme CSS but load KaTeX CSS/JS-libs (hljs, Mermaid, SmilesDrawer, Reveal) from pinned CDN URLs; offline, math/diagrams/structures degrade (markdown source remains intact and extractable, so this is consistent with goal.md's "extraction never breaks; rendering affects appearance only").
    *Change:* Alembic's artifact generator should make the inline-vs-CDN tradeoff explicitly (file size vs offline fidelity) and stamp the renderer version (goal.md: "renderer version is stamped, not pinned") — there is currently no renderer-version stamp in any of the three outputs either; fold it into the format-version work in gap 4.
    *Priority:* **needed-by-M4**.

## 7. Sources consulted

Local (installed package, `/Users/C00278943/Documents/Alembic/node_modules/.pnpm/orz-markdown@1.0.0_@types+markdown-it@14.1.2/node_modules/orz-markdown/`):
`package.json`, `README.md`, `dist/index.js`, `dist/index.d.ts`, `dist/registry.js`, `dist/registry.d.ts`, `dist/prepare-sources.js`, `dist/prepare-sources.d.ts`, `dist/runtime.js`, `dist/rules/block-dispatcher.js`, `dist/rules/inline-dispatcher.js`, `dist/plugins/{attrs,smiles,mermaid,qrcode,span,emoji,space,youtube,toc,markdown-include,yaml,nyml,test}.js`, `themes/` listing.

Local (Alembic): `docs/goal.md` (Requirements, §4 Package Model, §7 Self-Contained Editable Artifacts).

GitHub via `gh api` (all repos public and accessible; `wangyu16/orz-markdown` exists and matches the npm package):
- `wangyu16/orz-markdown`: root listing, `package.json`, `orz-markdown-skills/SKILL.md`, `orz-markdown-skills/{references,assets}` listings, `src/` listing.
- `wangyu16/orz-md-html-vscode`: `README.md`, `SKILL/SKILL.md`, `src/MdHtmlFs.ts`, `src/Renderer.ts`, `src/util/mdHtmlFormat.ts`, directory listings.
- `wangyu16/orz-md-pdf-vscode`: `extension/README.md`, `extension/src/MdPdfDocument.js`, `extension/src/pipeline/embed.js`, directory listings.
- `wangyu16/orz-slides-html-vscode`: `skill/SKILL.md`, `src/fileIO.ts`, `src/sourceMasking.ts` (partial), `template.slides.html` (settings/meta/slide blocks), `package.json` (extensionDependencies), directory listings.
- `wangyu16` repo list (confirms `orz-md-preview-vscode` hosts the shared renderer extension `yuwang26.orz-md-preview`).

Registry: `npm view orz-markdown` (latest = 1.0.0).

Tests executed: `/private/tmp/orz-smoke/test1.js`–`test3.js` (Node, against the installed package; cases A–M reproduced in §3; scripts deleted after the spike).
