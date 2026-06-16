# Alembic Development Roadmap

This roadmap breaks the full product vision ([goal.md](goal.md)) into sequential phases. Each phase delivers a usable increment, and each later phase builds on contracts established earlier — most importantly the **package contract** (schema, block identity, two-repo split, operation API), which is deliberately frozen early so that editors, AI layers, and the portal can evolve independently around it.

Guiding rule for sequencing: **the package contract and publishing thesis come first; intelligence and ecosystem features come after.** A wrong package contract poisons every later phase; a missing AI feature is just a gap.

---

## Phase 0 — Foundations & Contracts (pre-release groundwork)

**Goal: freeze the things that must not churn before writing feature code.**

- Package contract v1 (written spec, versioned): file/folder layout, manifest schema linking public + private repos, block-identity rules (orz-markdown native IDs), provenance/metadata/license record formats, schema-version field and migration policy.
- Two-repo storage model defined as a path-level invariant spec (what may never be staged in the public repo).
- orz-markdown integration spike: confirm block-ID syntax, ID-preservation Agent Skill rules, dual-extension embed/extract versioned format. Feed required changes back into orz-markdown itself.
- Monorepo scaffolding (TypeScript throughout): apps (web, worker), packages (package-contract, renderer, github-bridge), CI, lint/test conventions.
- Hosting skeleton: Vercel project, Supabase project, one minimal container worker behind a job queue (vendor decision can stay loose; the queue interface is the contract).

**Exit criteria:** a package can be created, validated, and round-tripped (parse → edit → serialize → re-validate) entirely in code, with block IDs surviving, before any UI exists.

---

## Phase 1 — Initial Release: the end-to-end loop (v0.1)

**Goal: one coherent workflow, end to end, honestly labeled.** This is the validation target from goal.md: *"if this loop feels magical to one non-developer chemist, the product thesis holds."*

Scope (see [InitialReleasePlan.md](InitialReleasePlan.md) for the detailed plan):

1. GitHub OAuth sign-in (identity only) + no-GitHub trial sandbox.
2. Create a small chemistry module; outline concepts + study guide as a structured list (data model includes `concepts`; visual concept-map editor deferred).
3. Edit study-guide blocks in the browser with live orz-markdown preview.
4. AI drafting via direct model calls: draft sections, generate one derived artifact type (worksheet or slides) with generate-then-own + stale flagging.
5. One dual-extension artifact export (`.md.html`).
6. Public-safe student-facing page preview.
7. Two-repo GitHub flow via GitHub App: create paired repos from templates, save/commit, app-side build in the worker tier, publish to GitHub Pages. Path-level public/private invariant enforced from the first commit.
8. Minimal generated portal index page, registered only after release-gate checks.
9. Basic research event logging to Supabase.
10. Educator-facing verbs only: save, preview, publish, restore.

Deliberately included (the thesis): GitHub publishing, dual-extension artifact, two-repo invariant, research events.
Deliberately deferred: agent harness, Ketcher, question templates, adaptation, searchable portal, snapshots/DOI, LMS export, batch AI review queues.

**Exit criteria:** one real chemistry module authored by a non-developer, published to a live GitHub Pages site, with private notes provably absent from the public repo.

---

## Phase 2 — Authoring Depth & Chemistry-First (v0.2–v0.3)

**Goal: make the workspace genuinely good for a chemist, not just functional.**

- **Multi-chapter courses** — a course as one site with an index and many chapters (each: study-guide page + concept map + objectives + slides + question templates). The target model and additive evolution path from v0.1's single-chapter case are specified in [specs/course-structure.md](specs/course-structure.md).
- **Carriers & assets** — one primitive: a self-contained dual-extension file (renderable payload + embedded editable source + `kind`/`format` markers) with a **kind registry** + per-kind editors as the single extension point. Unifies chemical structures (`.ketcher.svg`), plots/charts (`.plot.svg`), and the document formats (`.md.html`/`.slides.html`/`.md.pdf`). Reusable media are standalone files in the public `materials` layer, inserted by permalink (intra-package = searchable click-insert; inter-package = paste the universal link). Specified in [specs/carriers-and-assets.md](specs/carriers-and-assets.md); codecs live in `orz-artifacts` (orz-stack Phase B). **This foundation gates structures/plots/slides/PDF/import.**
- Ketcher integration for chemical-structure editing → `.ketcher.svg` assets; plots/charts → `.plot.svg` assets (a second kind by registration alone).
- Remaining document carriers: `.slides.html`, `.md.pdf` (worker-side PDF generation), generated from blocks; derived-artifact lifecycle completed (regenerate / AI-assisted merge / keep-mine on stale flags).
- Import & local-first authoring: lossless re-import of any carrier; lossy foreign import (Word/PDF/PowerPoint/images → AI restructuring, Tier-2 queue); **bulk upload of a complete locally-authored project** validated by one shared contract (validator == Agent Skill).
- Risk-tiered approval system implemented as policy (Tier 1 auto-apply + changelog/undo, Tier 2 batch queue, Tier 3 itemized — Tier 3 gates existed in v0.1 for publish; this phase generalizes the machinery).
- AI accessibility checks (WCAG 2.1 AA), alt text for structures/plots from their carrier source.
- Snapshots (named immutable versions via tags): list, restore, compare; snapshots pin asset permalinks to fixed commits.

**Exit criteria:** an educator can go from a messy Word/PDF dump — or a complete local project — to a polished published chemistry package (with reusable structures and plots) without leaving the app.

---

## Phase 3 — Agent Harness & Repository Intelligence (v0.4)

**Goal: move multi-file, repository-aware work from hand-rolled code to sandboxed agent workers.**

