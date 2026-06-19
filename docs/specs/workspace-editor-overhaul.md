# Workspace Editor Overhaul (v2) — design spec

**Status:** design spec (planning), **conflict-audited**. Authoritative for the
post-v1.0 editor overhaul. Captures the vision, the decisions locked in the
design discussion, and the guardrails (§10) from a six-seam pre-implementation
audit. **Not yet implemented** — the current editor keeps working until the new
shell reaches parity. Build order in §9 (Phase 0 closes the audit's must-fixes
first).

Related: [goal.md](../goal.md) · [package-contract-v1.md](package-contract-v1.md) ·
[carriers-and-assets.md](carriers-and-assets.md) · [course-structure.md](course-structure.md) ·
[editor-layout.md](editor-layout.md) · [ai-architecture.md](ai-architecture.md) ·
[forward-compatibility.md](forward-compatibility.md)

---

## 1. Framing

The editor is the **replaceable client** over durable logic that already exists.
This overhaul is ~80% a new client plus a few **seam extensions** (never parallel
mechanisms): the contract layers, carrier model, block identity, two-repo
invariant, risk tiers + review queue, coherence agent, and adaptation loop all
stay as-is. The pilot editor remains functional throughout; the new shell ships
as a parallel route and swaps in only at parity.

## 2. Locked decisions

1. **Content format.** The repo source-of-truth stays **Markdown (`.md`)** —
   clean diffs, block IDs in plain text. **`.md.html`** is the self-contained
   *portable* form for "edit outside Alembic → upload back" (export → edit in
   orz-editor/VS Code → re-import → extract markdown → reconcile block IDs).
   Two views of the same content; identity/drift stay on the `.md`.
2. **Editor reuse.** Heavy editors (`slides`, `pdf`, `ketcher`, `plot`) become
   **versioned editor-module packages** keyed to carrier kind (the orz-stack
   monorepo). Alembic, orz-editor, and the VS Code extensions import the same
   modules. No runtime plugin platform (deferred). Markdown stays light/in-host.
3. **Navigation.** A **fixed 7-category rail** per chapter (structured taxonomy,
   not a generic file tree — keeps Git/developer concepts out of the UI).
4. **Shell shape.** **Three panes:** chapters | category rail | editor/preview.
   A "Course" entry at the top of the chapters pane holds course-level items.
5. **AI scope.** The in-editor assistant edits the **active file only** (diff →
   approve, a Tier-2 change). Cross-file work (terminology, symbols, drift,
   propagating renames) is the **M18 coherence agent**, surfaced as reviewed
   suggestions.
6. **Build order.** **Durable extensions first**, new shell last: seam
   extensions on the current editor → editor-module interface + extract editors
   → new shell as a parallel route → swap at parity.

## 3. The 7 educator categories ARE the 9 contract layers, regrouped

The category view is a *presentation* of the existing closed layer set — a
client concern, not a contract change.

| Category (per chapter) | Layer(s) | Repo | Notes |
| --- | --- | --- | --- |
| Concept map + learning objectives | `concepts` + `objectives` | public | public-repo, not student-facing |
| Course content (study guide / lecture note / handout) | `study-guide` | public | per-section edit; assembled preview; `.md.html`/`.md.pdf` export |
| Slide deck | `materials` | public | generate from content; `.pptx` upload = owned-divergent |
| Assessment guide (how to assess — instructions) | `assessment-support` | public | rules, not a question bank |
| Practice / example questions (worksheets) | `materials` (+ keys private) | public/private | answer-key embargo |
| Private assignments / quizzes / exams + keys | `private-instructor` | private | never staged public |
| Assets (structures, plots, figures, sims) | `materials` | public | carriers; binary upload gated to published packages |
| Course & chapter metadata / description / tags | `metadata` (+ `provenance`) | public | LRMI JSON (M30) + AI description markdown (new) |

