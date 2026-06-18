# Carriers & Assets

**Status:** design spec (authoritative for M11–M13). Aligns with
[goal.md](../goal.md), the [package contract](package-contract-v1.md),
[course structure](course-structure.md), and the
[ai-architecture](ai-architecture.md) notes. Does not contradict the two-repo
invariant or block-identity rules in [CLAUDE.md](../../CLAUDE.md).

This spec defines the single primitive that unifies chemical structures, plots,
slide decks, printable handouts, and the `.md.html` export into one model — so
that the *next* such format is a registration, not a rewrite.

> **Prior art, borrowed not bound.** The orz-family VS Code extensions
> (`vscode-ketcher`, `orz-plot-vscode`, the `.md.html`/`.slides.html`/`.md.pdf`
> editors) already embed editable source inside renderable files. They are
> usable demos, **not optimized or fully tested**. We take the *idea* (and the
> byte-compatibility goal of the [orz-stack consolidation](../../../orz-stack/docs/ConsolidationPlan.md))
> but Alembic's contract — the markers, versioning, identity, and placement
> rules below — is the authority. Where this spec and an extension disagree,
> this spec wins, and the extensions converge to it over time.

---

## 1. The carrier primitive

> A **carrier** is a file whose visible payload is a standard renderable format
> (HTML, SVG, or PDF) **and** which embeds its own editable source plus two
> markers:
> - `kind` — which editor owns it (`ketcher`, `plot`, `md`, `slides`, `pdf`, …)
> - `format` — an integer format-version, so extraction never breaks.

> **`pdf` is reserved, not yet implemented.** The code today defines
> `CarrierPayload = "svg" | "html"` and `BUILTIN_KINDS` has no `pdf` entry
> (`packages/carriers/src/types.ts`, `registry.ts`); the `pdf` payload/kind is
> reserved for v2 and arrives with the worker tier (§4, §9). Wherever this spec
> mentions `pdf` / `.md.pdf` below, read it as planned, not shipped.

A carrier therefore satisfies three guarantees at once:

1. **Renders anywhere** — open it in a browser or `<img>` and it just shows.
2. **Round-trips** — the source can be extracted and re-edited losslessly.
3. **Self-describing & durable** — kind + format are discoverable from the file
   itself, and old format versions remain extractable *forever*.

Every file type the user named is a carrier: `.ketcher.svg`, `.plot.svg`,
`.md.html`, `.slides.html`, `.md.pdf`. New ones (`.geogebra.svg`,
`.circuit.svg`, …) are added without touching consumers.

### Format-version markers (longevity)

Every carrier records its `format` integer. Files written before markers
existed are defined as **format 0** and MUST remain extractable. Conformance
fixtures (golden input→output pairs) are **append-only**; a fixture's expected
output never changes within a major version. This is the contract that lets an
educator open a 2026 file in 2036.

---

## 2. Two roles: asset vs document

The primitive splits into two roles by **which side is the source of truth**.
This distinction drives the entire design; do not conflate them.

| Role | Source of truth | Examples | Produced by | Data flow |
| --- | --- | --- | --- | --- |
| **Asset** | the carrier file itself | `.ketcher.svg`, `.plot.svg` | a dedicated editor (Ketcher, Plotly) | authored once → **reused by reference** |
| **Document** | study-guide blocks | `.md.html`, `.slides.html`, `.md.pdf` | Alembic's renderer | **derived** → regenerated from blocks |

- An **asset** is an addressable, reusable media element. Editing it updates
  every document that references it.
- A **document** is a derived artifact (the existing M3/M4 concept): blocks are
  authoritative; the carrier is a portable, round-trippable snapshot. Documents
  reuse the derived-artifact **staleness** machinery (M3 hashing): edit a source
  block → the document is flagged stale → regenerate / merge / keep-mine.

Both roles share the carrier mechanics (embed / extract / detect-version) but
have opposite data flow. Keeping them separate is what keeps the model clean.

---

## 3. The Kind Registry (the extension point)

Adding a new carrier kind must be **one registration, no consumer changes.**
That registry is the backbone that makes future expansion cheap.

