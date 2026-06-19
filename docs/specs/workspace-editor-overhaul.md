# Workspace Editor Overhaul (v2) — design spec

**Status:** design spec (planning). Authoritative for the post-v1.0 editor
overhaul. Captures the vision and the decisions locked in the design discussion.
**Not yet implemented** — the current editor keeps working until the new shell
reaches parity.

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
  co-editable) beside the LRMI `metadata/*.json` (M30). Shown as the "markdown
  below the title." Feeds Discover/search.

## 7. Invariants the new UI must hold

- **"Everything visible/editable"** = to the **owner, across both repos, inside
  Alembic**. The public repo never receives private content; category "Private
  materials" lives in the private repo (fail-closed).
- **No new layers** — course/chapter description lives in `metadata`.
- **Block IDs immutable** — per-section editing, AI edits, and `.md.html`
  re-import all preserve them (`validateBlockIds`).
- **Generate-then-own + drift** — slides/worksheets/`.pptx` are owned derived
  artifacts with drift tracking. `.pptx` is opaque → "kept-divergent" (no
  block-level traceability).
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
3. **Adapted from another project** — framework already present (the adaptation
   loop clones structure + lineage); the educator opens and edits directly.

The AI-prep flow routes through `packageOps` + the tiers like any other
generation; nothing bypasses the validated write path.

## 9. Phased plan

1. **Seam extensions on the current editor** — metadata/description generation;
   coherence lenses (terminology/symbols/drift); spelling/grammar check;
   permalinks ([carriers §6](carriers-and-assets.md)).
2. **Editor-module interface** — define + extract `ketcher`/`plot`, then
   `slides`/`pdf`, into orz-stack packages consumed by Alembic.
3. **New three-pane shell** — built as a parallel route; the AI-in-editor
   diff/approve flow; the 7-category rail; assembled preview + exports.
4. **Swap at parity** — retire the current editor once the new shell matches it;
   `.docx`/`.pptx` import lands on the reserved seam when worker-tier is ready.

## 10. Open questions (track, don't block)

- Per-package label for the "Course content" category (study guide / lecture
  note / handout) — reuse the `unitTerm` pattern?
- `.pptx`/`.docx` *export* fidelity expectations (round-trip vs one-way).
- Whether course-level concept map/objectives get their own editor or fold into
  the Course pane.
- Runtime plugin distribution (deferred) — revisit when there are external
  module consumers that can't rebuild.