"Course content" is the per-package label for the `study-guide` category
(study guide / lecture note / handout — educator's choice, mirrors `unitTerm`).

## 4. Two-level shell (three panes)

```
Chapters         | Category rail            | Editor / preview
─────────        | ───────────────         | ─────────────────
⊙ Course         | ▸ Concept map & obj.     |  source  |  preview
  1 Intro        | ▸ Course content (§…)    |  ───────────────
▶ 2 Acids        | ▸ Slides                 |  frequent fns (header)
  3 Bases        | ▸ Assessment guide       |  …editor…
  + Add          | ▸ Practice questions (…) |  rare fns (footer)
                 | ▸ Private materials (…)  |
                 | ▸ Assets (…)             |
```

- **Course pane (the `⊙ Course` entry):** title, AI-generated description
  markdown (review/edit/co-edit), course-level concept map + objectives,
  tags/metadata, the chapter list (`ChapterNav` add/reorder/rename/page-name),
  and the publish/site/history header (already built).
- **Chapter rail:** the 7 categories in fixed order. A single-file category
  opens the editor directly; a multi-file category (assets, practice, private)
  expands to a section/file list whose selection drives the editor pane.
- **Editor pane:** IDE-style — source left, preview right, **frequent functions
  in the header, rare ones in the footer**. Ketcher is the WYSIWYG exception.
  "Course content" edits per-section with an assembled-chapter preview;
  assembled content exports to `.md.html` / `.md.pdf` (and optionally `.docx`).

## 5. Editor-module interface (the cornerstone)

Editors are **pure UI over a carrier source**; the **host injects everything
contract-related**, so a module is host-agnostic and reusable.

```ts
interface EditorModule { kind: string; mount(el: HTMLElement, ctx: EditorContext): EditorHandle }

interface EditorContext {
  source: string                                   // embedded carrier source (KetJSON / Plotly / md / slide model)
  readOnly?: boolean
  theme: "light" | "dark"
  resolveAsset(ref: string): string                // host: portable ref → URL/permalink
  onChange(next: { source: string; rendered: string }): void   // host persists via packageOps
  requestAI?(prompt: string, selection?: unknown): Promise<AIProposal>  // host runs AI → proposal to diff/approve
}

interface EditorHandle { destroy(): void; getCarrier(): string }
```

- **Alembic's host impl** of `onChange` / `requestAI` / `resolveAsset` enforces
  `packageOps` (validated write path), the risk tiers + review queue, the
  two-repo invariant, block-ID preservation, and permalink resolution.
- **Other hosts** (orz-editor, a VS Code extension) plug the same modules into a
  filesystem host with no tiers. The module never knows the difference.
- **Compatibility** of the *files* is already guaranteed by the carrier
  `formatVersion`; the modules give UI reuse on top.
- **Extraction order:** `ketcher` + `plot` first (already isolated — prove the
  interface), then `slides` + `pdf` (heavy, highest duplication payoff).
- **Unify the interface first.** Two editor interfaces exist today — this `EditorModule`
  (push: `onChange`) and carriers §3 `CarrierEditor` (pull: `getSource()`/`renderPayload()`/
  `deriveAltText?`). Reconcile into one (this one, keeping `deriveAltText` as an optional
  capability) and update [carriers-and-assets.md §3](carriers-and-assets.md) before extracting.
- **Current editors are references, not liftable.** `ketcher-editor.tsx`/`plot-editor.tsx`
  call server actions directly, own the alt-text gate + full-screen modal chrome, and emit
  `(path, altText)` not `{source, rendered}`. They must shed all host-coupled concerns to
  become modules; only the iframe/spec core survives.

## 6. AI, checks, and metadata — all on existing seams

- **In-editor "Ask AI"** → `requestAI` → proposal → **inline diff → approve/
  reject** = a Tier-2 change through the review queue + `research-events`.
  Active file only.
- **Coherence agent (M18)** gets new lenses — terminology, symbols, narrative
  drift from the planned structure — spanning chapter/course, surfaced as
  reviewed suggestions (never auto-applied).
- **Integrity checks:** accessibility (M14) and license/attribution
  (`provenance`) exist; **spelling/grammar** is one new AI check, surfaced the
  way a11y is. Open-access/attribution check reads `provenance` + license.
- **Course/chapter metadata + description** are AI-generated into
  `metadata/course.md` + `metadata/<chapter>.md` (human-readable, editable,
  co-editable). Shown as the "markdown below the title." **`metadata/course.md`
  is the single source of truth** for the human description: `manifest.description`,
  the LRMI JSON `description` (M30), and the portal/Discover record are all
  **derived** from it on save — never hand-edited independently (today all three
  trace to `manifest.description`; the `metadata/` layer has no readers/writers
  yet). A `stale-artifact` coherence finding flags any drift. These `.md` files
  are **prose, not block-bearing** (no `{{attrs[#…]}}` IDs), so they're outside
  the block-ID/reconcile machinery. See guardrail G6.

## 7. Invariants the new UI must hold

- **"Everything visible/editable"** = to the **owner, across both repos, inside
  Alembic**. The public repo never receives private content; category "Private
  materials" lives in the private repo (fail-closed).
- **No new layers** — course/chapter description lives in `metadata`.
- **Block IDs immutable** — per-section editing and AI edits preserve them. The
  `.md.html` round-trip preserves IDs *mechanically* (the markdown source is
  embedded verbatim), but a human editing the source outside Alembic can drop or
  move a marker, and `validateBlockIds` does **not** detect a dropped ID (only
  malformed/duplicate). So re-import MUST do an **ID set-diff against the prior
  version** (re-link vs treat-as-new) — not append-with-null (the current
  `importFileAction` appends fresh blocks, which would duplicate). See guardrail
  G2.
- **Public content may reference only public files** — wire the dormant
  `assertPublicReference` into every public write path and the publish gate; the
  host's `resolveAsset` must refuse non-`materials` paths. See guardrail G1
  (security-critical).
- **Generate-then-own + drift** — slides/worksheets/`.pptx` are owned derived
  artifacts with drift tracking. `.pptx` is opaque → "kept-divergent" (no
  block-level traceability), modeled as a `divergent` artifact record with empty
  `sourceBlocks`. `.pptx`/`.docx` are **non-carrier** (never in the kind
  registry), are **binary-gated to published packages** (see
  [carriers-and-assets.md §5](carriers-and-assets.md)), and need `"pptx"` added
  to `DerivedArtifactKindSchema`. See guardrail G5.
- **Insert-via-permalink** — uses a stable portable reference that resolves to a
  GitHub permalink once published; pre-publish it resolves through the in-app
  asset route. Binary assets are gated to published packages (see
  [carriers-and-assets.md §5](carriers-and-assets.md)).

## 8. Workflow — new course creation

Three entry points:
1. **Blank** — offer either an empty 7-category framework, or an **AI-prepped
   framework**: the educator gives a course description + chapter/module list +
   brief summary, and AI scaffolds chapters (names ready) + starter metadata.
2. **From raw materials** (not created on Alembic) — same AI-prep offer; bulk
   `.docx`/`.pptx`/pdf/html/txt import is a **reserved seam** (worker-tier,
   deferred) — designed-for, not built. Leave room: import lands as
   owned-divergent artifacts + extracted markdown reconciled to block IDs.
3. **Adapted from another project** — framework already present; the educator
   opens and edits directly. **New work (the current loop is block-level only):**
   the adaptation loop must gain a **whole-package clone** — chapter structure +
   `concepts`/`objectives` + `metadata/*` with **fresh block IDs** — and must set
   `manifest.adaptedFrom` (today never written) and record lineage in
   `provenance/`. See guardrail G4.

The AI-prep flow routes through `packageOps` + the tiers like any other
generation; nothing bypasses the validated write path.

## 9. Phased plan

**Phase 0 — foundation fixes & guardrails (do first; several are latent bugs in
today's code that the overhaul would amplify).** Land on the *current* editor:
- **G1** wire `assertPublicReference` into public writes + publish gate + `resolveAsset` (security).
- **G5(export)** make `export/study-guide/route.ts` chapter-aware (real multi-chapter bug now).
- **G2** `.md.html` re-import: merge/replace by recovered block ID, set-diff vs prior (no append-with-null).
- **G3-prep** add the `editor-ai-edit` CHANGE_KIND + `ai.edit.requested` event; generalize `applyAccepted` to one carrier-agnostic, repo-aware branch through `packageOps`.
- **G6** make `metadata/course.md` the canonical description; derive `manifest.description`/LRMI/portal from it; `stale-artifact` drift check.
- **G8** enforce the `ai` entitlement at AI entry points; add the "no direct provider outside `lib/ai.ts`" guard test.

**Phase 1 — seam extensions on the current editor** — metadata/description
generation; coherence lenses (terminology/symbols/drift); spelling/grammar
(fast-tier, debounced); permalinks ([carriers §6](carriers-and-assets.md)).

**Phase 2 — editor-module interface** — unify the two editor interfaces (G7),
define the module API, extract `ketcher`/`plot` then `slides`/`pdf` into
orz-stack packages consumed by Alembic. **Side task (here):** ship **one Agent
Skill per dual-extension format** (+ a shared basics skill) so a file exported
from Alembic round-trips through other apps losslessly — modules + skills are the
two halves of cross-platform interop. See [carriers-and-assets.md §7](carriers-and-assets.md).

**Phase 3 — new three-pane shell** — parallel route; the AI-in-editor
diff/approve flow; the 7-category rail; assembled preview + exports; whole-package
adaptation clone (G4).

**Phase 4 — swap at parity** — retire the current editor once the new shell
matches it; `.docx`/`.pptx` import (G5) lands on the reserved seam when
worker-tier is ready.

## 10. Conflict register & required guardrails (from the pre-implementation audit)

Six independent read-only audits confirmed the plan is **additive and
contract-safe** (the 7 categories map onto the existing 9 closed layers; no new
layer or parallel mechanism). These guardrails are the conditions of that safety.

| ID | Guardrail | Severity | Evidence | Verdict |
| --- | --- | --- | --- | --- |
| **G1** | Activate `assertPublicReference` on every public write + publish gate; `resolveAsset` refuses non-`materials`; adversarial boundary tests | **security-critical** | dead code: [assets.ts:131](../../packages/package-contract/src/assets.ts); write path [study-guide.ts:76](../../packages/package-ops/src/study-guide.ts); publish [site-actions.ts](../../apps/web/src/app/workspace/[packageId]/site-actions.ts) | **✅ landed** — `assertPublicMarkdownReferences` enforced in `saveStudyGuide` (chokepoint for human/AI/coherence edits) + a publish "References" release gate + adversarial tests. `resolveAsset` lands with the editor-module host (Phase 2). |
| **G2** | `.md.html` re-import merges/replaces by recovered block ID + set-diffs vs prior (no append-with-null) | **must-fix** | [import-actions.ts:85](../../apps/web/src/app/workspace/[packageId]/import-actions.ts); IDs recover fine ([block-source.ts](../../packages/package-contract/src/block-source.ts)) | **✅ landed** — `reconcileImportedBlocks` (pure, +5 tests): same-ID sections replace in place (IDs preserved), new sections append, absent ones kept (non-destructive); `importFileAction` uses it instead of append-with-null. |
| **G3** | One generic `editor-ai-edit` CHANGE_KIND (Tier-2) + `ai.edit.requested` event; carrier-agnostic, repo-aware `applyAccepted` branch via `packageOps` (never raw `store.putFiles`) | must-fix | apply path study-guide-coupled [change-actions.ts:174-326](../../apps/web/src/app/workspace/[packageId]/change-actions.ts); seams additive [change-tiers.ts](../../packages/package-contract/src/change-tiers.ts), [research-events](../../packages/research-events/src/index.ts) | **✅ landed** — `editor-ai-edit` kind (Tier-2) + `ai.edit.requested` event; `applyEditorEdit` op (carrier-agnostic, repo-aware, re-asserts the path invariant; study-guide routes through `saveStudyGuide`; +5 tests); generic `applyAccepted` branch syncs public via `committed`, private in-branch. The in-editor *request* action + UI land with the shell (Phase 3). The action picks `editor-ai-edit` (Tier 2) for low-stakes layers and a Tier-3 kind for assessment/private targets. |
| **G4** | Whole-package adaptation clone: structure + concepts/objectives + metadata, fresh block IDs, set `manifest.adaptedFrom`, record lineage | must-fix (new work) | loop is block-only; `adaptedFrom` never written ([adaptation.ts:11,159](../../packages/package-ops/src/adaptation.ts)) | **✅ landed** — `forkPackage` (pure): clones public layers, **re-mints block IDs** + remaps references in concepts/objectives, sets `adaptedFrom`, regenerates `provenance/adaptations.json`, seeds a fresh private partition (source's private never travels), license-gated; +4 tests. `forkOwnPackageAction` (same-owner). Cross-owner fork from a published source (read the public repo tree) + the new-course UI land with Phase 3. |
| **G5** | `export/study-guide/route.ts` chapter-aware; `.pptx` as non-carrier + binary-gated + `"pptx"` artifact kind; reconcile assets-vs-carriers payload enums | must-fix (export) / should-fix (pptx) | [export route:24](../../apps/web/src/app/workspace/[packageId]/export/study-guide/route.ts); enum mismatch [assets.ts:34](../../packages/package-contract/src/assets.ts) vs [carriers types](../../packages/carriers/src/types.ts) | **export ✅ landed** — route takes `?chapter=<slug>`, exports the requested/active chapter (editor link passes `activeSlug`); `.pptx`/payload-enum parts stay with Phase 4 import. |
| **G6** | `metadata/course.md` canonical; derive `manifest.description`/LRMI/portal; flag drift via `stale-artifact` | should-fix (design) | single-source today [learning-resource.ts:48](../../packages/renderer/src/learning-resource.ts), [portal-actions.ts:51](../../apps/web/src/app/workspace/[packageId]/portal-actions.ts) | **durable core ✅** — `package-ops/metadata.ts`: `setCourseDescription` writes `metadata/course.md` + derives `manifest.description` (LRMI/portal read that), `deriveDescription` (pure, +8 tests). AI generation + Course-pane UI + `stale-artifact` drift check land with the shell/AI. |
| **G7** | Unify the two editor interfaces before extraction; treat current editors as references to rewrite | should-fix | carriers §3 vs overhaul §5; host-coupled [ketcher-editor.tsx](../../apps/web/src/app/workspace/[packageId]/ketcher-editor.tsx) | design |
| **G8** | Enforce `ai` entitlement at AI entry points; guard test: no direct provider outside `lib/ai.ts`; route grammar/spelling fast-tier; debounce | should-fix | `ai` declared-unenforced [entitlements.ts:18](../../apps/web/src/lib/entitlements.ts); budget in `governedProvider` only | **✅ landed** — `governedProvider` now checks `can(identity, "ai")` (the single seam every AI call funnels through); CI guard `scripts/check-ai-provider-seam.mjs` fails on any `new GeminiProvider/GatewayProvider` outside `lib/ai.ts`. Fast-tier/debounce land with the grammar/spelling feature. |

Minor/doc nits (track, don't block): `metadata/*.md` are prose (excluded from
the `study-guide/`-only reconcile predicate) — keep them ID-free; `materials`
sub-dir separation (slides/worksheets/assets) is UI/ops convention, not
contract — pin it in ops + lean on carrier kinds; `registerKind` silently
last-wins on duplicate id — add a dev warning if third-party modules register;
the forward-compat doc says additive manifest fields need a `schemaVersion` bump
while `unitTerm`/`accessibility` were added at v1 without one — reconcile the doc.

## 11. Open questions (track, don't block)

- Per-package label for the "Course content" category (study guide / lecture
  note / handout) — reuse the `unitTerm` pattern?
- `.pptx`/`.docx` *export* fidelity expectations (round-trip vs one-way).
- Whether course-level concept map/objectives get their own editor or fold into
  the Course pane.
- Runtime plugin distribution (deferred) — revisit when there are external
  module consumers that can't rebuild.