```ts
interface CarrierKind {
  id: string;             // "ketcher" | "plot" | "md" | "slides"  ("pdf" reserved, see below)
  role: "asset" | "document";
  extension: string;      // ".ketcher.svg"
  payload: "svg" | "html";  // how it renders ("pdf" reserved for v2)
  formatVersion: number;  // the current format version this kind writes
}
```

> The registry entry is **just data** — the 5 fields above (see
> `packages/carriers/src/types.ts`). The codecs are **free module functions** of
> the carriers package (`embedSource` / `extractSource` / `detectFormatVersion`),
> not methods on the kind; and **editor binding happens web-side** (the client
> maps `kind → editor component`), not in the registry. This keeps the carriers
> package pure and free of any editor/UI dependency.

Consumers iterate the registry instead of hardcoding types:

- **Editor** — the "Insert" menu lists every `role: "asset"` kind; the "Edit"
  affordance dispatches by `extension`.
- **Importer** — accepts every registered `extension` losslessly (§7).
- **Renderer / site builder** — displays each `payload` form.
- **Agent Skill** — its per-kind requirements are *generated from the registry*
  so the docs cannot drift from the code (§6).

### Ownership (respects existing invariants)

- **Codecs + registry schema → `orz-artifacts`** (the new orz-stack package:
  pure functions, Node + browser, no VS Code dependency). This is what makes an
  Alembic-authored `.ketcher.svg` byte-compatible with a VS Code-authored one.
- **Placement, identity, reference, two-repo rules → `package-contract`**
  (pure, the single owner of the package schema). The contract references kind
  `id`s; it does not implement codecs.

This keeps `package-contract` pure (CLAUDE.md rule 2) and `orz-artifacts`
reusable outside Alembic.

### Per-kind editors (the editor contract)

Each carrier kind has its **own dedicated editor**, so a kind can be added,
removed, or rewritten with no blast radius. The decoupling comes not from
"separate editors" alone but from every editor implementing the **same small
interface the host calls** — the host never knows Ketcher or Plotly internals:

```ts
interface CarrierEditor {
  kind: string;                                 // "ketcher"
  mount(el: HTMLElement, opts: { source: string; readOnly: boolean }): void;
  getSource(): string;                          // current editable source
  renderPayload(source: string): string | Uint8Array;  // the SVG/HTML the file shows
  deriveAltText?(source: string): string;       // accessibility (§5)
  unmount(): void;
}
```

The registry maps `kind → CarrierEditor`. **Add** = one editor module + one
registry line; **delete** = remove both; **modify** = edit one module. The host,
importer, renderer, and insert menu are untouched because they speak only the
contract.

Five properties make this genuinely independent (not just separate files):

1. **Editors never touch Git/files/schema.** Source in → source + rendered
   payload out. The host owns save→commit, the carrier envelope (`embed`/
   `extract`), two-repo enforcement, and insert-by-reference. This is CLAUDE.md
   rule 3 ("the editor UI is a replaceable client") applied per kind.
2. **Lazy-load each editor.** Heavy editors (Ketcher, Plotly ~1 MB) are
   dynamically imported only when opened, so a new kind never bloats the base
   app. Code-splitting is part of the isolation.
3. **Error boundary / sandbox per editor.** A buggy or third-party editor fails
   as "couldn't open this item," never crashing the workspace.
4. **Shared chrome, isolated surface.** A thin **editor host** renders common
   chrome (toolbar, save, alt-text prompt, error boundary) uniformly and embeds
   only the kind-specific editing surface — consistency *and* independence.
5. **Independent versioning.** Each kind pins its own `{codec, formatVersion,
   editor}`; the plot format can evolve without touching Ketcher.

**Scope:** dedicated editors are for **assets** (Ketcher, Plotly — interactive
editors that *produce* the file). For **documents** (`.slides.html`, `.md.pdf`)
the source of truth is blocks, so the "editor" is the existing block editor +
renderer generation — not a separate hand-editor. We do not build a WYSIWYG
slide editor; documents are regenerated from blocks.

---

## 4. Carrier file format (embed mechanisms)

One mechanism per payload type. Defined here; implemented in `orz-artifacts`.

- **SVG** (`.ketcher.svg`, `.plot.svg`): source in a single
  `<metadata id="orz-carrier" data-orz-kind="…" data-orz-format="…">` element
  wrapping a `<![CDATA[ … ]]>` island (a literal `]]>` in the source is split
  across two CDATA sections). Injected as the first child of the root `<svg>`.
  The SVG is **regenerated entirely on every save** from the source.