> **Execution & model-access design:** the mixed approach — direct single-call AI for the common local edits vs. a bounded, app-orchestrated agent for whole-course coherence (Alembic's differentiator) — plus a model gateway (Portkey/OpenRouter) with task→model routing, is analyzed in [specs/ai-architecture.md](specs/ai-architecture.md). Teaching docs need coherence + educator review, not software-style verification gates.

- Container worker tier matured: job queue, isolated sandboxes, ephemeral repo checkouts, patch + explanation output, platform validation gates before any commit.
- Claude Code SDK (or equivalent; harness-swappable boundary) driving: package reorganization, study-guide + derived-artifact co-editing, metadata/provenance updates, link/schema checks, readable commits, diff explanations.
- External-edit reconciliation completed: detect foreign commits, rebuild projections, re-validate invariants, quarantine on violation, concurrent-edit safety (no force-push, reconcile-first saves).
- Leakage remediation procedure (history rewrite + forced re-publication + incident provenance note) implemented and documented.

**Exit criteria:** an advanced user can edit the repo in VS Code, and Alembic absorbs it cleanly; an educator can request a package-wide restructuring and review it as a teaching-material change.

---

## Phase 4 — Assessment & Question Templates (v0.5)

**Goal: the assessment-support layer, with hard public/private boundaries.**

- Assessment blueprints and question-template rules (concept/objective alignment, context, difficulty, representations, parameters, misconception targets).
- AI question generation from templates; generated items respect instructor-defined design.
- Private-repo workflows: answer keys, embargoed assessments (auto-release dates, owner-only early lift), answer-key leakage checks in release gates.
- One-way LMS export (QTI / Common Cartridge) so question sets reach Canvas/Moodle.

**Exit criteria:** an instructor runs a quiz cycle — template → generated questions → export to LMS — with keys never touching the public repo.

---

## Phase 5 — Adaptation Ecosystem (v0.6–v0.7)

**Goal: make reuse a two-way street; this is where "open ecosystem" becomes real.**

- Adapt/fork at every scale: block, artifact, module, whole course, multi-package remix — with new IDs + `adapted-from` lineage, attribution and license-compatibility preservation.
- Pull updates (upstream → adapter): change notifications in teaching terms, one-click take-update, AI-assisted merge, recorded divergence.
- Suggest back (adapter → author): platform-mediated block-level suggestions through normal validation gates; optional materialization as GitHub PRs.
- Citation: stable snapshot URLs, opt-in DOI minting (Zenodo), auto-generated `CITATION.cff`.

**Exit criteria:** two educators exchange improvements on a shared package lineage without either touching Git concepts.

---

## Phase 6 — Portal & Discovery (v0.8)

**Goal: from a generated index page to a real discovery hub.** Deferred until multiple real packages exist to discover.

- Searchable portal: topic, level, discipline, license, accessibility status, artifact type, teaching time.
- Package previews, links to Pages sites and source repos, adaptation entry points, quality/status indicators.
- LRMI/schema.org `LearningResource` markup embedded in published pages; portal consumes the same standard metadata (no proprietary record format).
- Governance scaffolding: registration limited to study participants during the grant; reporting/takedown path designed.

**Exit criteria:** a stranger finds a package via the portal (or Google), previews it, and starts an adaptation.

---

## Phase 7 — Research Operations & Study Readiness (v0.9)

**Goal: the platform as a credible IUSE research instrument.**

- Full research event taxonomy (authoring steps, AI accept/reject/edit with Tier-1 logged separately, reuse events, completeness, workload indicators).
- De-identified CSV/JSON export for the evaluator team; data-governance boundaries (research logs separate from both repos).
- Centrally managed AI credits: project-funded quotas, consistent model access, rate limits, usage visibility.
- Admin/operations module: component status, error monitoring, demo content management, consent/status flags.
- Institution/workshop-managed mode: org-installed GitHub App, bot commits authored as the educator.

**Exit criteria:** the study can onboard a participant cohort with uniform AI access and produce clean exportable research data.

---

## Phase 8 — Hardening & Sustainability (v1.0 and beyond)

**Goal: survive beyond the grant.**

- Pluggable AI billing: institution-managed keys, BYO keys, hosted tiers, community credits, open-weight model options.
- Portal governance handoff: named stewardship, open registration with moderation.
- Account lifecycle: repository transfer on institution exit; verified "usable as plain Git repo without Alembic" guarantee.
- Multi-author groundwork promotion (roles, per-layer permissions, shared review queues) as demand proves out — explicitly post-v1.
- Performance, accessibility audit of Alembic itself, documentation, open-source release hygiene.

---

## Cross-cutting constraints (every phase)

- **Modularity:** the editing workspace stays a replaceable client of package operations; no module owns another's schema.
- **Repos are source of truth:** all platform DB state must be a rebuildable projection.
- **Public/private separation is physical**, enforced at commit time, from Phase 1 onward — never retrofitted.
- **AI is provider-swappable**; prompts/outputs logged only under data-governance rules.
- **Backward compatibility:** package schema versioned, old packages always readable, migrations explicit; dual-extension extraction never breaks.

## Dependency picture (why this order)

```
Phase 0 (contracts) ──► Phase 1 (publish loop) ──► Phase 2 (authoring depth)
                                   │                        │
                                   ▼                        ▼
                           Phase 3 (agent harness) ──► Phase 4 (assessment)
                                   │
                                   ▼
                           Phase 5 (adaptation) ──► Phase 6 (portal)
                                                         │
                                                         ▼
                                  Phase 7 (research ops) ──► Phase 8 (sustainability)
```

Adaptation (5) needs block identity (0), publishing (1), and reconciliation (3). The portal (6) is pointless before adaptation makes an ecosystem. Research ops (7) instruments everything before it, but *basic* events exist from Phase 1 because instrumentation-from-the-beginning is a study commitment.
