# Forward-Compatibility & Anti-Rigidity Guardrails (Phases 3–8)

**Status:** binding guideline for all work from Phase 3 through v1.0. Aligns with
[goal.md](../goal.md) and the Roadmap's "Cross-cutting constraints." Exists
because the **editing / viewing / UI-UX layer will be overhauled after v1.0** —
Phases 3–8 must not entrench anything that overhaul will have to tear out, and
must not create parallel mechanisms that fight the durable core.

## The one load-bearing principle

> **Durable core stays presentation-free; each phase ships as logic + a thin,
> disposable client.** Everything the later overhaul touches (panels, layout,
> editor surfaces, viewing) lives in the client. Everything Phases 3–8 add lives
> in the pure packages, `package-ops`, `github-bridge`, the worker, and the
> renderer. The overhaul then rewrites the client against a *stable* operations
> contract, and the data and logic don't move.

## Guardrails

1. **No business logic in React components.** A feature = contract schema (pure)
   + an operation (`package-ops` / bridge / worker) + a thin UI. The UI rewrite
   reuses the operations untouched.
2. **One validated write path: `packageOps()`.** All package mutations — UI
   server actions, the Phase-3 agent/worker, the local studio — go through
   `packageOps(store, packageId)` (`@alembic/package-ops`), which carries the
   two-repo, block-ID, and layer validation. **Never** add a second commit path
   that bypasses it. (`github-bridge.validateCommitPlan` remains the final gate.)
3. **Extend via existing seams; never fork a parallel mechanism:**
   - new media/document types → the **carrier kind registry** (`@alembic/carriers`)
   - new AI/automatic changes → **`CHANGE_KINDS` + tiers** (review/undo come free)
   - new gating (role / paid / phase) → the **entitlement resolver** (`lib/entitlements`)
   - new analytics → the **`research-events` enum** (append-only)
   - new package data → **manifest additive + `PACKAGE_SCHEMA_VERSION` bump + forward-only migration**
   - **layers are closed** (contract v1 §2) — reuse `materials` / `private-instructor` / …, don't invent one
4. **Presentation lives in `@alembic/renderer` (viewing) and the thin client
   (editing).** Agent patches, assessment items, LMS exports, portal records are
   **typed data**, never pre-rendered HTML baked into a durable package.
5. **Thin, disposable feature UI.** Minimal and in its own component,
   entitlement-gated, easy to delete; never woven into shared chrome. Placement
   follows [workspace-framework.md](workspace-framework.md). Don't polish UI now (it's being
   redone) — but don't entrench it either.
6. **Forward-compatible data only:** additive, versioned, append-only; provenance
   multi-author from day one (a goal.md commitment); migrations forward-only;
   carrier/orz conformance fixtures append-only.
7. **Keep the "usable as a plain Git repo without Alembic" guarantee green every
   phase** — the ultimate anti-lock-in canary (goal.md "Account lifecycle").

## The operations boundary (`PackageOps`)

`packageOps(store, packageId)` exposes the canonical **content** operations
(study guide, chapters, carrier assets, derived-artifact listing) as one typed
object. Cloud (Supabase store), local studio (FSA store), and the agent/worker
bind the same interface to different stores — so the operations, and the
validation inside them, are identical regardless of caller. AI generation,
GitHub sync, and governance are separate concerns layered on top, not part of
this surface. New writers target `PackageOps`; this is what makes the client
swappable and gives Phase 3 a clean, safe target.

## How each phase stays decoupled

- **P3 — agent harness:** harness-swappable boundary; the agent is a *producer of
  reviewed changes* through `packageOps` + Tier-2/3 review + `validateCommitPlan`.
  Output is patches + explanations (data). The worker is infra behind a job
  interface. **No parallel write path.**
- **P4 — assessment:** template/blueprint **schema** in the contract; generation
  via `AIProvider`; answer keys/embargo enforced by the existing two-repo gates;
  LMS export (QTI/Common Cartridge) is a pure transformer over package data.
- **P5 — adaptation:** block-level operations + `adapted-from` lineage in
  contract/ops; suggest-back through the same gates; targets **snapshots** (M15).
- **P6 — portal:** emit **LRMI / schema.org `LearningResource`** standard metadata
  from the build; the portal *consumes the standard*, so its UI is replaceable and
  the data outlives it. No proprietary record format.
- **P7 — research ops:** append-only event taxonomy + export transformers; admin
  UI thin; research storage separate from both repos.
- **P8 — hardening:** billing behind the **entitlement resolver + `AIProvider`
  gateway** (seams exist); multi-author roles promoted only as demand proves out;
  verify the plain-Git-repo guarantee.

## Anti-pattern checklist (reject in review)

- A feature that reads/writes package files **without** going through `packageOps`.
- Business rules (validation, lineage, gating) implemented **inside a component**.
- A new enum/registry that **duplicates** an existing seam instead of extending it.
- A durable artifact that embeds **rendered HTML** instead of typed data.
- A schema change that is **breaking** rather than additive + versioned.
- UI polish on the soon-to-be-replaced surfaces, or feature logic entangled into
  shared editor chrome.