- **HTML** (`.md.html`, `.slides.html`): source in a
  `<script type="application/orz-carrier+json" id="orz-carrier"
  data-orz-kind="…" data-orz-format="…">` block injected before `</body>`
  (script `type` prevents execution; `</` in the source is escaped as `<\/` so
  it survives the script context and copy/paste).
- **PDF** (`.md.pdf`): source as an embedded file attachment (`source.*`) plus
  the kind/format in document metadata (XMP). PDF is the hardest round-trip and
  is scheduled last (§9).

Notes:

- The header always carries `kind` + `format` so a consumer can route a file it
  has never seen to the right codec (or refuse it cleanly).
- The orz extensions use slightly different ids/markers today
  (`orz-chart-meta`, KetJSON in `<metadata>`). We standardize on the markers
  above; `detectVersion` recognizes the legacy markers as **format 0** so
  existing files import losslessly.

### 4a. Document carriers (`.md.html`, `.slides.html`, `.md.pdf`) — M13 design

Document carriers are **derived** (source of truth = study-guide blocks). The
review of the orz VS Code extensions (`orz-slides-html-vscode`,
`orz-md-pdf-vscode`) found design issues this milestone fixes — and these fixes
are what should flow **back into the extensions**:

| Problem found in the extensions | Fix (this design) |
| --- | --- |
| `.slides.html` stores **per-slide** `text/orz-slide` blocks + separate `orz-settings`/`orz-meta` islands — no single source of truth | **One source island** (the whole deck markdown) via the standard carrier envelope; legacy per-slide files read as **format 0** (chunks concatenated, `---`-joined) |
| **No format-version marker** on slides or PDF | Every document carrier carries `data-orz-kind` + `data-orz-format` (PDF: in metadata); format 0 = legacy unmarked, always extractable |
| Slides embed **reveal.js**; depend on a preview extension to render | **Lightweight self-contained deck** — sections + dark-elegant theme + tiny inline scroll-snap/arrow-key nav; math/chem baked at build via orz-markdown; no reveal, no external runtime |
| `.md.pdf` loads **KaTeX CSS from a CDN** (needs network) | Inline KaTeX CSS — fully self-contained, offline |
| Three divergent embed mechanisms; in Alembic `.md.html` used its own `id="md-source"` | One HTML mechanism (`id="orz-carrier"`) for `md`+`slides`; one PDF-attachment mechanism for `pdf`. `.md.html` migrated; old `md-source` files read as format 0 |

Conventions:
- **Slide boundaries:** an explicit `---` line (thematic break) in the deck
  source. In Alembic the deck is derived **one slide per study-guide section**.
- **Staleness:** document carriers are M3 derived artifacts (source-block
  hashes) — edit a block → the deck/PDF reads "out of date" → regenerate.
  Regeneration is deterministic and idempotent (one deck per chapter).
- **`.md.pdf`:** generated **worker-side** (Chromium/paged.js, per goal.md
  "builds run app-side in the worker tier"), source embedded as a `source.md`
  attachment + markers. Until the worker tier lands, the interim path is
  **browser Print → Save as PDF** from the `.md.html`.

> These conventions are the spec to propagate to `orz-stack/spec/artifact-formats.md`
> and the three extensions during consolidation (Phase C).

---

## 5. Assets: storage, identity, references

### Storage — the existing public `materials` layer (no new layer)

Reusable carrier media live under the existing **`materials`** layer — **not a
new layer.** The [package contract](package-contract-v1.md) §2 fixes the nine
layers as **closed in v1** ("tools MUST NOT invent additional layers"), and
`materials` is already defined as "derived and authored teaching materials:
slides, worksheets, assignments, … diagrams, images, charts." Carrier assets are
exactly that, so they belong there and require no contract change.

- Assets live in `materials/` in the **public** repo (it is a public layer).
  Reusable media must be public to be permalink-able and renderable.
- The two-repo invariant applies unchanged: **a public document may reference
  only public files.** The reference resolver enforces this fail-closed, exactly
  like `assertPathAllowedInRepo`. Truly private figures stay in
  `private-instructor/` and simply cannot be referenced from public content.
