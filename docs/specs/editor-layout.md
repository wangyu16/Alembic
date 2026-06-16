# Editor Layout & Tool Placement

**Status:** UI information-architecture guideline (authoritative for the package
editor). Aligns with [goal.md](../goal.md) ("a teaching-material studio, not a
code editor"; the editor is a *replaceable client*) and
[carriers-and-assets.md](carriers-and-assets.md) / [local-mode.md](local-mode.md).

This exists because the editor accumulates features every milestone. Without a
placement rule, each new panel lands at the bottom of one long column. This doc
fixes **where things go** and **where future things should go.**

## 1. Zones

The editor has four zones. Keep them distinct:

1. **Action bar** (top, persistent) — package identity: chapter switcher,
   **Save** + save status, and **Publish** (the milestone action, promoted).
   Nothing periodic lives here.
2. **Canvas** (center) — the study-guide **blocks**. The one thing edited
   constantly. Authoring affordances that fire *while writing* attach here
   (Add section; Insert figure/chart; AI draft).
3. **Preview** (right, always on) — the student view, live.
4. **Tools** (collapsible groups, by frequency) — everything periodic or rarer,
   in labeled, collapsible **ToolSection**s. Default collapsed.

## 2. Tool categories (by workflow frequency)

The ordering principle is **frequency → proximity**: the more often a feature is
used, the closer it sits to the canvas and the more open it is by default; the
rarer it is, the more it is tucked into a collapsed group — or moved out of the
editor entirely.

| Category | Frequency | What lives here | Default |
| --- | --- | --- | --- |
| **Author** | constant | insert figures/charts (assets), AI draft a section | at the canvas; compact |
| **Review** | periodic (before save/publish, after AI edits) | Changes & review (Tier-1/2 queue, undo, policy), Accessibility | collapsed group |
| **Generate** | occasional | worksheets; *(future)* slides, PDF, other derived artifacts | collapsed group |
| **Publish & share** | rare / milestone | publish site, list on portal, version history & restore; *(future)* snapshots, citation/DOI, suggest-back | collapsed group |
| **App settings** | rare, not per-package | *(future)* model gateway, entitlements/billing, account | **not in the editor** — app-level settings |

## 3. Where a NEW feature goes (decision rule)

Ask, in order:

1. **Is it edited *while writing* every session?** → Author, at the canvas
   (e.g. a new asset kind's "Insert" button, concept/objective inline editors).
2. **Is it a quality/correctness check run periodically?** → Review
   (e.g. link-check, license/attribution check, a new a11y rule surface).
3. **Does it derive an artifact from the blocks?** → Generate
   (e.g. `.slides.html`, `.md.pdf` — this is where M13 lands).
4. **Does it cross a trust/sharing boundary or manage versions?** → Publish &
   share (e.g. snapshots/citation = M15; suggest-back).
5. **Is it account/cost/model configuration, not per-package?** → App settings,
   **outside** the editor (e.g. model gateway = M16, billing/entitlements = M17).

If a feature spans categories, place it by its *primary* action and link across.
Never add a seventh top-level panel — extend an existing category.

## 4. Consistency rules

- **Every tool is a `ToolSection`** — a consistent collapsible with a header
  (title, optional status badge) and content shown only when open. No more
  bespoke per-panel open/close patterns.
- **Default collapsed**, except the canvas and the Author insert affordances.
  A section may carry a **badge** to signal attention without expanding
  (e.g. Review shows the a11y status / pending-review count; Publish shows
  "not yet published").
- **Educator language**, no Git/developer terms (CLAUDE.md).
- **Entitlement-gated** features are *hidden* when the entitlement is absent
  (local/anonymous mode shows only Author + local save; Publish, portal, and AI
  surfaces don't render). See [local-mode.md](local-mode.md).
- **Tier-3 actions** (publish, register, license) always keep their explicit
  confirmation regardless of where the button sits.

## 5. Current mapping (implementation)

- **Action bar:** `ChapterBar` + Save + Download + Publish.
- **Canvas:** block list + "Add section" + **Author** group (`PlanningPanel`
  concept map & objectives — M9.6, `AssetsPanel` figures/charts, `AIDraftPanel`).
- **Review** group: `TierPanel` (changes & review) + `A11yPanel` +
  `CoherencePanel` (whole-course coherence agent — M18) + `ReconcilePanel`
  (changes made outside Alembic / "Scan for leaks" — M20).
- **Generate** group: `WorksheetPanel`, a Slides & PDF section, and
  `AssessmentsPanel` (assessments & question templates).
- **Publish & share** group: `PublishingPanel` (publish, portal, versions;
  + future snapshots/citation).
- **Preview:** always-on right pane.

When M13 ships slides/PDF, they join **Generate**; M15 snapshots/citation join
**Publish & share**; M16/M17 settings go to a future app-level Settings surface,
not the editor.