- Suggested sub-structure (convention, not contract — the contract classifies
  only by top-level directory): `materials/structures/`, `materials/plots/`,
  `materials/figures/`.

### Trial-storage policy — binary uploads gated to published packages (decision)

Trial (sandbox) package content lives in Postgres (`sandbox_files.content`, a
`text` column). Text carriers — Ketcher structures and plots are SVG/HTML — are
small and fine to hold there, so **basic authoring works on trial packages with
no GitHub account**. But raw **binary** uploads (image / PDF / audio) base64'd
into a `text` column would bloat the database and need a second storage tier.

Decision: **binary asset upload is unavailable until the package is published to
GitHub.** Once published, binaries are committed straight to the educator's
public repo (their own infrastructure) and never sit in Postgres as base64. This
keeps the trial DB footprint bounded — no Supabase Storage / object-store tier
needed — while still letting educators start and do basic editing in a trial.

Implementation note (when binary upload ships): the upload affordance should be
disabled for sandbox packages with a one-line reminder ("Save to GitHub to add
images, PDFs, or audio"), and enabled only when `storage === "github"`.

### Identity & provenance

Each asset has a stable id and a content hash (reuse the M3 block-hashing
helper). This gives reuse tracking, provenance, and document staleness for free.

### Accessibility is part of the asset

Alt text is a **required field of an asset** (stored in the carrier header,
derivable via `deriveAltText` for kinds that can). One alt text per asset,
reused at every insertion point — a direct win for [M14](../Status.md). The M14
audit treats a referenced asset image as having alt text iff its asset record /
carrier carries non-empty alt text.

---

## 6. References & permalinks

Insertion is an ordinary markdown image **by reference**:

```markdown
![A benzene ring with alternating double bonds](<permalink>)
```

This is deliberately the *same* line that renders the structure and that cites
it. An `<img>` renders the SVG and is **inert** — the embedded source in
`<metadata>` never executes — so referencing is also the security story (§8).

### Two link forms (decision: support both)

- **Live path** — `…/<default-branch>/materials/structures/benzene.ketcher.svg`.
  Edits propagate; used while authoring.
- **Pinned permalink** — `…/<commit-sha>/materials/structures/benzene.ketcher.svg`.
  Immutable and reproducible.

**Pin at publish/snapshot.** Authoring uses live paths; at publish/snapshot time
([M15](../Status.md)) every asset reference is rewritten to a SHA-pinned
permalink. You edit freely; published and cited versions are frozen.

### Intra-package vs inter-package reuse (decision)

A permalink is a universal GitHub raw URL — it works in *any* webpage, inside or
outside Alembic. We lean on that universality instead of building cross-package
plumbing:

- **Intra-package reuse** — assets in the current package are **indexed and
  searchable**; the editor inserts them **by a click** (it knows the asset's
  path, alt text, and id, and writes the correct reference).
- **Inter-package / external reuse** — the author **pastes the permalink as a
  plain text string** into the image syntax. No special library, no resolver
  magic; the link's universality is the feature. (A shared cross-package asset
  library can be formalized later without changing this model — it would just be
  search over a wider index that still emits the same permalinks.)

### Editing a referenced asset

Alembic recognizes a `.ketcher.svg` / `.plot.svg` reference, offers **Edit**,
`extract()`s the source, opens the kind's editor, and re-saves the carrier.
Because assets are referenced, the edit propagates everywhere. Live references
update immediately; pinned references are intentionally frozen until re-pinned.

---

## 7. Import & local-first authoring

### One contract, two surfaces

The frictionless-upload goal reduces to a single principle:

> The same rules exist as **(a)** a runtime validator (Zod, in
> `package-contract`) and **(b)** the human/AI-readable **Agent Skill**.
> "Conforms to the skill" must mean *exactly* "passes the validator."

So upload carries a one-line guarantee: **if `validate(project)` passes, Alembic
incorporates it with zero friction.** The author (or their local AI agent) runs
the *same* validation locally that the importer runs server-side — no surprises.

Deliverables:

- a `validate(project)` function in `package-contract` (pure) — checks manifest,
  chapter layout, `materials/` carrier rules, naming, block-ID rules, and that every
  carrier's `kind`/`format` is registered;
- the **Agent Skill** (project-layout contract in prose), generated from the
  kind registry + schema so it can't drift — this also *finishes* the unshipped
  Agent Skill the consolidation plan flags;
- **bulk upload = lossless re-import over a whole tree.**

### Two import paths

- **Lossless carrier re-import** (deterministic, no AI): any registered carrier
  → `extract()` → register asset/document. Free once the registry exists.
- **Lossy foreign import** (AI-assisted, Tier-2): `.docx` / raw `.pdf` / images
  → AI restructures into blocks → the [M10](../Status.md) Tier-2 review queue.

The local-project upload is just "lossless re-import over the whole folder,"
with any foreign files routed to the lossy path for review.

---

## 8. Security model

- **Default rendering is `<img>`**, which does not execute SVG scripts. Embedded
  source in `<metadata>` is inert. This is why "reference, don't inline" is also
  the safe default.
- **If ever inlined** (e.g. to make an SVG interactive in-page), it MUST be
  sanitized: strip `<script>`, event-handler attributes, and external fetches.
  Inlining is opt-in and out of scope for v1.
- Carriers are generated by trusted editors, but **imported** carriers are
  untrusted: the importer validates structure and never executes embedded
  payloads — it only `extract()`s the declared source island.

---

## 9. Milestone mapping (foundation-first)

Re-sequenced around the primitive (supersedes the old per-feature M11–M13 and
removes the orz gap #5 blocker — the carrier foundation is strictly more useful):

1. **Foundation** (gates the rest): `orz-artifacts` carrier codec + **kind
   registry**; carrier reference/resolver over the existing public `materials`
   layer (two-repo enforced; no new layer), asset records (id, hash, alt text),
   and `validate()`.
2. **M11 — Ketcher asset kind** (`.ketcher.svg`): editor integration,
   intra-package search + click-insert, render/export. *First asset kind.*
3. **Plot asset kind** (`.plot.svg`, Plotly): *second kind — proves the registry
   generalizes (adding it touches only one registration).*
4. **M13 — document carriers** (`.slides.html`, then `.md.pdf`): derived
   carriers on the same codec; reuse M3 staleness.
5. **M12 — import**: lossless carrier re-import (any kind) + lossy foreign
   import (Tier-2) + bulk local-project upload.
6. **Cross-cutting**: finish the Agent Skill + ship `validate`; wire
   asset-permalink pinning into [M15](../Status.md) snapshots.

---

## 10. Relationship to existing invariants

- **Two-repo invariant** — applies unchanged: assets live in the public
  `materials` layer; public docs reference only public files; resolver fails
  closed. Never a bypass.
- **Closed layer set (contract v1 §2)** — respected: assets reuse `materials`;
  **no new layer is invented.**
- **Block identity** — unchanged for text; assets get their own id + hash.
- **Repos are source of truth** — assets and documents are repo files; app DB
  state stays a rebuildable projection.
- **AI is provider-swappable** — alt-text generation and lossy import go through
  `AIProvider` and the M10 tiers.
- **Renderer single-parser rule** — carriers render via `@alembic/renderer` /
  `<img>`; codecs parse their *own* embedded islands (JSON/JSONC/attachment),
  never markdown.

## 11. Open questions (track, don't block)

- Shared **cross-package asset library** (search over a wider index) — deferred;
  the permalink model already supports the behavior manually.
- **Plot bundle size** (Plotly ~1 MB) — decide whether to inline a runtime or
  pre-render to static SVG only (lean to static SVG for the published site).
- **PDF round-trip** fidelity — the hardest carrier; ship last, may stay
  export-only (format with attachment) before full re-edit.
- **Asset rename/move** — breaks live references; needs a reference-rewrite
  helper (mirrors chapter rename).
- **Per-kind display & editing UX (needs intensive revision)** — current
  surfaces (asset picker rows, import flow, slide/PDF generation, inline
  preview) are **demo-adequate but not designed per type**. Each carrier kind
  should eventually have a considered list/preview presentation and editing
  affordance (thumbnail, in-place edit, replace-from-file, where it appears).
  This is the UI counterpart to the kind registry — a future pass keyed off
  `CarrierKind`, governed by [editor-layout.md](editor-layout.md).
