# Alembic Status Tracker

Live view of what is done, in progress, and coming. Update this file in the
same commit as the work it tracks. Statuses: ✅ done · 🔄 partially shipped (remainder tracked in "Phase 2 deferred follow-ups") · ⬜ pending · ⏸ deferred.

**Production:** live at https://alembic.orz.how (Vercel project `alembic`, root `apps/web`, Node 22; Cloudflare DNS; Git auto-deploy on push to `main`).

**Built framework — Phases 0–7 cores complete.** Phase 7 (research ops & study readiness) core is built — M34 de-identified export, M35 admin/ops module, M36 usage dashboard + centrally-managed credits + FERPA/IRB review (M37 institution-managed mode ⏸ deferred post-pilot). Phase 6 (portal & discovery: LRMI, **cross-owner adapt + suggest-back**, searchable portal, governance) complete; Phases 2–5 cores complete. v0.1 is deployed (not yet *shipped* — 2 of 6 release criteria pending the M8.3 pilot). **Only Phase 8 (hardening & sustainability) remains** — or the pilot-readiness pass (the **scaffolding is now done**: [PilotReadiness.md](PilotReadiness.md) runbook, refreshed [Deployment.md](Deployment.md), worked [DemoContent.md](DemoContent.md), M8.1 ✅). Remaining work is operator/deployed: the **live passes** (need Portkey on Vercel; `SUPABASE_SECRET_KEY` + `is_admin` for `/admin`) — the AI/reconcile/adaptation flows (M18, M9.6, M20, M23, M26–M28, M31) + a structured-data-tester check for M30 — then the M8.3 pilot itself. Heavier deferrals (worker tier: PDF/foreign-import/agent-exec/one-click remediation; studio editing/local projects; M29 Zenodo DOI; M37) remain tracked below. See [LocalSetup.md](LocalSetup.md) + [GitHubAppSetup.md](GitHubAppSetup.md).

> **Current direction — self-contained editing (owner-locked, 2026-07).** Editing and viewing both live *in the files*: the workspace **hosts** the in-file editors of `.md.html` / `.slides.html` / `.paged.html` (orz-family) and **builds no editor of its own**; published pages **are** those self-contained files (thin CDN delivery — study guide ~74 KB, framework from jsDelivr, verified live 2026-07-06); every file gets a permalink. **Committed source of record (revised, 2026-07-08 — "lean-source model"):** a chapter's study guide, slides, and practice questions are each committed as lean markdown (`study-guide/`, `slides/`, `practice/` — `.md`, not `.md.html`); the self-contained `.md.html`/`.slides.html` is generated on demand, purely as the editing/viewing surface, and never itself committed. This supersedes the original plan (below, and in the specs) of `.md.html` as the committed source — the specs haven't all been updated to match yet; this line is authoritative until they are. Authoritative docs: [SteeringNote.md](SteeringNote.md), [self-contained-editing.md](specs/self-contained-editing.md), [workspace-framework.md](specs/workspace-framework.md), and the module-based [Roadmap.md](Roadmap.md) (Modules R/E/P/T/I/S/W — supersedes the phase-based plan). **Code state today:** the classic editor is **retired** (~2.2k lines removed; `/workspace/[id]` redirects to `/edit`); the local **Studio (`/studio`) is removed**, replaced by `/guide`; the workspace three-pane shell now *hosts* the in-file editors (`HostedStudyGuideEditor` for study guide + practice; `HostedSlidesEditor` for authored slide decks). The durable guardrails **G1–G8** (two-repo reference enforcement, block-ID reconcile on import, whole-package fork, single-source course metadata, AI-entitlement seam) that the earlier editor-overhaul design drove all **landed + tested**.

**Pilot UI/UX pass (in progress):** walkthrough to make core flows coherent and intuitive. Landed: homepage rewrite (condensed, open-package-management framing); **workspace package lifecycle** — rename (all), delete (trial, permanent), archive/restore (published; unlists from portal), and GitHub-deletion reconciliation purge ([package-lifecycle.md](specs/package-lifecycle.md), migration `0012`); **publish-flow fixes** — install→publish auto-resume + correct repo owner, idempotent repo creation, and template-init (409) retry; **editor publish header** — publishing moved to an icon-forward header cluster by the title: two explicit steps (① Save to GitHub, ② Publish web page), always-copyable public link, History dropdown (versions/restore split out), and List publicly; **whole-package snapshot + citation moved to the workspace package list** (`_components/package-snapshots.tsx`, published rows only) — the editor's "Publish & share" side group is gone, so the editor is purely authoring + the publish header ([workspace-framework.md](specs/workspace-framework.md)); portal listing left open to all educators with the `portal_eligible` admin gate removed (migration `0013` drops the column); **chapter management overhaul** — per-package unit term (chapter/module/lesson/unit/week, `manifest.unitTerm`, additive), independent **page name** (file/URL) vs **title** with a slug-rename that moves all slug-keyed files, the **chapter title rendered as the page h1** (published build + editor preview), and a switcher + **Manage** dialog (reorder/rename/page-name/delete/add) replacing the old chapter bar ([course-structure.md](specs/course-structure.md)); **History is now per-chapter** — moved out of the publish header to sit next to Save, with the version list scoped to the active chapter's file (`listCommits` path filter) and restore writing that one file forward (one chapter restores independently; no whole-repo rollback, no history rewrite). **Two follow-up fixes:** (a) restore / chapter ops / citation / initial-publish now **record the synced SHA** after their commits, so Alembic's own commits no longer trip the external-edit reconcile warning; (b) the publish header's ② is **re-runnable as "Update page"** once the site is live — saving commits source only, so the public Pages site redeploys (incl. new chapters) when ② runs again. Educator-facing "study guide" wording to be unified to "course content" when the editor is revised. **Trial-storage policy (decision):** trial packages live only in Supabase (a hint now says so in the list + editor); binary asset upload (image/PDF/audio) will be **gated to published packages** so trial content stays text-only in Postgres — no object-store tier needed ([carriers-and-assets.md](specs/carriers-and-assets.md) §5; forward constraint, no binary-upload UI yet).

**Superseded design (kept for guardrail history):** the 2026-06 “editor overhaul (v2)” — a bespoke three-pane editor with per-section `.md` editing and `.md.html` *export* — was **superseded by the self-contained-editing direction above** (owner decision, 2026-07-03/04) and archived at [docs/archive/spec-workspace-editor-overhaul.md](archive/spec-workspace-editor-overhaul.md). Its durable guardrails (G1–G8) shipped; the bespoke-editor surface did **not** — the workspace hosts the in-file editors instead. The 7-category rail and chapter/publish flows it prototyped carried over into the hosting shell.

**Workspace polish (in progress).** Iterating on the hosting shell's details: the
category rail toggle is disabled at course level; chapter/category selection is
**optimistic** (nav chrome no longer lags the server round-trip); the course
description is a **Source/Preview** editor with an empty-state field template
(the per-course theme control was removed for now). In-editor AI is now a
**systematic operations registry** — [`@alembic/ai-operations`](../packages/ai-operations)
declares one typed row per AI operation (page scope, model routing, change tier,
event, entitlement, gate, and the rules skill), reconciling the five previously
unaligned catalogs; the assistant menu is a thin client over
`operationsForCategory`, and each op follows the same rules. Universal aids
(spelling/grammar, improve language, accessibility) are available on every page;
`generate-concept-map` is declared+gated on the course page (planned). Rules are
two-layer — a portable **skill** (`skills/ai-operations/<id>`) compiled into the
op's `instruction`, plus a shared **`PLATFORM_SCOPE`** guardrail composed at
runtime so the AI stays task-scoped to course-material building (not an open
chatbot). The assistant is redesigned as a copper "Assistant" popover; the course
description's standalone "Generate with AI" button is folded in as the
`draft-description` generate op (first generative action migrated to registry
dispatch). See [ai-operations.md](specs/ai-operations.md). **Selection AI (v1):**
highlight a passage in a plain-text editor → a floating "Improve selection" chip
runs a selection-capable op (spelling/grammar, language) on just the selection and
splices the reviewed result back. The hosted editors (study guide / slides) get
the same via **[orz-host-ai@1](specs/orz-host-ai.md)** (upstream, so any host can
plug in AI) — **live** for both as of orz-mdhtml@0.7.1 and orz-slides@0.6.1;
**paged** still gets it via the plain-text selection-AI path only (its in-file
editor hasn't been built, so the bridge has nothing to attach to yet). **Format-aware ops** added,
driven by the formats' upstream authoring skills: `enrich-formatting`
(orz-markdown callouts/columns/tabs/TOC — surfaces on the study-guide editor),
`suggest-slide-layout` (orz-slides layout grammar, live), `suggest-page-settings`
(orz-paged page model, planned) — educators change layout/formatting without
memorizing syntax.
**Live (orz-mdhtml@0.7.1 + orz-slides@0.6.1, worker redeployed):** the study-guide
`.md.html` editor and the slides `.slides.html` editor each gain a **page-wide AI
button** (whole-document/whole-slide ops) beside the selection chip; a **theme
picked in-file is captured on save** as that space's global default
(`manifest.theme` for study guide, `manifest.themes[space]` for slides/practice —
orz theme id; last write wins across chapters) and used for the editing surface,
published pages, and downloads — for slides specifically, the deck's own
`<!-- deck ... -->` config is the source of truth (orz-slides writes the pick
back into it on every change) and theme capture reads it straight from there
rather than a separate protocol field; and every generated `.md.html`/`.slides.html`
carries an **invisible agent guide** (how to fetch the official skill + edit
correctly) so external AI apps edit it properly. orz-paged carries the agent
guide too (held from npm until it also gets an in-file editor + the AI button +
theme-in-save).

### Pending operator actions (human-in-the-loop)

These are the only things blocking full production parity with the code:

1. **Migration `0013_drop_portal_eligible` is pending** (drops the now-unused `profiles.portal_eligible` column — optional cleanup, apply anytime after this deploys; no code references it). Migrations 0005–0012 **and 0014** (documents) are applied; **0013** is the only pending one. Config notes: 0007's budget stays dormant until `AI_TOKEN_BUDGET` is set; portal listing is now open to all educators (the `portal_eligible` gate + admin toggle were removed); to reach `/admin`, **flag yourself `is_admin=true`** (dashboard) and set **`SUPABASE_SECRET_KEY`** (service-role reads) — optionally `RESEARCH_EXPORT_SALT`.
2. ✅ **Done** — Vercel build command is `node ../../scripts/fetch-vendor.mjs && next build`; Plotly is vendored and the plot editor (M11b) works live.
3. **Interactive verification passes** (can't run in CI): slides render (M13), the in-file hosted editors (`.md.html`/`.slides.html`/`.paged.html` save round-trip via the worker tier), and the AI/reconcile live runs (M18 coherence agent, M9.6 draft-from-plan, M20 reconcile, M23 question generation, M26–M28 adapt/pull/suggest-back) once Portkey is on Vercel. Ketcher (M11) and plots (M11b) are verified live.
4. **Set the Portkey env vars in Vercel** (`AI_GATEWAY_URL=https://api.portkey.ai/v1`, `AI_GATEWAY_API_KEY`, `AI_MODEL_DEFAULT/FAST/STRONG` = `@<provider-slug>/<model>`) to verify the **M18 coherence agent** live. Local dev can't reach Portkey from this machine (the dev Mac's security/firewall blocks the `node` binary's outbound — `curl` works, `node` ETIMEDOUTs — not an app issue); Vercel's egress is clean. See [ai-architecture.md](specs/ai-architecture.md).

**Deferred chore:** bump renderer to orz-markdown 1.1.0 (published) — reverted to 1.0.0 temporarily because the npm registry was unreachable during M2 and CI uses `--frozen-lockfile`. Behavior is unaffected (1.0.0 supports the attrs block-ID syntax); redo when the registry is reachable.

## Phase overview (full project)

> This table tracks the **archived phase-based plan** ([docs/archive/Roadmap-2026-06.md](archive/Roadmap-2026-06.md)) under which the framework (Phases 0–7) was built. Current planning is **module-based** — see [Roadmap.md](Roadmap.md) (Modules R/E/P/T/I/S/W). Kept because the framework milestones (M0–M37) are organized by these phases.


| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Foundations & contracts | ✅ |
| 1 | Initial release: end-to-end loop (v0.1) | ✅ built + deployed (not yet *shipped* — 2 of 6 release criteria pending the M8.3 pilot) |
| 2 | Authoring depth & chemistry-first (tiers, a11y, carriers & assets: Ketcher/plots/slides/PDF, import, snapshots, gateway, local mode) | ✅ core built (M9–M17); documented deferrals → worker tier (PDF, foreign import), studio editing/projects, DOI/compare, per-institution quotas |
| 3 | Agent harness & reconciliation | ✅ core built (M18 coherence agent, M19 job seam, M20 reconciliation, M21 leakage audit + runbook); deferred: worker-tier agent execution, one-click remediation, private-repo reconcile |
| 4 | Assessment & question templates | ✅ core built (M22 contract, M23 generation, M24 answer-key/embargo, M25 LMS export); follow-ups: blueprint/embargo editor UI + early-lift. No worker tier needed |
| 5 | Adaptation ecosystem | 🔄 core built (M26 adapt & lineage, M27 pull-updates, M28 suggest-back data path); deferred: M29 Zenodo DOI, AI-assisted merge (27.3), whole-package fork, GitHub-PR materialization (28.3, external) (cross-owner adapt + suggest-back landed in Phase 6 / M31) |
| 6 | Portal & discovery | ✅ core built (M30 LRMI, M31 cross-owner adapt/suggest-back, M32 searchable portal, M33 governance scaffolding); migrations 0009/0010 applied |
| 7 | Research operations & study readiness | ✅ core built (M34 export, M35 admin, M36 usage/credits/FERPA); M37 institution-managed mode ⏸ deferred post-pilot |
| 8 | Hardening & sustainability | ⬜ |

## v0.1 sub-modules

Each sub-module is independently implementable and verifiable ("Verify by" is
its acceptance check). Sub-modules within a milestone can be parallelized
unless a dependency is noted.

### M0 — Contracts & scaffolding

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 0.1 | Monorepo scaffold (workspace, CI, 7 projects) | CI green on clean checkout | ✅ |
| 0.2 | package-contract schemas (layers, blocks, manifest, invariant) | 23 unit tests incl. adversarial leak cases | ✅ |
| 0.3 | Package contract v1 written spec | docs/specs/package-contract-v1.md reviewed, consistent with code | ✅ |
| 0.4 | orz-markdown spike (block-ID syntax, embed/extract, Agent Skill) | docs/spikes/orz-markdown-spike.md answers all spike questions; gaps listed | ✅ |

**Upstream work items in orz-markdown** (owner-fixable; from the [spike gap list](spikes/orz-markdown-spike.md)). These do not block M1–M2; deadlines noted:

| Gap | Needed by | Status |
| --- | --- | --- |
| 1. TOC vs custom heading IDs ordering bug (one-line fix) | M2 (preview with TOC) | ✅ fixed upstream in 1.1.0 — not yet consumed (renderer pinned at 1.0.0) |
| 2. Ship Agent Skill in the npm tarball | M3 (AI drafting) | ✅ fixed upstream in 1.1.0 — not yet consumed (renderer pinned at 1.0.0) |
| 3. Add ID-preservation rules to the Agent Skill | M3 (AI drafting) | ✅ fixed upstream in 1.1.0 — not yet consumed (renderer pinned at 1.0.0) |
| 4. Versioned embed/extract module + format-version marker | M4 (.md.html export) | ⬜ |
| 5. Attribute pass-through for plugin blocks (equations/structures) | — | ⏸ superseded by the M11.0 carrier registry (assets are addressable carrier files, not attr-tagged plugin blocks) |

### M1 — Auth & shell

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 1.1 | Supabase project + schema (users, packages, events tables) | migration applies; tables queryable | ✅ migration applied; all 4 tables live, RLS active |
| 1.2 | GitHub OAuth sign-in (identity only) | sign in/out round-trip; user row created; no repo scopes on token | ✅ live-verified: signin → callback → workspace; profile auto-created |
| 1.3 | App shell (nav, workspace layout, route structure) | authed layout renders; unauthed redirect | ✅ live-verified (unauth /workspace → 307 /signin) |
| 1.4 | Trial sandbox workspace (server-side storage, layer-aware) | create sandbox package; layers enforced in storage paths | ✅ live-verified: package created in sandbox via UI |

### M2 — Package builder & block editor

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 2.1 | Package operations API (create/read/update/save; UI-independent) | unit tests against sandbox storage; no UI imports | ✅ `@alembic/package-ops`: create + load/save study guide, PackageStore, MemoryPackageStore; 10 tests |
| 2.2 | Package creation flow (title, course context, license, concepts/objectives lists) | created package validates against contract | ✅ workspace create form (title + license); concepts/objectives lists deferred within M2 |
| 2.3 | Block editor UI (add/edit/reorder/delete heading-bounded blocks) | manual: author 5-block module; delete honors new-ID rule | ✅ live-verified: editor loads seeded blocks, edit + save round-trip |
| 2.4 | Live orz-markdown preview pane | chemistry sample renders while typing | ✅ live-verified (`/api/preview` ~15ms; chemistry + KaTeX render) |
| 2.5 | Block-ID integrity validation on every save | corrupted-ID save is rejected with educator-facing error | ✅ `saveStudyGuide` validates; duplicate-ID save rejected (unit-tested) |
| 2.6 | Research event wiring for authoring steps | events rows appear for create/edit/save with timings | ✅ `package.created` + `save.completed` with timings (live); per-block `block.edited` deferred |

### M3 — AI assist & derived artifact

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 3.1 | Server AI route + per-user rate limiting + governance log | prompt/output logged; limit enforced; key never reaches client | ✅ governed provider wrapper (rate limit via SECURITY DEFINER rpc + `ai_invocations` log); key server-only. Live verify pending migration 0002 apply |
| 3.2 | Draft-section flow (prompt/paste → draft → accept/edit/reject) | accepted draft lands as valid blocks; decision events logged | ✅ code done; Gemini provider live-verified; in-app verify pending migration 0002 |
| 3.3 | Worksheet generation from selected blocks | artifact records source block IDs + revisions | ✅ ops tested (records source block IDs + content hashes) |
| 3.4 | Stale flagging + regenerate / keep-mine | editing a source block flags the artifact; both choices work and are recorded | ✅ ops tested (hash-based staleness; regenerate/keep-mine/divergence) |
| 3.5 | ID-preservation prompt rules + post-generation validation | AI output that damages IDs is rejected automatically | ✅ strip/reattach (IDs never sent to model) + ID-preservation system prompts + marker stripping |

### M4 — Dual-extension artifact

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 4.1 | `.md.html` generator (rendered HTML + versioned embedded source) | file opens standalone in a browser | ✅ `buildMdHtml` (self-contained, `data-orz-format` marker, KaTeX CSS); download from editor + worksheet viewer |
| 4.2 | Source extraction + embedded-source hash in provenance | extract returns byte-identical Markdown; hash recorded | ✅ `extractMdHtml` byte-identical round-trip + legacy format-0; source hash embedded + logged via `export.dual-extension` event |

### M5 — GitHub bridge & two-repo flow

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 5.1 | GitHub App registration + installation flow ("Connect publishing") | App installs scoped to created repos only | ✅ live-verified: connect → install → publish |
| 5.2 | Paired repo creation from templates (public + private) | both repos created with correct layout, manifest links them | ✅ live-verified: `-oer` (public) + `-private` (private) created, manifest links them |
| 5.3 | Commit transport behind `validateCommitPlan` | adversarial private-leak attempts impossible via every API path | ✅ fetch + Git Data API; adversarial unit test + live: public repo's full history has 0 private-instructor paths |
| 5.4 | Save → readable commits; version list; restore | restore round-trip works; history readable in educator language | ✅ live-verified: publish/save commits, version list, restore round-trip (each restore = a new commit; editor reloads after restore) |
| 5.5 | Sandbox → GitHub graduation | sandbox content becomes initial commits with provenance preserved | ✅ live-verified: sandbox content published to the repo pair |

### M6 — Build, publish, preview

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 6.1 | Job queue (pg-boss on Supabase) + worker consumption | enqueued job runs in worker; status reported back | ⏸ deferred — v0.1 builds in-process on publish (orz-markdown is fast, content small; build is a callable, ready to move to the worker tier later) |
| 6.2 | Build job: static build → Pages push | live GitHub Pages URL; renderer version stamped; build config committed | ✅ live-verified: site live on GitHub Pages; renderer version in build-info; self-contained build config (orz-markdown-only script + Actions workflow) committed to the public template → present in new repos |
| 6.3 | Publish flow: Tier-3 approval screen + release gates | gates block bad packages with educator-facing reasons; approval required | ✅ release gates (license/content/IDs/separation) + Tier-3 confirm; failures shown in educator language (unit-tested) |
| 6.4 | In-app student-page preview (same renderer path as build) | preview matches published output | ✅ `/site-preview` renders `buildSite` index in an isolated iframe — same build path |

### M7 — Portal index & hardening

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 7.1 | Package registration + generated public index page | published package appears on index after gates | ✅ migration 0004 applied; gated register/unregister + public `/portal` index + nav link live |
| 7.2 | Failure recovery UX (build, GitHub API, AI provider failures) | each failure mode shows actionable educator-facing message | ✅ retryable educator-facing errors across publish/site/AI/save/restore + app error.tsx / not-found.tsx |

### M8 — Pilot & ship

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 8.1 | Demo content + educator quickstart (1 page) | a new user can follow it unaided | ✅ [Quickstart.md](Quickstart.md) + 3 worked samples across STEM: chemistry [DemoContent.md](DemoContent.md) (full loop), physics [demo/DemoContent-Physics.md](demo/DemoContent-Physics.md), biology [demo/DemoContent-Biology.md](demo/DemoContent-Biology.md) — each with sections, concept map + objectives, AI/worksheet prompts, and a private item showing the public/private boundary |
| 8.2 | Deploy at alembic.orz.how (Cloudflare DNS → Vercel) | production URL serves the app | ✅ live on Vercel (project `alembic`, root `apps/web`); https://alembic.orz.how serves (200, valid TLS); Supabase Auth + GitHub App callbacks set to production |
| 8.3 | Pilot with 1–3 chemistry educators; fix top frictions | full loop completed by a non-developer; release criteria met | ⬜ after the live-verification sweep — protocol in [PilotReadiness.md](PilotReadiness.md) |

**Pilot-readiness runbook:** [PilotReadiness.md](PilotReadiness.md) consolidates
the operator setup delta (Part A), the live-verification passes that must run
before the pilot (Part B), the M8.3 pilot protocol mapped to criteria #1 & #6
(Part C), and post-pilot triage (Part D). [Deployment.md](Deployment.md) was
refreshed in the same pass (migrations 0001–0011, gateway/admin/research env,
admin-flagging step).

## Release criteria (v0.1)

Tracked in [InitialReleasePlan.md](InitialReleasePlan.md) §4 — all six must
hold before calling v0.1 shipped. Current standing:

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Non-developer completes the full loop without Git terms | ⬜ pending the pilot (M8.3) |
| 2 | Private content absent from the public repo's entire history | ✅ verified on real repos |
| 3 | Published repo builds independently with committed build config (no-lock-in) | ✅ self-contained orz-markdown build script + Pages workflow committed to the public template (new repos carry it; existing repos predate it) |
| 4 | Block IDs survive editor saves, AI rewrites, `.md.html` round-trip | ✅ |
| 5 | Research events captured for every loop step; CSV-exportable | ✅ events logged; CSV via a Supabase query/export (no dedicated UI) |
| 6 | Pilot chemist's verdict positive | ⬜ pending the pilot |

### Open items before declaring v0.1 shipped

- **Live-verification sweep** — run the Part B passes in
  [PilotReadiness.md](PilotReadiness.md) on prod (first real gateway calls, the
  AI/reconcile/adaptation/cross-owner flows, M30 structured-data check, two-repo
  invariant re-check) before the pilot.
- **M8.3 pilot** — run with 1–3 chemistry educators against criteria 1 & 6
  (the last substantive gate); protocol + success bar in
  [PilotReadiness.md](PilotReadiness.md) Part C.
- **Deferred chore** — bump renderer to orz-markdown 1.1.0 once the npm
  registry is reachable from the dev machine (CI/Vercel builds already reach it).

Closed recently: no-lock-in build config (criterion #3 — committed to the
public template); M7 portal (migration 0004 applied).

## Phase 2 sub-modules (v0.2–v0.3 — authoring depth & chemistry-first)

**Goal:** make the workspace genuinely good for a chemist and scale a package
from one page to a full multi-module course, while maturing the
artifact/approval/versioning machinery. The v0.1 thesis loop works; Phase 2
deepens it. Same conventions as v0.1: each sub-module has a "Verify by"
acceptance check and is independently implementable.

**Suggested sequencing & grouping** (→ = depends on):

- **v0.2 (authoring core): ✅ done** — M9 multi-chapter → M10 risk-tiered
  approvals → M14 accessibility.
- **v0.3 (carriers & assets):** **M11.0 carrier foundation** (`orz-artifacts`
  codec + kind registry; reference resolver over the public `materials` layer —
  no new layer; `validate()`) →
  M11 Ketcher `.ketcher.svg` → plot `.plot.svg` → M13 document carriers
  (`.slides.html`, `.md.pdf`) → M12 import (lossless carrier re-import + lossy
  foreign import + bulk local upload) → M15 snapshots & citation (pins asset
  permalinks) → M16 model gateway. See
  [specs/carriers-and-assets.md](specs/carriers-and-assets.md).
- **M17 local mode & entitlements** (parallel track): builds on the carrier
  single-file portability (needs M11.0); the entitlement seam is the hook future
  accounts/paid-AI/cloud-sync attach to. See [specs/local-mode.md](specs/local-mode.md).

**Cross-cutting dependencies:**
- **The carrier foundation (M11.0) gates M11/M12/M13** — one primitive
  (self-contained dual-extension file + kind registry) underlies structures,
  plots, slides, PDF, and `.md.html`. It **supersedes the old orz gap #5
  blocker** (the registry is strictly more useful than per-block attrs).
  `orz-artifacts` (orz-stack Phase B) owns the codecs; `package-contract` owns
  placement/identity. See
  [specs/carriers-and-assets.md](specs/carriers-and-assets.md) and
  [orz-stack/docs/ConsolidationPlan.md](../../orz-stack/docs/ConsolidationPlan.md).
- All AI features route through the **risk tiers (M10)**; the **execution &
  model-access design** is in [specs/ai-architecture.md](specs/ai-architecture.md);
  the **course/chapter model** in [specs/course-structure.md](specs/course-structure.md).

**Phase 2 exit criteria:** an educator builds a multi-module chemistry course
with drawn structures and plots (reused across chapters via permalinks),
generates slides + printable PDFs, imports source materials *or* uploads a
complete locally-authored project, snapshots and cites an offering, and works
with accessible, risk-tiered AI assistance under bounded, attributable cost.

### M9 — Multi-chapter courses

Course = one package = one static site with an index + many chapters (v0.1's
single chapter is the degenerate case). See [course-structure.md](specs/course-structure.md).

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 9.1 | Manifest `chapters` index + contract types (ordered chapters) | old packages (no index) read as one chapter; schema versioned, migration explicit | ✅ `ChapterRef` + optional `chapters[]` (additive; absent = single chapter); slug rule; 48 contract tests |
| 9.2 | package-ops chapter CRUD + ordering (over `chapterStudyGuidePath`) | unit tests: create / list / reorder / rename / delete chapters | ✅ `chapters.ts` (list/create/rename/reorder/delete; implicit→materialized); `deleteFiles` added to store; 18 tests |
| 9.3 | renderer multi-page site (index/TOC + per-chapter pages + inter-chapter nav) | site builds N chapter pages + index; single-chapter output unchanged | ✅ `buildCourseSite` (TOC + per-chapter pages + prev/next; single = inline); `buildSite` kept; 23 tests |
| 9.4 | Editor chapter switcher wrapping the single-doc editor | author a 2-chapter course; switch/reorder; per-chapter save | ✅ ChapterBar (add/select/rename/reorder/delete); per-chapter edit+save; GitHub-backed packages sync chapter files + manifest |
| 9.5 | Course index = student-facing chapter TOC | published landing lists chapters with working links | ✅ site build + in-app preview use `buildCourseSite` (index TOC) |
| 9.6 | Concepts + objectives — the hidden planning layer (data → ops → editor → linkages) | author a concept map + objectives in the workspace; the study guide drafts from them and the coherence agent checks against them | ✅ contract schemas (`ConceptMap`/`Objectives`); package-ops `planning.ts` load/save (course/chapter, public layers, facade; 10 tests); web `PlanningPanel` (Author group) edits the map+objectives; **map→study-guide** drafting (`draftOutlineFromPlan` → Tier-2 queue); **map→coherence-agent** (objectives/concepts feed the M18 agent's coverage/ordering checks). Not rendered on the student site. Chapter-scope editor UI + objective↔block alignment recording later |

*Exit:* author and publish a 3-chapter course as one site.

### M10 — Risk-tiered approvals

Generalize the single Tier-3 publish gate into Tiers 1/2/3 (goal.md §2).

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 10.1 | Tier-1 auto-apply + visible changelog + one-click undo (formatting, link repair, ID/schema housekeeping) | a tier-1 fix applies silently, shows in changelog, undoes cleanly; never changes meaning/public-private | ✅ `tidyChapterAction` auto-applies (`canAutoApply`), records undoable inverse, syncs to GitHub; "Changes & review" panel lists Tier-1 changes with Undo (restores inverse, then re-syncs) |
| 10.2 | Tier-2 batch review queue (accept / edit / reject, batchable) | drafted/restructured items queue; batch accept/reject works | ✅ AI drafts enqueue (no inline apply); queue accept/reject per item + **Accept all** (`batchAcceptReviewAction`, dedupes commits per path); accept applies by kind (draft→append block / tidy→write) |
| 10.3 | Tier-3 itemized review extended (assessments, license/attribution, suggest-back) | each tier-3 item reviewed individually with an explanation | 🔄 existing Tier-3 publish/register gates pinned by `BASE_TIER`; assessment/attribution/suggest-back item flows deferred to their feature milestones (M11/M15) |
| 10.4 | Tier policy config (tighten to "review everything"; loosening below Tier-3 impossible) | policy enforced; publish always requires explicit approval | ✅ contract: `effectiveTier`=max(base,minTier), Tier-3 pinned, never lowered (6 tests); `packages.review_all` (migration 0005); "Review all AI changes" toggle routes even tidy to the queue |
| 10.5 | Events: Tier-1 auto-applies logged as a separate category | acceptance-rate metrics reflect human decisions only | ✅ `tier1.auto-applied` / `change.undone` / `review.queued` logged distinctly from `ai.suggestion.accepted`/`rejected` (human decisions) |

*Exit:* AI changes flow through the correct tier; publish stays gated.

### M14 — Accessibility

WCAG 2.1 AA checks + status (goal.md §2). *(Completes v0.2; listed here in build order — M9 → M10 → M14.)*

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 14.1 | Automated a11y checks (heading order, alt text, contrast, link text) on study guide + site | failing items flagged with locations | ✅ pure `@alembic/a11y` (`auditHtml`/`auditFragments`, 33 tests) over **rendered HTML** (no 2nd markdown parser): img-alt, heading-order, empty-heading, link-text, table-header; editor "Accessibility" panel lists findings with per-block locations |
| 14.2 | Accessibility status in metadata + portal indicator | status recorded and shown on the index | ✅ `accessibility` manifest field (additive); "Re-check & record" rolls up all chapters → manifest (rebuildable projection); portal badge via `portal_registrations.accessibility_status` (migration 0006), set at register |
| 14.3 | AI remediation suggestions (Tier-2) | suggested fixes are reviewable | ✅ `suggestA11yFix` (ai-assist) drafts alt/link text → enqueued as Tier-2 `a11y-fix` in the M10 review queue; accept applies a located source rewrite (`applyA11yFix`); never auto-applied |

*Exit:* a package reports and improves its accessibility status. **Contrast** is theme-guaranteed (dark-elegant meets AA; authors don't set colors), so it isn't a per-content check.

### M11.0 — Carrier foundation (gates M11/M12/M13)

The single primitive: a self-contained dual-extension file (rendered payload +
embedded source + `kind`/`format` markers) and the **kind registry** that makes
adding the next type a registration, not a rewrite. See
[specs/carriers-and-assets.md](specs/carriers-and-assets.md).

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 11.0a | Carrier codec — `embed`/`extract`/`detectVersion` per payload (SVG/HTML; PDF later); format-version markers; legacy = format 0 | round-trip + legacy fixtures pass; pure, Node + browser | ✅ new pure `@alembic/carriers` (future orz-artifacts): `embedSource`/`extractSource`/`detectFormatVersion`/`hasCarrier`; SVG `<metadata id="orz-carrier" data-orz-kind/format><![CDATA[…]]>` + HTML non-exec `<script>`; `]]>`/`</` escaping; legacy `orz-chart-meta`→format 0; 19 tests |
| 11.0b | Kind registry (`CarrierKind`: id, role, extension, payload, formatVersion) | a new kind registers without touching consumers | ✅ `registerKind`/`getKind`/`getKindByExtension` (longest-suffix)/`listKinds`/`BUILTIN_KINDS` (ketcher, plot = svg/asset; md, slides = html/document); editors bound web-side |
| 11.0c | Carrier reference resolver over the public `materials` layer (public-only refs, fail-closed) — **no new layer** (contract v1 layer set is closed; `materials` already covers diagrams/images/charts) | public docs cannot reference private files; path rules hold | ✅ contract `assertPublicReference` (throws on private layer), `classifyReference` (live/pinned/external), `livePermalink`/`pinnedPermalink` |
| 11.0d | Asset records (stable id + content hash, reusing M3 hashing) + required alt text | asset round-trips with stable id; alt text travels | ✅ contract `AssetRecordSchema` (`ast-…` id, path, kind, payload, `hashContent`, required `altText`); package-ops `listAssets`/`readAsset`/`writeAsset` over `materials/` (5 tests) |
| 11.0e | `validate(project, {knownKinds})` (pure) — one contract, two surfaces (validator == Agent Skill) | a conforming local project passes the same check the importer runs | ✅ contract `validateProject(input, {knownCarrierExtensions})` — manifest parse, path/repo rules, chapter existence, carrier-in-public-layer; collects issues, injects kinds (no registry dep) |

*Exit:* ✅ an asset carrier round-trips through the codec; a registered kind is
consumed by package-ops asset ops without bespoke code (editor/importer/renderer
wiring follows in M11/M11b/M13/M12).

### M11 — Chemistry-first: structures (`.ketcher.svg`)

First asset kind on the carrier foundation. (Borrows the idea from
`vscode-ketcher`, not its untested internals.)

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 11.1 | Ketcher editor integration (draw/edit) → `.ketcher.svg` carrier | draw a structure; SVG + embedded source saved | ✅ self-hosted standalone build (`pnpm fetch:ketcher` → `apps/web/public/ketcher/`, gitignored, 96 MB, v3.12.0) in a lazy same-origin iframe (`ketcher-editor.tsx`); `saveStructureAssetAction` → `writeAsset`. **Verified live** on alembic.orz.how (draw→save→insert→preview round-trip works) |
| 11.2 | Insert by reference + intra-package search & click-insert | searchable asset picker inserts the correct reference | ✅ `StructuresPanel` (searchable asset list, Insert/Edit; Draw-new) + caret-aware `insertMarkdown`; `listAssetsAction`/`readAssetAction`. Follow-up: persist asset alt for re-insert (now empty `![]()` on re-insert) |
| 11.3 | Structure rendering in preview / site / exports (as `<img>`, inert) | structure renders in preview and the published site | ✅ preview rewrites `materials/…` refs → `GET /api/asset/[pkg]/[...path]` (store-served, public-only). Follow-up: published-site path resolution + permalink pinning with M15 |
| 11.4 | AI alt-text from structure source (chemistry-first a11y) | alt text generated then reviewed (Tier-2) | ✅ ai-assist `suggestStructureAltText` + `suggestStructureAltTextAction`; "Describe with AI" prefills an editable alt field (educator reviews before save) |

*Exit:* ✅ a chemistry section with a drawn, reusable structure publishes with alt text — verified live on alembic.orz.how. Follow-ups (non-blocking): asset alt persistence for re-insert; published-site asset path resolution (with M15 pinning).

### M11b — Plot/chart asset kind (`.plot.svg`)

Second asset kind — proves the registry generalizes (adding it touches only one
registration). Plotly spec as source. (Borrows from `orz-plot-vscode`.)

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 11b.1 | Plot editor (Plotly spec) → `.plot.svg` carrier | author a chart; SVG + embedded spec saved | ✅ `plot-editor.tsx` (lazy-loads vendored Plotly basic via `pnpm fetch:plotly` → `/vendor/`, gitignored, ~1 MB; spec textarea + live preview; `toImage` SVG → `saveAssetAction`). **Verified live** (Vercel build vendors Plotly via `fetch-vendor`; plot render works in production) |
| 11b.2 | Registered as a kind; reuses §11.2 insert/search path with no new plumbing | plot assets appear in the same picker as structures | ✅ `plot` already in `BUILTIN_KINDS`; generalized `saveAssetAction` (kind-aware path/ext) + `AssetsPanel` (Draw structure / New chart; Edit by kind) — **no new server/route/store code** (proves the registry generalizes) |
| 11b.3 | Static-SVG render on the published site (no heavy runtime) | chart renders without bundling Plotly into the site | ✅ by design — the carrier stores the rendered SVG; the site shows it via `<img>`; Plotly is authoring-only (vendored, never bundled into the site) |

*Exit:* ✅ a second asset type ships by registration + one editor — the shared pipeline (picker, save, `/api/asset`, preview) was reused unchanged. **Verified live** (Plotly vendored via the Vercel `fetch-vendor` build command; plot render works in production).

### M13 — Document carriers (`.slides.html`, `.md.pdf`)

Derived carriers on the same codec; complete the derived-artifact lifecycle.

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 13.1 | Document codecs for `.md.html`/`.slides.html` on the carrier codec; legacy = format 0 | embed/extract with format markers; old files extract | ✅ renderer `mdhtml.ts` migrated to `@alembic/carriers` (`id="orz-carrier"`, kind `md`); old `id="md-source"` reads as format 0; `slides.ts` (`buildSlidesHtml`/`extractSlides`/`slidesSourceFromBlocks`/`splitSlides`); 33 renderer tests. Design review of the extensions captured in [carriers-and-assets.md §4a](specs/carriers-and-assets.md) to feed back |
| 13.2 | `.slides.html` generation from blocks + carrier round-trip | slide deck generated; source embedded + extractable | ✅ lightweight **self-contained** deck (sections + dark-elegant + inline scroll-snap/arrow nav; no reveal.js, no CDN); `generateSlidesArtifact` (package-ops) derives one slide per section; web "Generate slides" + View/Download via `/api/asset`; round-trips |
| 13.3 | `.md.pdf` generation (worker-side, paged.js/Chromium) + carrier | PDF generated with embedded source | 🔄 **design done** ([§4a](specs/carriers-and-assets.md): worker Chromium + `source.md` attachment + inline KaTeX); interim **Print → Save as PDF** from `.md.html` shipped. Full worker pipeline deferred to the worker tier |
| 13.4 | Slides as derived artifacts (source blocks + staleness, reuse M3) | edit a source block → slide flagged stale | ✅ `slides` added to `DerivedArtifactKind`; deck recorded with source-block hashes; `listArtifacts` flags stale; regenerate is deterministic/idempotent (one deck per chapter, reuses artifact id). Test covers stale-on-edit |
| 13.5 | AI-assisted merge for stale artifacts (regenerate / merge / keep-mine complete) | merge applies block changes while preserving local edits, with review | ⬜ (slides regenerate deterministically; AI merge for hand-edited decks later) |

### M12 — Import & local-first upload

Lossless carrier re-import + lossy foreign import + bulk local-project upload.

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 12.1 | Lossless re-import of any registered carrier (`.ketcher.svg`/`.plot.svg`/`.md.html`/…) | carrier `extract()`ed → asset/document registered, no AI | ✅ package-ops `classifyImport` (asset→store under `materials/`; document→extract markdown; markdown passthrough; binary→unknown); web `importFileAction` (asset stored + synced; document/markdown → blocks appended deterministically). 5 import tests |
| 12.2 | Lossy foreign import: Word (.docx), PDF, PPTX, images → normalized | each format yields normalized content | 🔄 **deferred to the worker tier** (heavy parsers: mammoth/pdf/pptx, npm-flaky here). Text path is covered via 12.3; binary types report "coming (server-side)" |
| 12.3 | AI-assisted restructuring into blocks (Tier-2 queue) | imported doc becomes reviewable study-guide blocks | ✅ ai-assist `restructureToBlocks` (6 tests); web `restructureImportAction` → Tier-2 `import-blocks` change; accept branch appends the reviewed sections. Paste notes → reviewable study guide |
| 12.4 | Bulk local-project upload = lossless re-import over a tree, validated by `validate()` | a conforming local project uploads with zero friction | 🔄 single-file import shipped; bulk **zip/folder** upload deferred (needs a zip dep + ties to M17 local mode) — `validate()` from M11.0 is ready to gate it |
| 12.5 | Provenance + imported-markdown ID fallback (sidecar/content-hash until native IDs) | imports carry source + attribution; un-ID'd matched (contract §6 r9) | 🔄 `import.completed` event records the source; imported markdown gets block IDs minted on save (existing path). Full content-hash sidecar matching later |

*Exit (demo):* re-import a carrier (`.ketcher.svg` / `.md.html`) or Markdown losslessly, or paste notes → AI-restructured reviewable sections. Foreign binaries + bulk zip upload are designed and deferred to the worker tier.

### M15 — Snapshots & citation

Named immutable versions + citable scholarly output (goal.md §5).

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 15.1 | Snapshot = Git tag via the bridge; create / list | a named snapshot is created and listed | ✅ github-bridge `getDefaultBranch`/`listTags`/`createTag`; web `createSnapshotAction` (tags the public-repo head; name→tag slug) + `listSnapshotsAction`; `SnapshotsPanel` in the Publish & share group |
| 15.2 | Restore-from / compare snapshots | "what changed between offerings" shown in educator language | 🔄 snapshots listed with a **View** link (GitHub tag page); GitHub-native compare/restore deferred (heavy; educator-language diff is future) |
| 15.3 | Citation: stable snapshot URL + version; `CITATION.cff` generation | citation metadata generated per snapshot | ✅ package-ops `generateCitationCff` (pure; SPDX license, version, author, date; 2 tests) + web `addCitationAction` commits `CITATION.cff`; each snapshot has a stable tag URL |
| 15.4 | Opt-in DOI minting (Zenodo or equivalent) | snapshot → DOI on opt-in | ⬜ deferred (external Zenodo integration; opt-in) |
| 15.5 | Adaptation/citation target snapshots (`adaptedFrom.snapshot`) | an adaptation references a snapshot, not a moving head | ✅ shipped with M26.1 — block-level `adaptedFrom.snapshot` field exists (`packages/package-contract/src/blocks.ts`); the package-level adaptation record (`AdaptationSource.snapshot`) is threaded through `adaptBlocksInto` so an adaptation pins a snapshot, not a moving head |
| 15.6 | Pin carrier-asset references to SHA permalinks on snapshot/publish (live → frozen) | a snapshot's pages reference assets at a fixed commit, not a moving branch | ✅ **by design** — a snapshot tags the *whole repo*, so `materials/…` references resolve to that tag's immutable content (content + assets frozen together). Explicit raw-permalink rewriting is optional and unneeded for repo-relative refs |

*Exit:* ✅ snapshot a published course offering (immutable tag) and cite it
(`CITATION.cff` + stable URL). Compare/restore + DOI are deferred follow-ups.

### M16 — Model gateway & task routing

Cost/scale via a gateway + per-task model selection. See [specs/ai-architecture.md](specs/ai-architecture.md).

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 16.1 | Gateway provider (Portkey/OpenRouter) behind `AIProvider` | provider swap with no workflow-code change | ✅ ai-assist `GatewayProvider` (OpenAI-compatible, native fetch — works with OpenRouter/Portkey/OpenAI); `lib/ai` selects it when `AI_GATEWAY_URL`/`AI_GATEWAY_API_KEY` set, else Gemini. 49 ai-assist tests |
| 16.2 | task→model routing map (cheap/fast vs strong) | each task uses its configured model | ✅ ai-assist `modelForTask`/`DEFAULT_ROUTING` (pure); `GovernedProvider` injects the per-task model (`AI_MODEL_DEFAULT` overrides default), unless a call pins one |
| 16.3 | Budgets / quotas per user + per institution; usage attribution | quota enforced; usage attributable | 🔄 per-user **token budget** (`recent_ai_token_usage` RPC, migration 0007; `AI_TOKEN_BUDGET`/`AI_BUDGET_WINDOW_SECONDS`; `BudgetExceededError` surfaced) on top of the existing rate limit; usage attributable via `ai_invocations` (tokens already logged). Per-institution quotas + dashboards later |
| 16.4 | Governed logging via the gateway; data-handling review (FERPA/IRB) | prompts/outputs logged under governance; third-party data handling reviewed | 🔄 governed logging in place (`ai_invocations`, owner-insert-only, never in a repo); the third-party data-handling review (FERPA/IRB; what a gateway/provider may retain) is captured as an ops/compliance task in [ai-architecture.md](specs/ai-architecture.md) |

*Exit:* per-task model selection + per-user budgets live; still provider-swappable. **Migration 0007 applied; the budget activates once `AI_TOKEN_BUDGET` is set.**

### M17 — Local mode & entitlements

A light, **anonymous, local** editor (open/edit/save supported files on disk; no
account, no cloud, no AI), plus the **entitlement seam** future accounts / paid
AI / cloud sync plug into. OER content stays open; the service (platform + AI)
is the paid part. See [specs/local-mode.md](specs/local-mode.md).

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 17.0 | Entitlement seam: `Capability`/`Identity`/`resolveEntitlements` (the monetization hook) | anonymous resolves to `{localFile}`; cloud user → full set; future plans add caps here only | ✅ `lib/entitlements.ts` (pure; `resolveEntitlements`/`can`/`ANONYMOUS`); studio consumes it. App-wide server enforcement + `AuthProvider` (Google) land with paid AI (M16/v3) |
| 17.1 | `PackageOps` interface + local impl over `LocalPackageStore` (File System Access) | the editor runs save/load against a local store with no server call | 🔄 v2 (local **projects**); not needed for the v1 single-file studio |
| 17.2 | Single-file studio: open/edit/save Markdown & `.md.html`; "new note"; FSA + download fallback | open a `.md.html` from disk, edit, save back (no account) | ✅ `/studio` (anonymous): New note / Open file (`.md`/`.md.html`, carrier source extracted client-side via `@alembic/carriers`) / live preview / Save `.md` (local) / Save `.md.html` (stateless `/api/render/md-html`); FSA `showSaveFilePicker` + download fallback. **Structures/plots/slides editing deferred** (their editors need a storage-agnostic save callback) |
| 17.3 | Client-capability audit (browser-clean path; Web Crypto hashing) | editing runs in the browser with no Node-only deps | 🔄 carriers codec is browser-clean (studio uses it directly); preview + `.md.html` build run server-side (orz-markdown isn't browser-safe — stateless, nothing stored). Full audit (Web Crypto hashing) with local projects (v2) |
| 17.4 | *(later)* v2 local projects, v3 paid AI + accounts, v4 cloud sync | each lands behind the entitlement resolver, no feature rewrite | ⬜ |

*Exit (v1):* ✅ a visitor opens a `.md.html` / Markdown file from disk, edits it,
and saves it back — anonymous, no cloud, no AI. Structures/plots/slides editing
in the studio + local *projects* are the next iterations. The entitlement
resolver is the single place future paid tiers attach.

## Phase 3 sub-modules (v0.4 — agent harness & repository intelligence)

**Goal:** move multi-file, repository-aware work from hand-rolled code to a
bounded agent, and absorb external edits cleanly. Per
[ai-architecture.md](specs/ai-architecture.md), the Tier-B coherence agent is the
differentiator; per [forward-compatibility.md](specs/forward-compatibility.md)
it is a *producer of reviewed changes* through `packageOps` + tiers +
`validateCommitPlan` — never a parallel write path; output is typed data.

**Posture:** the Tier-B agent is built as a **bounded, app-orchestrated agent**
over the single-call `AIProvider` (provider-swappable), not a container/CLI
coding-agent. The full container-CLI harness and full git-history-rewrite
tooling are explicitly **deferred to the worker tier**, behind the same
swappable boundaries.

### M18 — Bounded coherence agent (Tier B)

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 18.1 | `ProposedChangeSet` contract (typed agent output) + validator | round-trips; validator enforces block-ID integrity (refs exist, reorder = permutation, IDs never invented) | ✅ contract `proposals.ts` (versioned envelope; `update`/`create`/`reorder-block` ops — no destructive delete; `CoherenceFinding`; `validateProposedChangeSet`); `coherence-edit` Tier-2 change kind; append-only `agent.run.*`/`reconcile.*` events. 9 tests |
| 18.2 | Bounded coherence agent + harness boundary (ai-assist) | agent emits a schema-valid set from package context; harness swappable; ID-preservation enforced | ✅ `coherence-agent.ts`: `CoherenceHarness` interface (engine swappable), `createProviderCoherenceHarness` (strict `COHERENCE_SYSTEM` prompt, tolerant JSON parse, marker-strip, version-stamp + schema-validate), `createStubCoherenceHarness` (no-network). `coherence-agent` task routed to the strong model. 6 tests |
| 18.3 | package-ops agent read/apply surface (bound to `packageOps`) | gather context across chapters; apply an accepted set through `saveStudyGuide` only | ✅ `coherence.ts`: `gatherCoherenceContext`/`blockIdsByChapter`/`applyProposedChangeSet` (validates then applies update/create/reorder via the one validated write path; subset via `operationIndices`); wired into the `packageOps` facade. 8 tests |
| 18.4 | Thin web client: run the agent, route results into the Tier-2 queue | educator runs a whole-course review; suggestions appear as reviewable items; accept applies through `packageOps` | ✅ `agent-actions.ts` `runCoherenceAgentAction` (governed provider = rate limit + token budget; gathers context, runs the agent, queues one `coherence-edit` per op, logs `agent.run.*`); `change-actions` accept branch applies via `applyProposedChangeSet` (stale-tolerant); `CoherencePanel` in the Review group. typecheck + build green |

*Exit:* ✅ an educator requests a package-wide coherence review and reviews the
proposed edits as Tier-2 teaching-material changes. **Needs a live in-app pass**
(requires a configured AI provider; the agent core is unit-tested with a fake
provider + stub harness).

### M19 — Agent execution & gating

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 19.1 | Agent run behind the worker job interface (in-process for dev; worker-ready) | a coherence run is modeled as a job; runs in-process now, movable to the worker tier | 🔄 `AgentRunJob`/`AgentRunResult` job contract added to `apps/worker/jobs.ts` (the forward-compat seam, mirroring `BuildSiteJob`); execution stays in-process in `runCoherenceAgentAction`. Worker-tier `handleAgentRun` is a stub — moving Tier B to the container worker is deferred (same pattern as the build job) |
| 19.2 | Gating: entitlement + per-user token budget (Tier B is the expensive tier) | a run is blocked when budget is exhausted; usage attributable | 🔄 budget/rate-limit enforced via the governed provider (M16); usage attributable via `ai_invocations`. Explicit per-run quota / entitlement cap later |

### M20 — External-edit reconciliation

Absorb edits made directly in GitHub/VS Code ("foreign commits") into Alembic's
projection — or quarantine them when they break an invariant.

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 20.1 | Detect foreign commits (last-synced SHA vs remote head) | divergence detected; clean repo = no-op | ✅ `packages.last_synced_sha` (migration 0008); `lib/github` records it on every commit; github-bridge `compareCommits(base,head)` lists changed paths (9 tests) |
| 20.2 | Rebuild projection from repo content + re-validate invariants; quarantine on violation | a foreign edit that leaks a private path into the public repo, or corrupts block IDs, is **held back** (store untouched) | ✅ package-ops `reconcilePublicRepo` (network-free `RepoReader`): validates every changed path with `assertPathAllowedInRepo` + block-ID integrity, **collect-all then fail-closed** — absorb only a fully-clean changeset, else quarantine writing nothing. 11 adversarial tests (leak + dup-ID + mixed quarantine prove no partial absorb) |
| 20.3 | Reconcile-first saves (no force-push); educator-facing reconcile | save refuses to overwrite an external commit; a "Check for outside changes" surface absorbs/quarantines | ✅ save detects head≠last-synced and skips the auto-sync with a warning (local save still persists; never force-pushes — commits keep `base_tree`); `reconcilePackageAction` + `ReconcilePanel` (Review group) absorb clean changes / show quarantine violations; `reconcile.completed`/`reconcile.quarantined` events |

*Exit:* ✅ an external edit to the public repo is absorbed cleanly, and a
boundary-violating one is quarantined for review — the durable core is fully
unit-tested (no network/AI). **Needs a live pass** (edit a connected repo in
GitHub, then "Check for outside changes"). Private-repo reconciliation + a
3-way merge for same-file conflicts are future. (Migration 0008 applied.)

### M21 — Leakage remediation

Detect private content in the public repo → documented remediation procedure
(history purge + forced re-publication + incident note). See
[specs/leakage-remediation.md](specs/leakage-remediation.md).

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 21.1 | Full-tree leak detection (audit the whole public repo, not just a diff) | a private-layer/non-allowlisted path in the public repo is flagged | ✅ github-bridge `listTree` (recursive, `truncated` flag); package-ops pure `findLeakedPaths` (reuses fail-closed `assertPathAllowedInRepo`; 2 tests); web `scanPublicRepoForLeaks` + `scanForLeaksAction` + "Scan for leaks" in the Review panel; `leak.detected`/`leak.remediated` events |
| 21.2 | Remediation procedure (history rewrite + forced re-publication + incident note) | runbook is actionable; mechanism exists | ✅ [leakage-remediation.md](specs/leakage-remediation.md) runbook (contain → confirm scope → clean re-publication via `publishToBranch` parentless root commit *or* `git filter-repo` → forced re-publish → incident note → verify; secret-rotation + GitHub-cache caveats). The destructive purge is a **guarded operator step**, not one-click |
| 21.3 | One-click in-app remediation execution | confirmed in-app purge & re-publish | ⏸ deferred (too dangerous to automate for the demo; mechanism exists via `publishToBranch`, gated behind the runbook). History-walking detection + private-repo audit also deferred |

*Exit:* ✅ a leak in the public repo is detected by audit and there is an
actionable remediation procedure; commit-time validation + M20 quarantine keep
leaks from entering via Alembic. **Completes the Phase-3 core (M18–M21).**

## Phase 4 sub-modules (v0.5 — assessment & question templates)

**Goal:** the assessment-support layer with hard public/private boundaries —
instructor-defined question templates → AI-generated items → LMS export, with
answer keys and embargoed assessments that never touch the public repo.

**Prerequisites already in place:** concept/objective alignment substrate (M9.6);
Tier-3 change kinds `assessment-edit`/`answer-key`/`suggest-back` (M10, pinned at
Tier 3); the two-repo invariant + leak audit (M5/M20/M21) for answer-key safety;
release gates (M6.3) to extend. The deferred **M10.3 Tier-3 itemized assessment
review** folds into M22/M24.

**Layers (closed set — no new layer):** question templates + public-safe supports
→ the public **`assessment-support`** layer; answer keys + embargoed assessments
→ the private **`private-instructor`** layer.

**Worker-tier dependency — pinned by this plan:** M22–M24 are contract +
single-call AI + in-process work and need **no** worker tier. LMS export (M25) is
a **pure XML transformer + in-process zip** (QTI XML; Common Cartridge `.imscc` =
zip of XML + manifest) — lighter than the Chromium PDF path, so it is feasible
server-side **without** standing up the worker tier. ⇒ **Phase 4 does not force
the worker tier.** (The worker tier remains needed for PDF/foreign-import/
worker-side agent — the separate Phase 3.5 infra block.)

### M22 — Assessment & question-template contract *(durable core, pure)*

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 22.1 | Question-template schema (concept/objective alignment, context, difficulty, representations, parameters, misconception targets) | a template validates; references concept/objective ids | ✅ contract `assessments.ts` `QuestionTemplateSchema` + `Difficulty`/`Representation`/`TemplateParameter` |
| 22.2 | Assessment blueprint schema (selection of templates/objectives, weighting, embargo metadata) | a blueprint validates against the contract | ✅ `AssessmentBlueprintSchema` (entries: templateId/count/weight; objectiveIds; `Embargo.releaseAt`) |
| 22.3 | Question-item + answer-key records (item in `assessment-support`; key in `private-instructor`; alignment back to template/objective) | placement enforced by `assertPathAllowedInRepo`; key path is private-only | ✅ `QuestionItemSchema` (public, no answer) + `AnswerKeySchema` (private); path helpers + `assertAnswerKeyPrivate`; 8 tests (96 contract) |

### M23 — AI question generation *(Tier A — single-call, no worker tier)*

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 23.1 | Generate items from a template (ai-assist), respecting instructor design + alignment + misconception targets | generated item matches the template's constraints | ✅ ai-assist `generateQuestions(provider,{template,count})` — pairs public stem/choices with the PRIVATE answer/rationale; prompt forbids leaking the answer; `stubGenerateQuestions` for offline; `assessment-item` routed to the strong model. 6 tests (55 total) |
| 23.2 | Items routed through review (Tier-2 draft / Tier-3 for answer keys) + provenance to the template | each item reviewed; key generation is Tier-3 itemized | ✅ web `generateItemsAction` enqueues each item as a **Tier-3** `assessment-edit` review (with templateId provenance); surfaced in "Changes & review"; Tier-3 excluded from batch-accept (itemized only). **Needs a live pass** (Portkey on Vercel) |

### M24 — Private-repo answer keys & embargo *(security-critical; in-process)*

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 24.1 | Answer keys written only to the private repo; never staged public (reuse the two-repo invariant) | adversarial test: a key can't reach the public repo via any path | ✅ package-ops `saveAnswerKey` (repo:"private", `assertAnswerKeyPrivate`); web accept writes item→public + key→private via `syncPrivateFilesToGitHub` (commit plan `repo:"private"`, `validateCommitPlan` fails closed). Adversarial test: a sentinel answer lands only in the private partition, zero public files |
| 24.2 | Embargoed assessments: auto-release date + owner-only early lift | embargo metadata gates publication; lift is Tier-3 | 🔄 contract `Embargo` + ops `isReleased()` done; the blueprint/embargo editor UI + early-lift action are a follow-up |
| 24.3 | Answer-key leakage checks in release gates (extend M6.3 + the M21 audit) | a publish carrying a key/embargoed item is blocked with an educator-facing reason | ✅ release-gates "Answer keys & embargo" check (fails if any private/answer-key path is staged public); active in the existing publish flow |

### M25 — One-way LMS export (QTI / Common Cartridge) *(pure transformer + zip)*

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 25.1 | QTI item/assessment XML transformer over assessment data (pure, like the renderer) | exported XML validates against QTI; round-trips key fields | ✅ package-ops `buildQti12` (QTI 1.2 `questestinterop`; MCQ → response_lid + resprocessing scoring the choice equal to the key answer; open → response_str + model-answer feedback; XML-escaped) |
| 25.2 | Common Cartridge `.imscc` packaging (manifest + XML, in-process zip) | the package imports into Canvas/Moodle | ✅ `buildCommonCartridge` (CC 1.1 `imsmanifest.xml` + QTI file) + dependency-free **stored-zip writer** (`zipStore`, hand-rolled CRC-32, verified against system `unzip`) + `exportCommonCartridge`; **no npm dep added**. 15 tests (131 package-ops) |
| 25.3 | Export excludes embargoed/answer-key content unless owner-authorized | export of a public-safe set carries no private content | ✅ web `GET …/export/lms` is owner-authenticated (= owner authorization); reads keys from the private partition, returns the `.imscc` download, logs `export.lms`; "Export to LMS (.imscc)" in the Assessments panel. Per-blueprint embargo gating lands with the blueprint UI follow-up |

*Exit:* an instructor runs a quiz cycle — template → generated questions →
export to LMS — with keys never touching the public repo.

## Phase 5 sub-modules (v0.6–v0.7 — adaptation ecosystem)

**Goal:** make reuse a two-way street — adapt/fork at every scale with lineage +
attribution + license-compatibility; pull upstream updates; suggest changes back;
deepen citation (DOI). Exit: two educators exchange improvements on a shared
package lineage without either touching Git.

**Prerequisites in place:** block identity + `adaptedFrom {packageId, blockId,
snapshot?}` on `BlockSchema` (P0); two-repo publishing (P1); external-edit
reconciliation M20 (migration 0008 applied; needs its live pass); snapshots M15 (tag =
immutable target) + `CITATION.cff` (M15.3) + stable snapshot URLs (M15.1);
`suggest-back` already a Tier-3 change kind (M10). Per the coherence pass, Phase 5
leads with the lineage contract (the deferred M15.5 `adaptedFrom.snapshot`).

**No worker tier needed** (all in-process / single-call AI). External
integrations (Zenodo DOI; GitHub PR materialization) are scoped/deferred.

### M26 — Adaptation & lineage (fork at every scale) *(durable core first)*

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 26.1 | Contract: package-level `adaptedFrom` (manifest) + `adaptedFrom.snapshot` (blocks, M15.5) + pure license-compatibility (`canAdapt(source,target)`) + attribution record | adapting CC-BY→CC-BY-SA allowed; NC/SA incompatibilities rejected; lineage validates | ✅ contract `adaptation.ts` `canAdapt` (CC 4.0 matrix, reasons), `AdaptationSource` (required attribution, snapshot pin); manifest `adaptedFrom` (additive); block `adaptedFrom.snapshot` already present. 7 tests |
| 26.2 | package-ops adapt ops: copy block / artifact / chapter / whole course with NEW ids + `adaptedFrom` lineage (+ `replacesId` where replacing), attribution preserved, gated on `canAdapt` | unit tests: fork a chapter → new ids, lineage + attribution recorded; license-incompatible adapt blocked | ✅ package-ops `adaptBlocksInto` (license-gated; new minted ids via `saveStudyGuide`; per-block lineage in public `provenance/adaptations.json`; throws `AdaptationNotAllowedError`) + `loadAdaptationProvenance`. 4 tests (135 package-ops). Whole-package fork (createPackage + manifest.adaptedFrom) is a thin follow-up |
| 26.3 | Thin web "Adapt" flow (adapt a block/chapter/package into the educator's workspace) | educator adapts content; new package/blocks carry lineage | ✅ `adapt-actions` (`listAdaptSourcesAction`, `adaptChapterAction` — license-gated, syncs chapter + provenance to GitHub, logs `adaptation.completed`) + `AdaptPanel` (Author group). Adapts among the educator's own packages; cross-owner/portal adaptation is a follow-up |

### M27 — Pull updates (upstream → adapter)

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 27.1 | Detect upstream changes to adapted blocks (M3-style hash drift over the lineage) | an edit to a source block surfaces an available update; clean = none | ✅ lineage (M26) now records `sourcePath` + `sourceContentHash`; package-ops `detectUpstreamUpdates` flags entries whose source hash drifted (skips legacy/removed). 4 tests (139 package-ops) |
| 27.2 | Take-update / keep-mine with recorded divergence | take applies upstream + clears flag; keep leaves content but acknowledges (clears flag) | ✅ `applyUpstreamUpdate(take|keep)` — both advance the stored hash; take replaces via `saveStudyGuide`, keep records divergence. Web `listUpstreamUpdatesAction`/`applyUpstreamUpdateAction` + AdaptPanel "Updates from upstream" (Take/Keep), syncs chapter + provenance, logs `upstream.update.applied` |
| 27.3 | AI-assisted merge for diverged blocks | merge upstream changes into the adapter's edited block, reviewed | ⬜ deferred (single-call provider merge → Tier-2 review; take/keep ship now) |

*Notes:* detection runs within the educator's own packages (same store); pulling
from a cross-owner upstream via GitHub ties to the cross-owner-adaptation
follow-up. AI-assisted merge (27.3) is the remaining slice.

### M28 — Suggest back (adapter → author)

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 28.1 | Block-level suggestion routed through the Tier-3 `suggest-back` gate (platform-mediated) | an adapter's improved block lands in the upstream author's review queue as a Tier-3 item | ✅ `listAdaptedBlocksAction` + `suggestBackAction` (uses the M26 lineage to find the upstream block; records a Tier-3 `suggest-back` change on the UPSTREAM package; logs `suggestion.sent`); AdaptPanel "Suggest your improvements back" |
| 28.2 | Author review applies the suggestion to their block | accept → the upstream block's title/body updates (id preserved), synced; reject discards | ✅ `change-actions` `suggest-back` accept branch (applies via `saveStudyGuide`, stale-tolerant); Tier-3 = itemized (excluded from batch-accept) |
| 28.3 | Optional materialization as a GitHub PR to the upstream public repo | a suggestion becomes a PR on the upstream repo | ⏸ deferred (external — needs a `createPullRequest` bridge + App PR permission on upstream) |

*Notes:* the platform-mediated path works within the educator's own packages
(same store/owner); cross-owner suggest-back (RLS-crossing insert into another
owner's queue) needs a service-mediated path — the cross-owner-ecosystem follow-up.

### M29 — Citation depth: DOI *(M15.4 — external, likely deferred)*

Opt-in **Zenodo DOI** minting on a snapshot (external API + token). `CITATION.cff`
+ stable snapshot URLs already shipped (M15.3/15.1). ⏸ pending a Zenodo account/token.

## Phase 6 sub-modules (v0.8 — portal & discovery)

**Goal:** turn the generated portal index into a real discovery hub, and close
the **cross-owner** ecosystem loop (discover a stranger's package → adapt it →
suggest back) that Phase 5 built same-owner-only. Exit (goal.md §6): a stranger
finds a package via the portal (or Google), previews it, and starts an adaptation.

**Prerequisites in place:** published packages + `/portal` index + gated
register/unregister (M7, migration 0004); accessibility badge
(`portal_registrations.accessibility_status`, M14.2); the adaptation engine
(M26–M28) — owner-agnostic at the contract/ops layer, only the RLS-crossing
plumbing is missing. **Entry prerequisite:** run the M20/M27/M28 live pass
(migration 0008 already applied) before cross-owner suggest-back/pull run against
real repos.

**Sequencing (per the post-Phase-5 coherence pass):** LRMI first (smallest, most
decoupled), then the cross-owner path (unblocks the portal's headline action),
then the search UI over it, then governance scaffolding.

### M30 — LRMI / schema.org `LearningResource` markup *(leading; decoupled)*

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 30.1 | Emit LRMI/schema.org `LearningResource` JSON-LD in published pages (rides `buildCourseSite`) | published pages carry valid `LearningResource` metadata (title, description, license, educational level, a11y); validates in a structured-data tester | ✅ renderer `learningResource`/`learningResourceJsonLd` (pure; license URL from contract `licenseUrl`; a11y hints only on a `pass`; `<` escaped) + `themedDocument` `headHtml` + `buildCourseSite` `meta` injects it on the index; web `site-actions` passes manifest-derived meta. 4 renderer tests. **Needs a structured-data-tester pass on a published site** |
| 30.2 | Portal index consumes the same standard metadata (no proprietary record) | the portal reads LRMI, not a bespoke format | ✅ `/portal` emits a schema.org `ItemList` of `LearningResource` (built from `portal_registrations` via the same `learningResource` builder) — the discovery hub is itself harvestable, no bespoke record |

### M31 — Cross-owner adaptation & suggest-back *(absorbed Phase-5 deferral; the real ecosystem)*

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 31.1 | Adapt a package you don't own (from the portal) — **public GitHub read** of a registered package → adapt into your workspace with lineage | a stranger's published package adapts in with `adaptedFrom` + attribution + license gate | ✅ groundwork `adaptGivenBlocksInto` (decouples source-read from target-write); github-bridge tokenless `fetchPublicRepoFile` (raw.githubusercontent — no RLS bypass, no token); web `adaptFromPortalAction` (gated on portal registration; reads alembic.json + first chapter; license-gated) + `listPortalAdaptSourcesAction`; AdaptPanel "From the portal (other educators)". Adapts the source's first chapter |
| 31.2 | Cross-owner suggest-back via a dedicated `suggestions` table (RLS: insert by any signed-in user targeting a registered package; select/resolve by the owner) | a suggestion from an adapter reaches a different owner's inbox; owner accepts → applies to their block | ✅ migration `0009_suggestions.sql` (RLS — consent = registration; owner-only resolve; **no service-role bypass**); `lib/suggestions`; `suggestBackAction` routes same-owner→review-queue vs cross-owner→suggestions inbox (via `getPackage` ownership check); `listIncomingSuggestionsAction`/`resolveSuggestionAction` (accept applies via `saveStudyGuide` + sync); `SuggestionsInboxPanel` (Review group). Migration 0009 applied |
| 31.3 | *(optional)* GitHub-PR materialization of a suggestion (bridge `createPullRequest`) | a suggestion can become a PR on the upstream public repo | ⏸ deferred (external) |

### M32 — Searchable portal

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 32.1 | Search + facet filters over the portal index | filter by text + discipline + license + accessibility; result count shown | ✅ `PortalBrowser` client component (search over title/description; discipline/license/accessibility facets, client-side over the small index); `/portal` page split into server (data + LRMI JSON-LD) + this browser. Quality indicators: license chip + a11y badge. **level / artifact-type / teaching-time facets need richer registration metadata** (follow-up) |
| 32.2 | Adaptation entry point wired to M31 | a listed package leads to adapting it | ✅ each result has "Visit site" / "Source" + an "Adapt →" link to the workspace, where the M31 AdaptPanel lists portal sources to adapt. (A one-click portal→adapt-with-preselected-source is a follow-up.) |

### M33 — Governance scaffolding

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 33.1 | ~~Registration limited to study participants~~ → **open to all educators** | any signed-in educator with a published, gate-passing package can list | ✅ **gate removed** (pilot UI/UX pass): `registerPackageAction` no longer checks eligibility; listing requires only GitHub-published + Tier-3 gates. The `portal_eligible` column + `/admin` toggle + `setPortalEligibleAction` were deleted (migration `0013` drops the column) |
| 33.2 | Reporting + takedown path | anyone can report a listing; operators review; takedown removes the listing | ✅ `portal_reports` table (RLS: insert by anyone, read by operators only); `reportPackageAction` + a "Report" control on portal cards; takedown = owner unlist or operator removal. Procedure in [specs/portal-governance.md](specs/portal-governance.md). In-app admin UI is Phase 7 |

*Exit:* ✅ during the grant, only participants list; the public can report; a
documented takedown path exists. **Completes the Phase-6 core (M30–M33).**
Full moderation + open registration + stewardship handoff are Phase 8.

## Phase 7 sub-modules (v0.9 — research operations & study readiness)

**Goal:** make Alembic a credible IUSE research instrument — a complete event
taxonomy, de-identified export for evaluators, centrally-managed AI credits, and
an admin/ops module. Exit (goal.md §7): onboard a participant cohort with uniform
AI access and produce clean exportable research data.

**Already in place (Phases 1–6):** a broad `research-events` taxonomy (authoring,
AI accept/reject/edit with **Tier-1 logged separately** from human decisions —
M10.5; reuse events `adaptation.completed`/`upstream.update.applied`/
`suggestion.sent`); per-user **token budget** + governed `ai_invocations` logging
(M16.3); append-only `research_events` (user-insert-only RLS; export is
admin/service-role). Remaining is export + admin + institution-level credits +
managed mode + the FERPA/IRB data-handling review (M16.4).

**No worker tier needed** (export = pure transformer; admin = read views; quotas
= logic). The org-installed-App managed mode (M37) is the external/heavier piece.

### M34 — Event taxonomy + de-identified export *(durable core first)*

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 34.1 | Confirm/extend the event taxonomy for study completeness (reuse, completeness, workload indicators) | the events needed for the study's metrics exist (or are added additively) | ✅ reviewed — broad coverage: authoring (create/edit/save w/ `durationMs` workload signal), AI accept/edit/reject with **Tier-1 logged separately** from human decisions, reuse (`adaptation.completed`/`upstream.update.applied`/`suggestion.sent`), a11y, import, agent, reconcile, leak, export. Additive if a specific study metric is missing |
| 34.2 | Pure de-identification + CSV/JSON serialization of `research_events` (stable participant pseudonym; never GitHub identity/content) | a row set exports to de-identified CSV + JSON; same user → same code; no raw user_id | ✅ research-events `deidentifyEvents` (caller injects a salted one-way `pseudonymize`, so the package stays dependency-free + the salt never lives there; drops raw user_id/package_id) + `eventsToCsv`/`eventsToJson` (RFC-4180 escaping). 5 tests (13 research-events total after M36). Download wiring lands in the M35 admin module |

### M35 — Admin / operations module

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 35.1 | Admin gate (`profiles.is_admin`) + service-role behind it | a non-admin is redirected; an admin reaches `/admin`; cross-user reads use the service role only after the gate | ✅ migration `0011` (`profiles.is_admin`); `lib/admin.requireAdmin` (checks own profile via user client, then hands out a service client); `lib/supabase/service` (service-role, server-only); "Admin" header link for admins |
| 35.2 | De-identified research export download | admin downloads CSV/JSON of de-identified events | ✅ `GET /admin/export?format=csv\|json` — service-reads `research_events`, applies the M34 `deidentifyEvents` with a salted one-way `exportPseudonymizer` (RESEARCH_EXPORT_SALT) |
| 35.3 | Status, error monitoring, consent/status flags + report review | admin sees counts + recent errors; resolves `portal_reports` | ✅ `/admin` page: package/registration/event counts, recent `error.surfaced`, open-report resolve/dismiss (the Phase-6 deferred admin UI). Participant eligibility toggle removed (listing is now open to all); demo-content management is a follow-up |

### M36 — Centrally-managed AI credits & quotas

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 36.1 | Usage visibility (admin dashboard over `ai_invocations`) | admin sees total tokens/calls, by task, top participants — never prompts/outputs | ✅ research-events pure `summarizeUsage` (totals + by-kind + by-user, token-only; 4 tests) + an "AI usage" section in `/admin` (service-reads token columns only) |
| 36.2 | Centrally-managed credits + consistent access | uniform per-user budget + gateway routing across the cohort | ✅ already delivered: per-user **token budget** (M16.3, `AI_TOKEN_BUDGET`) enforced uniformly + provider-swappable gateway/routing (M16) + governed logging. **Per-institution** grouping is a follow-up (needs an institution model) |
| 36.3 | FERPA/IRB third-party data-handling review (M16.4) | a per-deployment review record exists | ✅ [specs/data-handling-review.md](specs/data-handling-review.md) — what the AI path touches, gateway retention/region/FERPA/IRB checks, a per-deployment decision table. Mechanism built (owner-insert-only log, admin-only export, de-identified research export); the review itself is a per-deployment operator/PI action |

### M37 — Institution / workshop-managed mode *(⏸ deferred post-pilot)*

Org-installed GitHub App; bot commits authored as the educator; uniform managed
AI access for a cohort. **⏸ Deferred to post-pilot** (user decision, 2026-06-17):
heavy/external (org-level App install + bot-as-educator attribution), and best
shaped by what the pilot actually needs. Uniform managed AI for a cohort is
already covered by the per-user budget + gateway (M16/M36); the org-install piece
is the deferred part.

## Phase 2 deferred follow-ups (tracked)

Built milestones above carry ⏸/🔄 sub-rows where a slice was deliberately
parked. Consolidated here so nothing is lost (none is actively in progress):

- **Worker tier** (gates several): real `.md.pdf` generation (Chromium/paged.js,
  M13.3) and foreign-format import parsers — Word/PDF/PPTX/images (M12.2).
- **Studio carrier editing + local projects** (M17 v1.5 / v2): structure/plot/
  slide editing in `/studio` (needs storage-agnostic editor save callbacks);
  `LocalPackageStore`/`PackageOps` over a directory; the client-capability audit
  (Web Crypto hashing).
- **Snapshots depth** (M15): GitHub compare/restore (15.2), Zenodo DOI (15.4),
  `adaptedFrom.snapshot` (15.5 — lands with the adaptation phase).
- **AI gateway depth** (M16): per-institution quotas + usage dashboards (16.3);
  the third-party data-handling/FERPA review (16.4, ops — see
  [ai-architecture.md](specs/ai-architecture.md)).
- **Concepts/objectives** (M9.6): chapter-scope editor UI + objective↔block alignment recording later (course-scope ops + editor + map→study-guide + map→agent are shipped).
- **Smaller correctness follow-ups** (prose-only until now, tracked here):
  - per-chapter `.md.html`/`.md.pdf` export (today the export covers the active chapter; the no-lock-in build concatenates chapters);
  - **asset alt-text persistence** so re-inserting an existing asset isn't `![]()` (currently empty alt on re-insert — an a11y gap);
  - **Agent Skill generation** from the kind registry (`validate()` shipped; the skill doc + npm-tarball packaging, orz gaps #2/#3, remain);
  - **asset rename/move** reference-rewrite helper (see [carriers-and-assets.md §11](specs/carriers-and-assets.md));
  - published-site `materials/…` path resolution at build time.
- **Per-kind display & editing UX** revision (demo-adequate now) — see [carriers-and-assets.md §11](specs/carriers-and-assets.md).

## Log

### 2026-07-06
- **R2 verified live by the owner** — after the v1-path registration fix
  (`901a8ed`: dual-mode `spaceForFilePath`, per-file rebuild resilience,
  logged guard), a fresh package registers correctly: `documents` rows appear
  with spaces `metadata` / `study-guide` / `private`. Phase 1 (Module R core)
  is confirmed end to end in production.
- **P1 landed: the thin `/d/{docId}` permalink resolver** (`99018e9`).
  ID-based over the registry (links survive rename/move); tombstone 410;
  private = owner-only via session RLS; public GitHub platform-served with
  correct MIME (raw GitHub is internal transport only); trial served from the
  sandbox; `@{version}` pins serve when they match the current hash (older
  pins arrive with R3), immutable caching + CORS for public objects. Guard
  paths verified against dev; **owner smoke test pending: open
  `/d/<a doc_id from the documents table>` in a browser** (signed-in for
  private rows; service key enables anonymous public access).
- **P2 landed: "share this" + Discover's Elements scope** (`006c237`).
  Per-file discoverability toggle in the Assets pane (owner-only; objects
  require a description first; private/current never shareable) with
  Copy-permalink / Unshare; Discover's Elements chip is live
  (`/portal?scope=elements`), listing every explicitly shared file via the
  service client (graceful message when `SUPABASE_SECRET_KEY` is unset —
  **setting it on Vercel is what turns on anonymous permalinks + element
  search**). The start-small story now works end to end: draw a figure →
  Share this → appears on Discover → anyone opens it by permalink.
  **Owner smoke test:** share an asset from the Assets pane, see it on
  `/portal?scope=elements`, open its permalink. Next: P4 file-level
  adaptation, or E3 study-guide switchover.

### 2026-07-06
- **P4 landed: file-level object adaptation** — copy a shared object
  (structure/plot/figure) from another package into yours **by permalink**,
  carrying `adaptedFrom` lineage. Durable core (all unit-tested): `registerFile`
  gains an `adaptedFrom` input (set once at the adapting registration, then
  preserved by every projection rebuild); `adaptAssetInto` (package-ops) does a
  license-gated (`canAdapt`) **byte-for-byte** copy under `materials/adapted/`
  (dedup on name collision), writing only the public target (two-repo
  invariant). App: shared `fetchDocBytes` helper (extracted from the `/d/`
  resolver, now used by both); `registerAdaptedFile` stamps the lineage and
  returns the new docId; `adaptElementAction` (owner-gated; source must be a
  public **object** that is shared or owned; cross-owner reads via the service
  client; content-hash dedup returns the existing permalink instead of
  duplicating). Thin client: an **Adapt…** control in the Assets pane (paste a
  shared `/d/…` link → copies it in, refreshes). The copy gets its **own**
  permalink (content identity is per-package) and is itself shareable/
  re-adaptable. +9 durable tests (license block, verbatim copy, dedup,
  non-object rejection, lineage set-on-register + preserved-on-rebuild +
  distinct-docId-cross-package). Green (typecheck + full test + web build).
  **Owner smoke test:** in a package's Assets, click **Adapt…**, paste a shared
  element's permalink from Discover, confirm it appears with a new permalink and
  that a rejected (license-incompatible) source shows a clear message.
- **P4 Discover-side "Adapt into my package"** — each Discover → Elements row now
  carries an **Adapt →** control for a signed-in educator: pick one of your
  packages from a dropdown, and the shared object is copied in (reusing the same
  `adaptElementAction` durable path — source is discoverable, target is owned).
  Signed-out visitors (or those with no packages) see no control; RLS scopes the
  package list to the owner. New client `portal/element-adapt.tsx`; `ElementsList`
  fetches the session user's packages. Two entry points now cover the loop:
  permalink-paste inside the workspace Assets pane, and one-click from Discover.
  Green (typecheck + web build; Discover page renders clean in preview).
- **E3a landed: study-guide editing switches to the hosted `.md.html` in-file
  editor** (owner decision: **lean-source model** — the committed source of
  record stays markdown `study-guide/NN.md`; the self-contained `.md.html` is
  generated on demand purely as the editing surface, never committed). Flow: the
  content pane generates the chapter's `.md.html` via the worker
  (`generateEditableFile`, worker-only — the in-process fallback has no in-file
  editor), hosts it through the existing dormant `hostedCarrierModule`/
  `ModuleMount`/`orz-host-save` machinery (E1), and on save persists the
  **extracted markdown** back through `saveStudyGuideAction` (block-ID
  validation + reconcile-first GitHub sync intact). New `hosted-actions.ts`
  (`generateChapterHtmlAction` → `{editable, html}`; `hostSaveStudyGuideAction`
  → parse + delegate). The block editor (`ContentEditor`) is **kept as a
  graceful fallback** when no worker is configured or generation fails, so
  editing never breaks (e.g. local dev without `WORKER_URL`). Verified via all
  three orz builds emitting `orz-host-save` in `app.js`, so generated files
  answer the handshake. Green (typecheck + full test + web build). **Owner
  smoke test (needs the deployed worker):** open a chapter's **Study guide**,
  confirm the in-file pencil editor loads, edit a section, use the file's own
  save, and confirm the change persists (reopen the chapter).
- **E3b/E3c landed: slides + paged as hosted derived views** (owner decision:
  **derived views for now**, kept flexible). Slides (`.slides.html`) and paged
  (`.paged.html`) generate from the chapter's study guide on demand
  (`generateChapterViewAction`: slides via `slidesSourceFromBlocks`, paged via
  the chapter markdown) and mount in-shell through the same
  `hostedCarrierModule`/`ModuleMount` machinery for presenting / printing. New
  **Print / handout** category (`paged`) added to the rail (UI only — **no new
  space**; the v2 space set stays closed per rule 9). The study guide is the
  single authored source; a `HostedChapterView` `hostSave` stub returns an
  honest "edit the chapter to change this; use Download to keep a copy" message
  — **that stub is the single seam** to make slides/paged independently
  *authored* later (swap it to persist a committed per-document source; the
  generate+host rails stay identical). Uses the worker-or-fallback builder (a
  viewable file suffices; only hosted *editing* needs the protocol) — slides
  render even without a worker; paged shows a "needs the worker tier" note.
  Green (typecheck + full test + web build). **Owner smoke test:** open a
  chapter's **Slides** and **Print / handout** categories; confirm the deck /
  print view renders from the study-guide content. E3 now covers all three
  formats.
- **E3d landed (2026-07-09): Slides are now an AUTHORED document** (owner
  decision — the E3b seam above was activated). Slides moved from a derived view
  to a first-class per-chapter document in the **`slides` space** (activated in
  `PACKAGE_LAYERS`; the v2 space already existed): committed source of record is
  the orz-slides deck markdown at `slides/<slug>.md` (package-ops
  `chapterSlidesPath`/`loadSlidesDeck`/`saveSlidesDeck` — deck saved verbatim
  through the validated write path; two-repo + public-reference guards still
  gate it). A new **`HostedSlidesEditor`** hosts orz-slides' in-file editor
  (`ModuleMount kind="slides"`) with a persisting `hostSaveSlidesAction`;
  `generateSlidesHtmlAction` seeds a fresh chapter's deck from a **minimal
  scaffold** (`slidesTemplate`: deck config with NO baked-in `theme:` + a
  `template=title` slide + two content slides + a `template=closing` slide,
  matching orz-slides' own `examples/demo.md` shape pared down), then it is
  authored independently — not derived from the study guide (that seed source
  was tried first, then replaced per owner direction: fresh slides should start
  minimal, not import guide content). Deck format bug fixed:
  `slidesSourceFromBlocks` (still used by the legacy renderer path) now emits
  orz-slides grammar (`<!-- slide -->` markers + `## title`) so decks render
  correctly wherever it's used. Slides carry their **own theme** (orz-slides
  theme ids in `manifest.themes.slides`, independent of the course reading
  theme — the *same last-write-wins global mechanism as the study guide*),
  captured on save (`hostSaveSlidesAction` → `setCourseThemeAction(…, "slides")`)
  and applied at generation/publish; the deck template deliberately omits a
  baked-in `theme:` so the global setting always wins. The in-file **AI
  assistant** (three universal aids + `suggest-slide-layout`) rides the
  `orz-host-ai@1` bridge, scoped to the **current slide's buffer** (per-slide,
  not whole-deck — acceptable for now per owner; a whole-deck mode is a small
  follow-up in orz-slides if wanted later). Publish only emits a chapter's
  `.slides.html` when it has an authored deck (no auto-derived fallback). The
  dead `HostedChapterView` (derived slides/paged) was removed; paged has no
  rail entry (Print/handout was deleted earlier; paged is slated to serve
  Assets/Private/Current next). Green (typecheck + full test + web build).
  **orz-slides 0.6.0 released** (npm + GitHub, 2026-07-09: `orz-host-ai@1` +
  `theme` in the save message, ported from orz-mdhtml 0.7.1 — 54/54 upstream
  tests, sample deck regenerated); `packages/generators` bumped
  `orz-slides` `^0.4.0`→`^0.6.0` and reinstalled; **Fly worker redeployed**
  (2026-07-09).
- **Bugfix: slides generate/save 500'd in production.** Root cause: the
  hosted-editor round trip (generate the editable file, then save
  `{source, rendered, theme}` back) carries the FULL self-contained document
  through a Next.js Server Action, which caps the body at 1 MB by default.
  Study guide's inline orz-mdhtml bundle (~0.84 MB, measured) stays under that;
  orz-slides' inline bundle (reveal.js + orz-markdown + themes, ~1.03 MB even
  for a near-empty deck) doesn't — every slides generate and save 500'd, while
  study guide happened to work purely by staying under the cap. Fix: set
  `experimental.serverActions.bodySizeLimit: "10mb"` in
  [next.config.ts](../apps/web/next.config.ts) for headroom as decks grow and
  orz-paged joins this path.
- **Simplified the hosted-editor save payload** (`rendered` was always dead
  weight — Alembic never persists it, the editable surface is always
  regenerated server-side from `source`): `hostSaveStudyGuideAction` and
  `hostSaveSlidesAction` now take `{source, theme?}`, not
  `{source, rendered, theme?}` — this alone shrinks a slides save from >1 MB to
  a few KB, independent of the body-size bump above (which still covers the
  one-time generate/load response). For slides specifically, theme is no
  longer a meaningfully separate concern either: the deck's own leading
  `<!-- deck ... -->` config block already states its theme, and **orz-slides'
  theme picker now rewrites that line back into the deck source on every
  pick** (`rewriteDeckTheme` in `assets/app.js`, orz-slides — previously
  `setTheme()` only set a runtime variable + DOM attribute, so a picked theme
  never reached the saved source; verified live in a real browser: pick a
  theme → the embedded `<script id="orz-deck">` island AND the open "deck
  settings" CodeMirror buffer both update immediately). `saveSlidesDeck`
  reads theme straight out of the just-saved `source`
  (`deckThemeFromSource`, `@alembic/renderer`, 4 new tests) — `payload.theme`
  is kept only as a fallback for decks saved by a pre-write-back orz-slides
  build, so nothing breaks mid-rollout. mdhtml keeps its separate `theme`
  field (its theme lives in the regenerated `<html data-theme>` shell, not in
  the extracted markdown — genuinely nothing to parse). Paged likely has the
  same inline-config shape as slides (owner: "paged does have all settings in
  source code") and could follow the same pattern once activated.
  **orz-slides 0.6.1 released** (npm + GitHub, 2026-07-09) and wired in
  (`packages/generators` bumped `^0.6.0`→`^0.6.1`, reinstalled); **Fly worker
  redeployed**. The theme picker's source write-back is now live end-to-end —
  the `payload.theme` fallback stays in place (harmless, cheap) as a safety
  net for any deck saved before this rollout.
- **Coherence audit (2026-07-09, two parallel agents) surfaced a real gap:
  authored practice questions never reached the published site.** The
  publish pipeline's "Practice" section still read from the pre-authored
  `listArtifacts()` derived-worksheet system (M13-era), whose only UI entry
  point (`ArtifactView` in studio-shell) had already gone unreachable once
  slides/practice became authored documents — so a course could have a full
  practice-questions section written in the workspace and publish with an
  **empty or absent Practice area**, silently. Same audit flagged the whole
  worksheet/derived-slides-artifact system as substantially dead code (see
  cleanup entry below), plus doc drift covered further down.
- **Public site redesign (S — course home page, 2026-07-09).** Fixed the gap
  above and rebuilt the published home page around it:
  - **Practice publish fix.** `site-actions.ts` and `/site-preview` now
    generate each chapter's `.md.html` from its authored `practice/<slug>.md`
    (present only if that chapter has one) instead of the old artifact
    system; `CoursePractice`/the flat "Practice" section is gone —
    `CourseChapter` gains `practiceHref` alongside `slidesHref`/`pagedHref`,
    matching how practice is actually authored (per chapter, not a
    course-wide list).
  - **Course-identity fields.** `manifest.courseContext` gains `instructor`
    / `courseNumber` / `department` (additive; the field existed but had
    zero UI or readers before today) + a "Course details" form in the
    course-description pane (`setCourseInfoAction`).
  - **Home page rebuilt** (`packages/renderer/src/course-site.ts`, via the
    impeccable skill, register: brand): a hero (title + instructor/course
    number/department + description) and a numbered module list per chapter
    (study guide always; slides/practice links only when that chapter
    authored one), plus a placeholder "This term" section (the `current`
    collection isn't finalized). **Revised same day, owner correction:**
    the first pass reused the vendored dark-elegant/light-academic CSS
    verbatim, reasoning the home page was "the front door to documents
    already styled that way" — but study guide/slides/practice each carry
    their *own* independently-selected theme per category (any orz-mdhtml
    theme for study guide/practice, any orz-slides theme for slides — never
    clamped to just two; confirmed by tracing `site-actions.ts` →
    `worker-client.ts` → the worker → the real `orz-mdhtml`/`orz-slides`
    packages, no coercion at any hop), so there's no single content theme
    left for the home to coherently "belong to." The home now carries
    **Alembic's own identity** (`homeCss` — the same copper-accent,
    Source-Serif-4-over-system-sans tokens as the workspace app, from
    `DESIGN.md`), a genuinely independent light + dark pair (not one of the
    orz-markdown/orz-slides built-in themes), auto-picked from the study
    guide's scheme via the existing `themeScheme()`/`hubScheme` plumbing
    (unchanged). `document.ts`'s `themedDocument` gained a `css` override
    param (additive) so a caller can supply its own full stylesheet instead
    of the vendored orz theme CSS. Verified live in both themes + empty
    state + mobile (375px) via real browser screenshots (a scratch static
    server + the Preview tools, `buildCourseSite` called directly with
    representative data) — caught and fixed a genuine overflow bug (a long
    course title clipping at narrow viewports) and a CSS-specificity miss
    that left module titles underlined against intent.
  - **`/site-preview` revived**: fixed (same practice/slides checks as
    site-actions.ts) and relinked from the workspace via a new "Preview
    site" control in the publish header (previously orphaned — no link
    anywhere reached it).
  Green (typecheck + full test + web build; 4 new `course-site` tests for
  the meta line/numbering/current-term, plus a `deckThemeFromSource`-style
  regenerated-samples check for the home page).
- **Course-home footer credits + Alembic homepage footer link (2026-07-09).**
  The published course-home footer ("Published with Alembic") now links to
  `alembic.orz.how`; a new "Powered by orz-markdown" credit links to
  `markdown.orz.how`. Both are preceded by the orz family seal — the same
  asset already used in the workspace app's own header
  (`apps/web/public/orz.svg`), inlined once as an SVG `<symbol>` and
  referenced via `<use>` from both credits (never hotlinked — the published
  page stays fully self-contained). Separately, Alembic's own homepage
  footer (`apps/web/src/app/page.tsx`) got the matching fix — its
  `orz-markdown@<version>` credit now links to `markdown.orz.how` too — and
  **`PACKAGE_SCHEMA_VERSION` bumped 1→2** (owner decision; new packages are
  now stamped `schemaVersion: 2`, so the same footer's "package schema v1"
  became "v2"). This is a **label bump only**: `spaces.ts`/`isV2Manifest`
  still aren't wired into any live write path — `package-ops` validates and
  writes through the v1 layer model (`layers.ts`) unconditionally regardless
  of `schemaVersion`; a real v2 activation (switching the write path over)
  remains a separate, larger migration. Old v1 packages are unaffected and
  keep parsing exactly as before (`SUPPORTED_SCHEMA_VERSIONS` still accepts
  both). `manifest.test.ts`'s schema-version tests updated to match (one now
  explicitly constructs a literal `schemaVersion: 1` manifest to keep testing
  real v1 backward-compat, rather than relying on the shared fixture, which
  now stamps the current default). Green (typecheck + full test + web build).
- **Footer consolidated to one icon + a dot separator, links open in a new
  tab (2026-07-09).** Course-home footer restructured from two icon+link
  pairs to a single shared orz mark (`<use href="#orz-icon"/>`, still just
  one inlined `<symbol>`) in front of both credits, separated by
  `<span class="sep">·</span>`; both links and Alembic's own homepage
  `orz-markdown` credit now carry `target="_blank" rel="noreferrer"`. Fixed a
  collateral test failure (`course-site.test.ts`'s course-meta-line
  separator check was matching the whole page, which now always contains the
  footer's own separator — rescoped to just the `<p class="course-meta">`
  substring). 44 renderer tests green.
- **Published slides were blank in production — root cause: `orz-slides` and
  `orz-slides-browser` fell out of lockstep on npm (2026-07-09).** orz-slides
  ships two packages that must publish together at the same version: the
  main package and `-browser` (the prebuilt in-browser engine, loaded from
  jsDelivr for `delivery:'cdn'` — the mode the published site uses).
  Earlier work this session bumped and published `orz-slides` to 0.6.0 then
  0.6.1, but never published a matching `orz-slides-browser` — it was still
  live at npm's old `0.4.0`, so every published `.slides.html` requested a
  nonexistent `orz-slides-browser@0.6.1/orz-slides.browser.js` (404), leaving
  the deck engine undefined. The static HTML/CSS toolbar (pencil icon) still
  rendered since it has no JS dependency, matching the reported symptom
  exactly. **Fixed**: rebuilt the bundle, bumped `browser/package.json` to
  `0.6.1`, and published `orz-slides-browser@0.6.1` to npm/jsDelivr.
  Cross-checked orz-mdhtml (the study guide's own CDN path) for the same bug
  class — false alarm on my end (wrong assumed filename,
  `orzmd.browser.js` is correct, not `orz-mdhtml.browser.js`) but confirmed
  actually healthy at the already-published `orz-mdhtml-browser@0.7.1`.
  Verified end-to-end: generated a real CDN-mode deck from the fixed
  packages and drove it through a real browser (Preview tools) — deck
  renders, edit pencil opens a working CodeMirror editor with a functional
  theme picker. **Lesson applied to orz-paged in the same audit pass**: its
  local `0.5.0` (agent-guide) bump is uncommitted-to-npm by design, not an
  oversight — the commit itself says "held from npm until page-wide AI +
  theme-in-save land here" (same as line 58's note above), and the currently
  *published* `orz-paged`/`orz-paged-browser@0.4.0` pair is in sync with
  each other and CDN-verified (200, correct file), matching
  `packages/generators`' `^0.4.0` pin — no action needed there.
- **Course details card gains description + tags; the old free-text editor
  becomes "Course concept map" (2026-07-09, owner decision).** Reworks
  the split introduced earlier the same day (fullDescription/clamp): the
  "Course details" card (Instructor/Course number/Department) now also
  has **Course description** (one paragraph, plain text, soft-capped at
  200 words — `manifest.description` is directly authored here, no
  longer derived from a markdown file) and **Tags/keywords**
  (comma-separated → `manifest.keywords: string[]`, additive). Both feed
  the published home page, Discover/portal, and LRMI JSON-LD (`keywords`
  added to `learningResource()`). The section that used to be titled
  "Course description" (full markdown, Source/Preview, AI) is **renamed
  "Course concept map"** and repurposed: free-form notes — concepts/
  topics, correlations, course-level learning objectives, any structure —
  that **never** reach the published page or Discover (confirmed by
  removing the `fullDescription` wiring added earlier the same day, and
  by a `setCourseConceptMap` test asserting it never touches
  `manifest.description`/`keywords`). Same file path
  (`metadata/course.md`) and save mechanics, renamed for clarity
  (`COURSE_DESCRIPTION_PATH` → `COURSE_CONCEPT_MAP_PATH`,
  `setCourseDescription`/`loadCourseDescription` →
  `setCourseConceptMap`/`loadCourseConceptMap`, actions renamed to match).
  Removed the now-incoherent `draft-description` AI op (drafting "the
  course description from title + chapters" no longer has a home — the
  new description field is a plain manual field, and the concept map
  isn't a course blurb) along with its sole implementation,
  `@alembic/ai-assist`'s `generateCourseDescription`/
  `COURSE_METADATA_SYSTEM` (both fully unused after removal — deleted
  rather than left dead). The `generate-concept-map` op stays
  `status:"planned"` (unrelated, deferred, structured-data feature) but
  is now a coherent fit for this section once built. Caught mid-build: a
  `"use server"` file may only export async functions — an
  `export const COURSE_DESCRIPTION_MAX_WORDS` broke the *entire*
  `metadata-actions.ts` module ("has no exported member") until made
  module-private. Verified live: generated a real published-page sample
  with `*asterisks*` and `&` in the description and confirmed they render
  as literal escaped text (not markdown `<em>`), and that `keywords`
  reaches the LRMI JSON-LD. Green (typecheck across all 13 workspaces +
  full test suite + web build). Not done: no DB migration to surface
  `keywords` in the Discover/portal search UI itself (LRMI-only for
  now) — flagged, not built, out of scope for "add the field."
- **Course home: expandable description (2026-07-09, owner report).** [Superseded same day, above — the fullDescription/concept-map split it introduced was reworked into the description+keywords/concept-map design.] The
  published course home only ever showed `manifest.description` — a
  short, truncated LRMI/portal derivation (first paragraph, 300 chars) —
  as the visible intro, with no way to read the rest. `buildCourseSite`
  gains `fullDescription` (the canonical `metadata/course.md`, loaded via
  `loadCourseDescription` and threaded through both `site-actions.ts`
  publish and `/site-preview`); it's now what renders, clamped to ~5
  lines with a bottom fade and a "Show full description" toggle that
  reveals the rest (`manifest.description` still feeds LRMI/portal
  unchanged — that use case genuinely wants short). **Two rounds of real
  browser verification caught real bugs a unit test alone would have
  missed**: (1) the first CSS approach (`-webkit-line-clamp`, a legacy
  flexbox display mode) doesn't compose reliably with the
  `scrollHeight`-vs-`clientHeight` overflow check used to decide whether
  the toggle should even appear — confirmed live, it showed the toggle
  for a genuinely one-line description. Switched to a plain
  `max-height`/`overflow:hidden` clamp, which gives a fully reliable
  comparison. (2) The overflow check running synchronously in an inline
  `<script>` raced the page's own layout/paint — confirmed by a transient
  0-width/mis-measured read immediately after navigation — so it now
  waits for `load` + one `requestAnimationFrame` before measuring.
  Reverified in a real browser after both fixes: long descriptions clamp
  correctly with the toggle appearing and expanding/collapsing on click;
  short ones never show a toggle at all; confirmed at both desktop and
  375px mobile widths. 3 new renderer tests. Green (typecheck across all
  13 workspaces + full test suite, 56 renderer tests + web build).
- **Fixed inconsistent slide themes across a published course's chapters
  (2026-07-09, owner report).** Root cause: orz-slides always prefers a
  deck's OWN embedded `<!-- deck ... theme: X ... -->` config over the
  `theme` option a caller passes in (`deck.config.theme || opts.theme ||
  'paper'`, confirmed in orz-slides' `lib.ts`) — by design for orz-slides
  as a standalone tool, but it defeats Alembic's course-wide
  `manifest.themes.slides` default: only chapters whose deck was itself
  saved *after* the instructor last picked a theme get it; every other
  chapter's deck keeps whatever it had baked in from whenever it was last
  touched, so published slides render inconsistently across chapters.
  Verified directly against the real `orz-slides` package (not just a
  string-rewrite unit test): the same deck + `opts.theme:'architect'`
  rendered `data-theme="paper"` before the fix and `data-theme="architect"`
  after. **Fixed** with a new `withDeckTheme(source, theme)`
  (`packages/renderer/src/slides.ts`, companion to `deckThemeFromSource`):
  rewrites/inserts the deck config's `theme:` line to force the course-wide
  default, applied to the **in-memory** copy right before generating —
  never persisted back to the chapter's own committed `slides/NN.md`, so
  re-picking a theme *in that specific deck* still writes back exactly as
  before. Wired into both `site-actions.ts` (publish) and
  `hosted-actions.ts`'s `generateSlidesHtmlAction` (the editing/preview
  surface), so what an educator sees while editing now always matches what
  publishes. 4 new renderer tests. Green (typecheck across all 13
  workspaces + full test suite, 54 renderer tests + web build).
- **Adopted the owner's proposed authoring convention: "# Title" then "##
  Section" (2026-07-09).** Following up on the gate false-negative below —
  `parseStudyGuide`'s design already anticipated an optional leading H1
  (its own doc comment: preamble "may be ... e.g. an H1 chapter title"),
  so no parser or gate change was needed, just the starter content. Traced
  one real risk first: `renderDocument`/`renderPlainDocument`
  (`packages/renderer/document.ts`, the **preview**-only path — confirmed
  the actual published `.md.html` never auto-inserts a title, since
  orz-mdhtml's `template.ts` only uses `title` for the `<title>` tag, not
  a body heading) unconditionally prepended `<h1>{chapterTitle}</h1>`
  above the rendered source — if the source itself now opens with its own
  `# Title`, that would have doubled up. Guarded both functions to skip
  the injected heading when the source already starts with its own `#`
  line (new `document.test.ts`, 6 tests). Updated both starter-content
  generators to the new shape — `welcomeChapter()` (`create.ts`, the
  package's first/implicit chapter) and `seedChapter()` (`chapters.ts`,
  chapters added via "Manage") now open with `# {title}` before their
  first `##` section, instead of reusing the title as the section's own
  heading text. New tests in `create.test.ts`/`chapters.test.ts` pin the
  invariant that mattered here: seeded content always parses to at least
  one real block, so a fresh course/chapter clears the study-guide release
  gate immediately. Green (typecheck across all 13 workspaces + full test
  suite, 193 package-ops tests + 50 renderer tests + web build).
- **Root-caused the third symptom from the same report: a "study guide
  section" publish-gate false negative (2026-07-09).** Not a bug in the
  strict sense — `parseStudyGuide` (`package-contract/block-source.ts`)
  only treats text under a `##` (H2) line as a "section"; a single `#` is
  reserved for the chapter's own auto-rendered page title (chapter-mgmt
  overhaul, above). The owner's module opened blank (an old/pre-seed
  package — new packages seed `## Getting started…` via `welcomeChapter()`
  in `create.ts`) and they typed `# Module 01` — an H1, so `parseStudyGuide`
  filed it as unstructured `preamble`, not a block; the text saved
  correctly, it just didn't count as a "section." The real gap: nothing
  said so at save time, and the eventual gate message didn't mention heading
  level at all. Fixed two ways: (1) `saveStudyGuideAction`
  (`apps/web/.../actions.ts`) now returns a `warning` the moment a save
  produces zero blocks from non-empty preamble, wired into the block-editor
  fallback's (`ContentEditor`) UI; (2) the release-gate message
  (`release-gates.ts`) now spells out the `##`-vs-`#` rule. **Known
  limitation, not shipped**: the save-time warning does NOT yet reach the
  primary path — the **hosted** in-file editor (orz-mdhtml) — because
  `orz-host-save@1`'s ack (`editor-kit/host-save-client.ts`) only carries
  an `error` field on `ok:false`; a successful save's ack is bare
  `{ok:true}`, so a warning has nowhere to ride. Surfacing it there needs
  an additive protocol field plus an orz-mdhtml `app.js` update (cross-repo,
  version bump + republish + worker redeploy) — not done; the improved gate
  message is the fallback until that lands. Green (typecheck + full test +
  web build).
- **Two follow-on fixes from the same owner report, on "Chem 320" and a
  second, freshly-published course (2026-07-09).** (a) The "① Save to
  GitHub" control had no way to re-trigger once `manifest.publicRepo` was
  wiped by the split-brain bug below: `edit/page.tsx` computed `published`
  from `record.storage === "github"` alone, so the header showed the inert
  "Saved online" checkmark (no `href`, no `onClick`) instead of the
  actionable button — publishing looked unrecoverable even though clicking
  "Save to GitHub" would have safely self-healed it (deterministic repo
  names ⇒ 422-tolerant reuse, never a duplicate). Fixed: `published` now
  also requires `manifest.publicRepo` to be present, matching what the
  server actions actually check. (b) On a second course, saving the course
  description showed a "Saved." confirmation but the header's "● Unsaved"
  dot never cleared: `CourseHome`'s save handler (`studio-shell.tsx`)
  branched on whether the action's response included a `markdown` field to
  decide "was this a save or a fresh AI generation" — but
  `saveCourseDescriptionAction` echoes `markdown` back on **every**
  success, so every save mis-hit the "just generated, still unsaved"
  branch and set `dirty` back to `true` right after clearing it. That
  branch is dead code now anyway (AI generation applies through
  `AIAssistant`'s own `onApply`, not through this handler) — simplified to
  always clear `dirty` on a successful save. Still under investigation:
  the same report's third symptom, a "study guide section" publish-gate
  false negative on a chapter the owner says was saved — no root cause
  found yet by static tracing (`listChapters`/`loadStudyGuide`/the hosted
  editor's save path all read/write the same path consistently); needs a
  repro to pin down. Green (typecheck + full test + web build).
- **Fixed a manifest split-brain bug that silently unpublished live
  packages (2026-07-09, owner report on "Chem 320").** Editing the course
  description saved locally but wouldn't sync to GitHub, and "Update page"
  then failed with "Publish to GitHub first, then publish the website" —
  on a package that had already been published, with a live Pages site.
  **Root cause:** the trial-sandbox store keeps the manifest in **two
  places** that must stay identical — the `packages.manifest` DB column
  (read by `store.getPackage()`, what `site-actions.ts`/`github-actions.ts`
  check for `publicRepo`) and a mirrored `alembic.json` row in
  `sandbox_files` (read by every package-ops **file-based** write —
  course description, chapters, rename, adaptation — via
  `listFiles`/`readManifest`). Four call sites wrote the DB column directly
  without updating the `sandbox_files` mirror: `publishToGitHubAction`
  (sets `publicRepo`/`privateRepo` on publish), `setCourseThemeAction`,
  `setCourseInfoAction`, and `recheckA11yAction`. The next file-based write
  (e.g. saving the course description) then read the **stale**
  `sandbox_files` copy — missing `publicRepo` — merged in its own change,
  and wrote that stale-based manifest back to **both** stores, wiping
  `publicRepo`/`privateRepo` from the DB column even though the GitHub repo
  and its Pages site were completely intact. **Fixed**: added
  `mirrorManifestToSandbox` (`apps/web/src/lib/github.ts`) and call it from
  all four sites so the DB column and the sandbox file mirror can no longer
  diverge. **Recovery for already-affected packages** (no direct DB access
  from here to hand-repair the owner's live row): clicking "① Save to
  GitHub" again is safe and self-healing — `publishToGitHubAction` derives
  the repo names deterministically from the immutable `packageId` + title,
  so it hits GitHub's "already exists" 422 on both repos, reuses them
  (never creates a duplicate or touches existing content beyond
  re-committing `alembic.json`), and — with this fix — now also mirrors
  the recovered `publicRepo`/`privateRepo` into `sandbox_files`, so the
  package stays fixed. Green (typecheck + full test + web build); no
  apps/web test suite exists to pin this with a regression test (thin
  client, per rule 9 — the durable logic here is the two Supabase tables
  themselves, not covered by any package's test harness).
- **Dead-code cleanup: the worksheet / derived-slides-artifact system
  (2026-07-09).** Removed, after exhaustively grepping every symbol for
  live callers first: `ArtifactView` (studio-shell — confirmed never
  rendered), `slides-actions.ts` (`generateSlidesAction`), the
  `/workspace/[packageId]/artifact/[artifactId]` viewer + export route
  (both reachable only through `ArtifactView`), the `artifacts`/
  `chapterBlockIds` props threaded from `page.tsx` purely to feed it (a
  **wasted live query** on every Slides/Practice pane load —
  `listArtifacts()` walked and parsed every package file, plus a second
  `loadStudyGuide` call, for a UI path nothing rendered), `ai-actions.ts`'s
  `generateWorksheetAction`/`regenerateWorksheetAction`/
  `keepWorksheetMineAction`, and `package-ops/src/worksheets.ts` in full
  (`generateWorksheetArtifact`, `listArtifacts`, `loadArtifactContent`, …).
  `package-ops/src/slides.ts` trimmed to only the live authored-deck
  helpers (`chapterSlidesPath`/`loadSlidesDeck`/`saveSlidesDeck`); the
  derived `generateSlidesArtifact` half and its now-dead test file are
  gone. Dropped `listArtifacts` from the `packageOps()` facade (`ops.ts`)
  too — no caller through it either. Contract-level primitives
  (`DerivedArtifactRecordSchema`, `artifactRecordPath`, …) are untouched —
  verified `assets.ts` still depends on them for an unrelated, live
  feature. This resolves the naming-collision hazard the audit flagged:
  "slides" named three things and "practice" named two, any of which a
  future edit could land in by mistake. Green (typecheck + full test + web
  build; package-ops test count 200→191, the two deleted dead-code test
  files).
- **Docs coherence pass (2026-07-09)**, prompted by the same audit: fixed
  the banner above (was still asserting `.md.html` as the chapter's
  committed source of record, superseded by the lean-source model — see
  the still-open cross-doc drift note at the end of this file) and the
  orz-host-ai/AI-ops paragraph (was still calling the bridge "planned" for
  slides and saying orz-slides was "held from npm" — both live since
  0.6.1). `docs/specs/document-model.md`, `course-structure.md`,
  `package-contract-v2.md`, `package-layout.md`, `self-contained-editing.md`,
  and `ai-operations.md` still contain some of the same superseded claims
  (`.md.html`-as-source, "slides derived from the study guide") and were
  **not** individually rewritten in this pass — flagged, not fixed, at the
  end of this file so they aren't lost.
- **E3 bugfix: hosted editor showed blank + the pencil did nothing.** The
  hosted-carrier iframe sandbox was `allow-scripts` WITHOUT `allow-same-origin`,
  giving the file an opaque origin. But the self-contained file renders its
  preview into a NESTED iframe via `contentDocument.write` and lazy-loads its
  editor — both need same-origin, so under an opaque origin the file rendered
  blank and the edit toggle failed. Fix: add `allow-same-origin` (+ `allow-
  popups`) to the sandbox. Reproduced and verified in the preview against a real
  generated `.md.html`: opaque origin → blank; `allow-same-origin` → full
  render + working CodeMirror editor. Safe because Alembic GENERATES the hosted
  file from the educator's own source (trusted orz runtime); documented that on
  a `srcdoc` iframe `allow-same-origin` is the HOST origin, so hosting UNTRUSTED
  documents this way would instead need a separate content origin (follow-up if
  in-app preview of others' files is ever added).
- **E3 editing-shell coherence (increment 1).** With hosted editing live, the
  file's own **Save** (content) sat next to the header's **"Save to GitHub"**
  (which is really the publish/promote step, not a second content-save) — two
  "save" concepts. Fixes: (1) renamed the header control **"Save to GitHub" →
  "Save online"** ("Saved to GitHub" → "Saved online", tooltips reworded) —
  drops the dev term per the CLAUDE.md educator-language rule and reframes the
  header as *publishing*, distinct from the in-editor save; (2) a header
  **"● Unsaved"** chip driven by the lifted `dirty` state, so the in-editor
  save is the obvious content-save; (3) a **shell-level `useUnsavedGuard`** so
  navigating away warns for EVERY surface, including the hosted editors (which
  had no guard of their own); (4) a one-line hint in the hosted study-guide pane
  ("edit inline — changes save with the document's Save button; Save online
  publishes"). Green (typecheck + web build). **Remaining coherence** (later
  increments): the duplicate orz logo/theme chrome (needs the upstream
  `?embed=minimal`, deferred), pane sizing polish, and bringing concept-map /
  assessment-guide / private onto the hosted editor for a consistent model.
- **Module S1 landed: student-site information architecture + per-chapter
  offline downloads** (owner decision: full S1 incl. `.md.html` downloads).
  `buildCourseSite` (`@alembic/renderer`, rule 7) reworked into a reading-first
  IA: a course **home** with intro + **chapter cards** (each linking its page
  and its offline copy) + Practice; per-chapter reading pages with a top nav,
  a **resource bar** (⬇ Download this chapter), rendered study guide, and
  prev/next (`← Prev` / `Next →`); a "Published with Alembic" footer; all on a
  theme-neutral reading-chrome stylesheet that sits on either orz theme.
  `publishSiteAction` now generates a **self-contained `.md.html` per chapter**
  via the worker (falls back to an in-process rendered copy when no worker) and
  commits them under `downloads/`, linked from the cards + resource bars
  (best-effort per chapter — a generation hiccup skips that download, never
  blocks publishing). `CourseSiteInput` gained `description` + per-chapter
  `downloadHref`; site-preview passes the description. +4 renderer tests
  (intro, download links root- vs `../`-relative, omit-when-absent); browser-
  verified the home + chapter pages render cleanly (dark theme). Green
  (typecheck + full test + web build). **Meets the S1 DoD** (any public
  resource ≤2 clicks from home). **Owner smoke test:** Publish web page, open
  the site — confirm the chapter cards, a chapter's Download-offline link
  resolves to its `.md.html`, and prev/next work. **Deferred (S2/S3):** the
  full impeccable reading design pass, slides/paged on the site, current-term
  section, permalink stamps + pinned assets (R3).
- **Module S2 (partial): copy-as-source on every page — the real orz-markdown
  runtime.** (Corrected from a first attempt that hand-rolled a copy button.)
  Copy-as-source is a **built-in feature of orz-markdown**, exactly as `.md.html`
  has it: `themedDocument` now inlines `getBrowserRuntimeScript()` (from
  `orz-markdown/runtime`) — the same runtime `.md.html` ships — so **selecting
  rendered content and Cmd/Ctrl-C yields Markdown** (a DOM→Markdown walker over
  `.markdown-body`, reading preserved `data-md`). Every themed surface (student
  site, in-app preview, worksheet viewer) gets it for free; the custom button /
  hidden-textarea was removed. Browser-verified on a generated chapter page: a
  synthetic copy over `.markdown-body` is intercepted (`defaultPrevented`) and
  the clipboard receives Markdown (`## The atom … **atoms** … - protons`); page
  is clean + responsive at 375px. +1 renderer test (runtime inlined on every
  page). Green (typecheck + full test + web build).
- **Thin CDN delivery shipped end-to-end (owner-approved release).** The
  student-site views are now **small CDN-linked files** that load the framework
  from jsDelivr at view time (owner goal: don't commit the ~1 MB framework
  repeatedly; viewers get the published framework). **Upstream:** added a
  `delivery: 'inline' | 'cdn'` option to the three library builders
  (`buildMdHtml`/`buildSlidesHtml`/`buildPagedHtml` — the CDN compose already
  existed in each CLI, just wasn't exposed) and **published 6 packages**:
  `orz-mdhtml@0.5.0` + `orz-mdhtml-browser@0.5.0`, `orz-slides@0.4.0` +
  `-browser`, `orz-paged@0.4.0` + `-browser` (each tool bumped to
  `orz-markdown ^1.3.2`). Verified thin output before publishing: md **75 KB**
  (vs 827 KB inline), slides **78 KB** (vs 1.07 MB), paged **89 KB** (vs
  1.44 MB) — each correctly referencing `…-browser@<ver>` + `orz-markdown@1.3.2`.
  **Alembic:** `delivery` threaded worker-client → worker (`jobs`/`server`) →
  `@alembic/generators`; `publishSiteAction` now generates each chapter as
  `.md.html` **+ `.slides.html` + `.paged.html`** (all `cdn`) and the course
  home links **Slides · Print** per card (extend-to-slides/paged, owner ask);
  practice pages are `cdn` too. Downloads/editing keep `inline` (default) for
  offline self-containment. Green (typecheck + full test + web build).
  **REQUIRES: redeploy the Fly worker** (`apps/worker`) so it runs the new code
  + orz tools — until then the worker still emits inline. Vercel auto-deploys
  the web side. **✅ VERIFIED LIVE (2026-07-06):** Fly worker redeployed
  (`/health` → `orz-markdown@1.3.2`); orz-markdown `CHANGELOG.md` documents the
  1.3.2 image fix (`98e7cd6`); owner confirmed a **published study guide in the
  GitHub Pages repo is 74.4 KB** (thin CDN file, framework loaded from jsDelivr)
  — the lean-source model holds in production.
- **Bugfix (upstream orz-markdown + vendored copy): image sizing `![](img =WxH)`
  did nothing.** `markdown-it-imsize` was correctly emitting `width`/`height`
  attributes, but `common.css`'s `.markdown-body img { width:auto; height:auto }`
  (CSS properties) **overrode** them, so sized images rendered at intrinsic size.
  Fix: apply `auto` only to images WITHOUT an explicit dimension
  (`img:not([width])` / `img:not([height])`) — responsive default kept, `=WxH`
  wins. Fixed in **orz-markdown** `themes/common.css` (upstream, `a80b60a` —
  reaches `.md.html` via the CDN theme once orz-markdown is republished) **and**
  Alembic's vendored `renderer/theme-css.ts` (both dark + light inlined copies —
  live now for `themedDocument`: student-site home, previews, worksheet viewer).
  Browser-verified: a `=200x100` image renders 200×100 (old CSS gave 400×400
  intrinsic); unsized images stay responsive. Green (renderer typecheck + 35
  tests + web build).
- **Course theme is a per-course manifest setting** (owner note: one theme for
  the whole course, not per-file or the transient editor cookie). Added optional
  `theme` (`dark`|`light`) to the manifest (pure enum, no renderer import);
  `setCourseThemeAction` persists it (manifest row + `alembic.json` commit); a
  **Course theme** selector in the Course pane (`CourseThemeControl`);
  `publishSiteAction` now uses `manifest.theme ?? cookie` so every generated
  view is consistent. Students still switch after downloading a copy. +1 test.
  Green (typecheck + full test + web build). **Owner smoke test:** open a
  course's Course pane, pick a theme, republish, confirm all pages match.
  **Note (student save):** already handled — the published `.md.html`, opened
  standalone, turns Save into "download a local copy" (a student can't write to
  the instructor's GitHub); orz default, no work needed.
- **Module S — viewing = the self-contained files** (owner decision, supersedes
  the S1 bare-render reading pages + `downloads/`). The student-site chapter
  **view IS its `.md.html`** (rationale: slides always need a framework anyway,
  so plain-markdown's size edge never held uniformly; and the files ARE the
  product experience — copy-as-source, editor, themes, math all built in and
  identical to what the educator sees). ~1 MB/page accepted for today's web.
  Model: `buildCourseSite` is now a **course-home hub** (title + intro + chapter
  cards linking `chapters/<slug>.md.html` + practice) — hub-and-spoke;
  `publishSiteAction` generates each chapter (and practice artifact) as its own
  self-contained page via the worker (in-process fallback) and serves it as the
  page. The bare-render chapter/worksheet pages and the separate `downloads/`
  are gone (the page IS the download). Source of record stays lean `.md`.
  `CourseChapter` is now `{slug, title, viewHref}`; added `CoursePractice`;
  site-preview shows the home hub. Browser-verified: hub cards link to
  `chapters/*.md.html`, and the linked page is a real self-contained `.md.html`
  (823 KB, orz runtime + reading view + content). Renderer tests rewritten (35
  pass). Green (typecheck + full test + web build). **Trade-off noted:** a
  chapter page has no course prev/next (standalone file) — hub-and-spoke covers
  navigation; in-chapter prev/next would want an upstream `buildMdHtml` nav-slot
  (future). The edit pencil on a student page is intentional (OER remix: edit
  locally → download your copy). **Deferred:** slides/paged ON the site
  (`.slides.html`/`.paged.html` per the same policy), current-term, R3 pins.
  cause was a datetime round-trip: `RegistrationRecordSchema.registeredAt`
  used `z.iso.datetime()`, which accepts a bare `Z` but **rejects a timezone
  offset**. Writes stored `Date#toISOString()` (`…Z`, so rows inserted fine),
  but Postgres `timestamptz` reads back as `…+00:00` → `parseRegistrationRecord`
  threw on **every** row → `listByPackage` threw → the edit page's `catch`
  blanked `assetDocs` → no "Share this" on any asset, for every account, while
  the rows sat plainly in the dashboard. Fix: `registeredAt` (and
  `DocumentVersionSchema.savedAt`) now use `z.iso.datetime({ offset: true })`
  — still accepts `Z`, so writes/tests are unaffected. Added two regression
  tests (Postgres offset + microseconds). Also made the edit page's registry
  `catch` **log** instead of silently swallowing (it hid this). Audited the
  other seven `z.iso.datetime()` schemas: all parse file/manifest content
  (verbatim `…Z`), and `research_events` reads bypass the Zod schema, so
  registration was the only timestamptz-through-Zod path. Green (typecheck +
  full test + web build).

### 2026-07-05
- **Phase 1 (Module R) implementation — 2 of 3 increments landed, green.**
  (1) **Contract v2 activation + registry projection** (`dda7df0`): manifest
  accepts schemaVersion 1|2 (creation default stays v1 until the E3 gate);
  block IDs optional (§4); dual-mode path validation; the `documents` registry
  table (migration `0014`) + the pure idempotent `document-registry.ts`
  (+9 tests). (2) **Write paths v2-aware** (`22cc7b3`): exported
  `assertPathAllowedInEitherContract`; editor-edit + reconcile + findLeakedPaths
  are dual-mode (v2 spaces validate, two-repo invariant still fail-closed);
  reconcile validates block IDs of v2 `.md.html` study guides via carrier
  extraction (door-#3 origin parity); +4 adversarial tests. (3) **Registration hooks** (`4398977`): migration `0014` **applied**;
  `SupabaseDocumentRegistryStore` + best-effort `syncPackageRegistry`
  (rebuildable projection, never breaks a workflow) wired at the edit-page
  load (`created`) and reconcile-absorb (`external-commit`) doors. **R2 core
  done** (registration happens on open + external commit) — unblocks Module P
  (permalinks). Human smoke check pending: open a package → rows appear in the
  `documents` table. **Remaining in R:** the v1→v2 migration runner (rides
  E3) and R3 version listing; and rounding out registration to the upload
  door + a permalink resolver route (P1). Phase 1's durable contract + registry
  foundation is now real, tested, and coherent with the docs.
- **Coherence re-evaluation (owner-requested) — done; plan de-conflicted +
  leaned.** Three concurrent audits (coherence: 30 findings; simplification:
  7; code-reality). Key insight: the plan's conflicts and its complexity were
  the same thing, concentrated in unbuilt parts. **Owner decisions:** lean
  core first (defer element notifications, `changeKind` UI, unified Inbox,
  Module I — schema seams kept dormant); permalinks ID-based but a **thin**
  `/d/{docId}` route (not permanent infra); keep the `space` field + retire
  "layer"; content-hash asset identity for MVP. **Wrote the authoritative
  [specs/package-contract-v2.md](specs/package-contract-v2.md)** (consolidates
  the schema, dissolving ~half the findings); softened Roadmap rule 5
  (unified-Inbox-vs-separate decided when Module T is built); v2 supersession
  pointers added to carriers-and-assets + package-contract-v1. **Code-reality:
  contract v2 is ~70% in code** (spaces/registration/ids landed); remaining
  Phase-1 is mechanical — bump SCHEMA_VERSION→2 + migration, wire write paths
  to spaces, extract `.md.html` source in editor-edit/reconcile, the
  `documents` table (migration 0014) + registration hooks. Implementation next.

### 2026-07-04
- **Generator adoption — Step 1 DONE (carrier codec).** `@alembic/carriers`
  `extractSource`/`hasCarrier`/`detectFormatVersion` now read the upstream
  self-contained-file source islands (`#orz-src` → md/paged, `#orz-deck` →
  slides) with their `</script>`-only escaping, alongside the native
  `#orz-carrier` and legacy `#md-source` (`9ca4897`; +4 tests incl. the
  literal-backslash edge case). Alembic can now round-trip source out of
  upstream-generated files.
- **Generator adoption — Step 2 UNDERWAY (worker tier, owner-chosen).**
  Durable core landed: **`@alembic/generators`** (`db33db6`) —
  `generateSelfContained({kind, markdown, title, theme})` wraps the
  published upstream libs, returns a live-editable file (in-file editor +
  host-save); Node-only (reads package assets), so it runs in the worker,
  never Vercel serverless. Verified installed library entries resolve
  assets from `node_modules`; source round-trips out via `@alembic/carriers`
  (Step 1) modulo the tools' `\n` padding (slides/paged pad, md doesn't —
  consumers `.trim()` before hashing; a future upstream consistency fix
  would make it byte-exact). **(a)–(c) DONE** (`0074212`): worker is a
  long-running HTTP service (`POST /generate` → `@alembic/generators`,
  `GET /health`, optional `WORKER_TOKEN`; `generate-file` job contract) —
  smoke-tested end to end; web seam `lib/worker-client.ts` (`server-only`)
  calls the worker when `WORKER_URL` is set (LIVE in-file-editable files),
  else falls back to the renderer's in-process builders (exports keep
  working with no worker); wired both `.md.html` export routes
  (`mdHtmlResponse` async) + slides generation (injected into `package-ops`
  so it stays free of the worker/Node-only dep). `.env.example` documents
  the vars; `pnpm dev:worker` runs it. **(d) DEPLOYED to Fly.io.**
  Worker live at `https://alembic-worker.fly.dev` (app `alembic-worker`,
  region `iad`, 1× shared-cpu-1x/512MB, `/health` check green); Dockerfile +
  fly.toml at `apps/worker/`. `WORKER_TOKEN` set as a Fly secret; verified
  end to end (health, 401 without token, authorized `/generate` → live
  823KB `.md.html`). **Vercel wired + redeployed:** `WORKER_URL` + `WORKER_TOKEN`
  set on the `alembic` project (Production, encrypted); production
  redeployed and healthy (`alembic.orz.how` 200). The generator adoption is
  now **live end to end** — exports and generated slides route through the
  Fly worker and produce live-editable files (in-file editor + host-save),
  with the in-process fallback still there if the worker is unreachable.
  **Human-verified in production (2026-07-05): downloading a study guide
  produces a correct live `.md.html`.** The Module R/E generator-adoption
  arc is complete: carriers read upstream islands · `@alembic/generators` ·
  worker HTTP service on Fly · web seam with fallback · deployed + wired.
  `.md.pdf` retirement is a no-op.
- **Generator adoption — Step 2 BLOCKED ON A DECISION (owner).**  ~~superseded above~~ Swapping
  `renderer/mdhtml.ts` + `renderer/slides.ts` to call `buildMdHtml` /
  `buildSlidesHtml` / `buildPagedHtml` surfaced two real issues: (a) the
  upstream libs are **Node-only and read package assets at runtime**
  (`readFileSync` via `import.meta.url`) → in Next.js/Vercel serverless the
  asset files aren't traced by default (works locally, 404s on deploy)
  unless forced via `outputFileTracingIncludes` **or** generation moves to
  the **worker tier** (Module W) which has a real filesystem — the
  architecturally cleaner home for heavy asset-reading generators; (b) the
  library entry is **inline-only** (~800KB self-contained) — right for
  *downloadable* `.md.html` exports, but heavy for *repo-committed* study
  guides (E3), which may want a CDN mode (smaller) that the upstream lib
  doesn't yet expose. Decision needed before wiring. Theme mapping
  (Alembic `RenderTheme` → orz theme id) is trivial by comparison.
- **Upstream library entries DONE (pushed, NOT published).** Each orz-family
  package now exports an in-process generator so Alembic can build files
  without shelling to the CLI: `buildMdHtml` (orz-mdhtml `98835ef`),
  `buildSlidesHtml` (orz-slides `a7c9978`), `buildPagedHtml` (orz-paged
  `79566ab`). All: single shared inline-composition path (CLI `--inline`
  output byte-identical; CDN path unchanged), `exports`+`types`, assets
  resolved via `import.meta.url` (npm-installable), builds + suites green
  (slides 54, paged 132). **RELEASED (owner-authorized):**
  `orz-mdhtml@0.4.0`, `orz-slides@0.3.0`, `orz-paged@0.3.0` (each + its
  lockstep `-browser`), registry-verified — Alembic can consume from npm
  now. **Adoption note
  — source-island markers differ per format** (mdhtml/paged
  `<script type="text/markdown" id="orz-src">`, slides
  `<script type="text/orz-slides" id="orz-deck">`); verify
  `@alembic/carriers` `extractSource` handles all three as the first
  adoption step. paged output is fully deterministic (no per-doc id);
  mdhtml/slides carry a random docId (IndexedDB save handle).
- **Hosted-chrome logo-hide REVERTED (owner).** The upstream attempt to
  hide the orz brand on host handshake (orz-mdhtml/slides/paged) was
  reverted and pushed (revert commits `9d495d1` / `050cfbd` / `d2a5e9d`);
  the `orz-host-save@1` protocol itself is untouched. Duplicate-logo
  suppression is **deferred** — the general file shouldn't carry
  Alembic-specific policy, and the duplicate only shows while editing.
  Future path documented in workspace-framework.md §3 (a generic,
  download-safe `?embed=minimal` file capability). Established constraints:
  sandboxed opaque iframe (no host DOM access) + `serializeDoc`
  deep-clones live DOM (in-file hides bake into saves without a serializer
  strip).
- **Owner decision: Alembic drops its own dual-extension builders.**
  `.md.html` / `.slides.html` generation moves to the upstream orz-family
  generators (and `.md.pdf` is retired — print a `.paged.html` instead), so
  every file Alembic produces carries its in-file editor + host-save
  protocol. Plan: (1) upstream library entries (`buildMdHtml` /
  `buildSlidesHtml` / `buildPagedHtml` exported from the three packages,
  inline-runtime mode; CLI refactored over the library) — queued behind the
  in-flight hosted-chrome agent (same repos); (2) owner publishes releases
  (npm token was deleted after the last publish); (3) Alembic renderer
  adopts: replace `renderer/mdhtml.ts` + `renderer/slides.ts` builders,
  update `package-ops/slides.ts` + web export; verify carrier
  `extractSource` round-trips upstream-generated files.
- **E1 host side landed: the generic hosted-carrier editor.**
  `@alembic/editor-kit` gains the pure `createHostSaveClient` (hello retry →
  ready → save relay → `orz-host-saved` ack → dirty; 8 tests, fake-timer
  verified) plus additive `EditorContext.hostSave` / `onDirty` hooks. ONE
  `hostedCarrierModule(kind)` (apps/web `lib/editor-modules/hosted-carrier.ts`)
  registered for `md` / `slides` / `paged`: sandboxed-iframe mount
  (`allow-scripts`, opaque origin), source = the full self-contained file,
  saves persist the re-serialized document via the host's validated write
  path; pre-protocol files time out gracefully (stay viewers). ModuleMount
  passes the new hooks through. All suites + build green. **Gap to close
  next (E1→E3):** Alembic's renderer still generates its own
  `.md.html`/`.slides.html` without the orz in-file runtimes, so
  Alembic-generated files can't answer the hello yet — adopt the orz-family
  generators (upstream library entries or worker-tier CLI) so generated
  files carry their editors. Hosted-chrome logo hide is in flight upstream.
- **`orz-host-save@1` implemented upstream (all three sibling repos, one
  pass) and browser-verified** — canonical PROTOCOL.md + runtime hook in
  orz-mdhtml (`efd6d4b`), orz-slides (`37459cc`), orz-paged (`c5f25e9`).
  Handshake (parent-only trust, origin pinning, version negotiation),
  hosted Save `{source, html}` with ack + 10s watchdog, dirty signal,
  unhosted behavior unchanged; slides 47/47 + paged 125/125 tests green.
  ~~Pending operator action~~ **RELEASED same day (owner-authorized):**
  pushed and published in lockstep pairs — `orz-mdhtml@0.3.0` +
  `orz-mdhtml-browser@0.3.0`, `orz-slides@0.2.0` + `orz-slides-browser@0.2.0`,
  `orz-paged@0.2.0` + `orz-paged-browser@0.2.0` (browser pairs are
  mandatory: generated files pin `browser@<selfVersion>` CDN URLs). All
  versions verified on the registry. Alembic host side must retry the
  hello. E1's generic hosted-carrier EditorModule is fully unblocked.
- **Sprint 1 (Modules R+E) landed.** **R1 core primitives** (subagent,
  purely additive to v1): `package-contract` gains the v2 spaces module
  (space=layer; `spaceForPath`, `assertPathAllowedInRepoV2`, v1→v2
  mapping), registration-record schema + `newDocId()` + invariants
  (current/private locked non-discoverable), optional manifest
  `currentTerm`; `carriers` gains the `paged` kind and plain-media kinds
  (`binary` payload; embed/extract fail clearly; `.ketcher.svg` still
  beats plain `.svg`) — so plain media now classifies on import instead of
  failing. 151+27 package tests; typecheck/tests/build green.
  **E1 strategy decided** (workspace-framework §3): the orz-family
  runtimes gain a versioned `orz-host-save` postMessage protocol upstream;
  Alembic mounts each file in a sandboxed iframe via editor-kit modules —
  next E1 step is the upstream protocol in orz-mdhtml, then the md module.
  **E2 shipped:** the minimal `.md` editor (concept maps, assessment
  guide, private notes) has a Source ⇄ Preview toggle via `/api/preview`.
- **Roadmap review pass (owner request): two adversarial audits, 25
  coherence findings + 9 code-gap areas, all resolved.** Roadmap gains:
  explicit R1 code-touchpoint list (layers.ts, validate.ts,
  reconcile/editor-edit carrier extraction, `paged` kind + plain-media
  fallback, hardcoded-path cleanup), an **E3-gated-on-R1-in-code** rule
  (no `.md.html` study guides before schema v2), a T1 notice taxonomy,
  **Flexibility guarantees** for modules T/I/S (interface-committed,
  implementation-open; dependencies one-way), and **Approval semantics**
  (registration=Tier-1 auto; "share this"=the Tier-3 act; `current/`
  locked non-discoverable at registration). Spec fixes: registration field
  renamed **`space`** (v2: space=layer; kills the terminology collision);
  reference-vs-copy lineage rule; block-anchor forms disambiguated
  (`#blk-` view vs `/blocks/` raw); assessment guide marked public-safe
  by definition (keys always `private`) with adapt-preview exclusion;
  migration additions (additive `unitTerm`/`currentTerm`; `privateRepo`
  nullable, created on demand); stale open questions in
  self-contained-editing §6 closed as DECIDED; **supersession banners** on
  package-contract-v1 and carriers-and-assets. Package-layout §8 ruled
  (all four per recommendation) same day.
- **New module-based [Roadmap.md](Roadmap.md) (owner-directed).** The four
  owner-named elements → modules with one-owner seams: **R** registry/
  document contract v2, **E** editing experience (**first**), **P**
  permalinks/sharing/adaptation, **T** trust surfaces (Inbox — complete
  UI/UX redesign of the parked review/a11y/adapt/history/reconcile
  features), **I** AI (deliberately open; seams preserved), **S** student
  site, **W** worker enabler. Seven conflict-avoidance rules (one schema
  owner, one write path, one metadata source, one editor seam, one Inbox,
  AI behind AIProvider, site = renderer concern). **Old roadmap + 3
  superseded specs archived** to docs/archive/ (editor-layout,
  workspace-editor-overhaul, local-mode) with supersession notes; their
  built history stands. Next: Module E kickoff (E1 editor hosting + E2
  minimal .md editor), with R1 contract-v2 slice pulled forward for E3.
- **Workspace framework pass (owner brief):
  [specs/workspace-framework.md](specs/workspace-framework.md).** The
  three-pane shell is now *the* editor: **classic editor removed** (~2.2k
  lines; `/workspace/[id]` redirects to `./edit`; `PublishingState` moved
  into publish-header). Site header full width. **Categories = the document
  model** (Concept map · Study guide · Slides · Assessment guide · Practice
  · Assets · Current (new space, explanatory view) · Private). **Uploads
  accepted** in Study guide (`.md`/`.md.html`, block-ID reconciling merge)
  and Assets (carrier files) via the existing lossless import pipeline —
  origin-parity door #2 in the UI. Classic-only side panels (review queue,
  a11y, assessments, adapt, planning, history, reconcile banner) are
  **consciously parked** — durable actions untouched; re-land per the new
  design (review queue + reconcile banner first). Deep alignment (hosted
  in-file editors, real file spaces, registration) comes with the document
  contract.
- **orz-markdown upgraded 1.0.0 → 1.3.1** (built-in editor, copy-as-source,
  themes) — all 9 test suites green. `rendererVersion()` no longer
  hardcoded: derived from the renderer's dependency declaration, so the
  homepage footer and generated-artifact stamps update with future bumps.
  **Discover + Workspace aligned to the homepage/guide identity** (`#`
  serif headline, copper accents); Discover gains the **two-scope framing**
  from document-model.md — Courses (live) · Elements (disabled "soon"
  chip) — plus a better empty state; homepage button renamed "Browse
  Discover". Next: the workspace overhaul (the big one).
- **Studio removed; `/guide` added (owner decision).** `/studio` and its
  studio-only `/api/render/md-html` route are deleted — a self-contained
  file is itself the local anonymous editor. In its place, **`/guide`**: a
  brief educator-facing orientation ("the five things worth knowing" —
  packages & two-repo ownership, self-contained documents with built-in
  editors, study guide as source of truth, publish/snapshot/cite on your
  own GitHub, adapt & suggest-back). Header nav (all three variants) and
  the homepage button now point to Guide.
- **Design sessions locked:** [specs/document-model.md](specs/document-model.md)
  (taxonomy from the owner's userguide + 4 rulings) and
  [specs/permalinks-and-registration.md](specs/permalinks-and-registration.md)
  (registration record, `/d/{docId}[@version]` + `/p/{packageId}[@snapshot]`,
  layered resolution, content-hash pins, platform-served pinned versions,
  pinned inserts + in-app-inbox notifications, per-file "share this"
  discovery; current space excluded from element search).
- **Docs rebuild started (owner-approved process):** recreate the docs with a
  clearer structure; once an old file's content is covered, move the original
  to `docs/archive/`. **goal.md recreated** — vision unchanged, revisions:
  workspace hosts plugged-in in-file editors and builds none (§1 renamed
  "Workspace (hosting, not editing)"; core idea #4); orz-markdown **v1.3.1**
  (built-in editor, copy-as-source, themes) + orz-mdhtml/orz-slides/orz-paged
  named as canonical format implementations (VS Code extensions demoted to
  history); `.paged.html` replaces `.md.pdf` (print-to-PDF from paged);
  document contract + two-class permalinks added to the Package Model; module
  map gains Document Registry + Editor Hosting rows; "not an editor project"
  added to non-goals. Original archived verbatim at
  [archive/goal-2026-06.md](archive/goal-2026-06.md). Next: specs (bigger
  revisions expected), then the new roadmap.

### 2026-07-03
- **[SteeringNote.md](SteeringNote.md) added (owner request)** — the living
  steering note consolidating the day's direction (self-contained editing,
  Studio removal, document contract, two-class permalinks, taxonomy next);
  the owner refines it before implementation. When it and the spec disagree,
  the note is newer thinking.
- **⭐ Reminder (owner request): next design session = the document
  taxonomy** — what document types a course package should have, their
  formats and functions, in detail. Blocks the document-contract schema;
  tracked at the top of
  [self-contained-editing.md §6](specs/self-contained-editing.md). A
  **permalink mechanism proposal** (ID-based indirection; 302→GitHub Pages
  for public, platform-served for private/trial; block-fragment inserts;
  `@snapshot` pinning; raw-GitHub links rejected) is written up in the same
  spec §7, pending owner approval. **Owner clarification (same day): two
  permalink classes** — dual-extension files are *final views* (share /
  cite / always-findable; never inserted anywhere), while *objects*
  (images, audio, raw markdown fragments, …) have permalinks used directly
  as `src` to embed; `<iframe>` for HTML units is a tolerated fallback,
  not preferred (spec §4/§7 updated).
- **Design direction locked (owner decision):
  [self-contained-editing.md](specs/self-contained-editing.md).** Core idea
  (goal.md) unchanged; editing offloads from the platform to the
  self-contained dual-extension files built by the sibling orz-family
  projects — `.md.html` (orz-mdhtml), `.slides.html` (orz-slides),
  `.paged.html` (orz-paged) — each carrying its own in-file editor. The
  workspace **plugs these editors in and builds none of its own**;
  **Studio (`/studio`) is slated for removal** (a self-contained file *is*
  the local anonymous editor; supersedes local-mode.md). A **document
  contract** (package-contract extension) gives origin parity — documents
  created in the workspace, uploaded to it, or committed directly to the
  GitHub repos all *register* identically (kind, format version, source
  hash, provenance, block IDs, layer) with the two-repo invariant enforced
  on every door. **Every file gets a permalink** for citation and insertion
  (generalizing the carriers-and-assets asset-permalink model). Open
  questions tracked in the spec §6 (study-guide source of record, fate of
  the studio-shell block editor, `.md.pdf` vs `.paged.html`, upload policy
  vs trial storage). CLAUDE.md updated (key-docs pointer + rule 3 note).
  Implementation not started.
- **UI/UX audit + responsive & accent pass (impeccable).** Full audit of the web
  app with the impeccable design skill (installed at `.claude/skills/impeccable`;
  design context captured in `apps/web/PRODUCT.md` + `apps/web/DESIGN.md`).
  **Responsive (narrow screens now work):** site header no longer wraps at 375px
  (compact spacing; signed-in nav collapses into a CSS-only Menu below `sm:`);
  studio-shell chapter/category panes become overlay drawers below `md:`
  (auto-closed on mobile, one at a time, backdrop + close-on-pick); shell/editor
  toolbars wrap; Ask-AI before/after diff stacks; plot editor stacks below `md:`;
  snapshots popover clamps to viewport; workspace list rows + rename form wrap;
  admin stats grid stacks; homepage hero scales (`text-4xl sm:text-5xl`); touch
  targets grow under `pointer: coarse`. **One decoration color — copper** (the
  alembic still), replacing the generic blue accent in both themes with computed
  WCAG-verified values (dark `#d99a6c` 8.1:1 on canvas; light `#a4551e` 5.4:1 on
  white; accent-ink pairs ≥5.4:1): primary buttons, links, focus rings, active
  nav, selection. Neutrals unchanged (still harmonize with orz-markdown rendered
  themes; document previews keep their bookish palette by design). Verified in
  the browser at 375/1280 in both themes; typecheck + 242 tests + web build green.
- **M37 deferred post-pilot (user decision).** Institution/workshop-managed mode
  (org-installed GitHub App, bot-as-educator commits) is heavy/external and best
  shaped by pilot needs; uniform managed AI for a cohort is already covered by the
  per-user budget + gateway (M16/M36). **Phase 7 core (M34–M36) complete.** Next
  candidate: Phase 8 (hardening & sustainability) or a pilot-readiness pass.
- **M36 — centrally-managed credits + usage visibility + FERPA/IRB review.**
  research-events pure `summarizeUsage` (totals + by-kind + by-user, **token-only**,
  never prompts/outputs; 4 tests → 13) + an "AI usage" section in `/admin`
  (service-reads only the token columns). Centrally-managed credits are already
  delivered (uniform per-user `AI_TOKEN_BUDGET` + gateway/routing + governed
  logging); per-institution grouping is a follow-up (needs an institution model).
  Wrote [specs/data-handling-review.md](specs/data-handling-review.md) closing the
  M16.4 FERPA/IRB task (data-touch inventory, gateway retention/region/FERPA/IRB
  checks, per-deployment decision table) — mechanism built, the review is a
  per-deployment operator/PI action. typecheck + all tests + web build green.
  Next: M37 institution-managed mode (org GitHub App — heavier/external).
- **M35 — admin / operations module.** Admin gate: migration `0011`
  (`profiles.is_admin`); `requireAdmin` checks the user's own profile (user client),
  then hands out a service-role client (`lib/supabase/service`, server-only) for
  the cross-user reads research/admin need — **service-role used ONLY behind the
  gate**. `/admin`: package/registration/event counts, recent `error.surfaced`,
  and open-`portal_reports` resolve/dismiss (the Phase-6 deferred admin UI; the
  `portal_eligible` toggle was removed when listing went open). De-identified export download
  `GET /admin/export?format=csv|json` (service-reads `research_events` → M34
  `deidentifyEvents` with a salted `exportPseudonymizer`). "Admin" header link for
  admins. typecheck + web build green. **Migration 0011 + `SUPABASE_SECRET_KEY`
  awaited.** Next: M36 credits/quotas + FERPA review. Demo-content management deferred.
- **M34 — research event taxonomy + de-identified export (Phase 7 durable core).**
  Reviewed the taxonomy (34.1): broad coverage — authoring with `durationMs`
  workload signal, AI accept/edit/reject with Tier-1 logged separately, reuse
  events, a11y/import/agent/reconcile/leak/export — sufficient for the study,
  additive if a metric is missing. Built (34.2) `@alembic/research-events`
  `deidentifyEvents` (caller injects a salted one-way `pseudonymize`, keeping the
  package dependency-free and the salt out of it; raw user_id/package_id dropped)
  + `eventsToCsv`/`eventsToJson` (RFC-4180 escaping). 5 tests (9 total); typecheck
  green. The export *download* (admin reads `research_events` via service-role +
  this transformer) lands in M35. Next: M35 admin/ops module (needs `profiles.is_admin`).
- **M33 — governance scaffolding (completes Phase 6 core).** Registration is **open to
  all educators** (the grant-period `portal_eligible` gate was removed in the pilot
  UI/UX pass; column dropped in migration `0013`); `registerPackageAction` requires only
  GitHub-published + Tier-3 gates. Reporting/takedown: `portal_reports`
  table (RLS — insert by anyone incl. anonymous, read by operators only) +
  `reportPackageAction` + a "Report" control on portal cards; takedown = owner
  unlist or operator removal; procedure in [specs/portal-governance.md](specs/portal-governance.md).
  In-app admin/moderation UI is Phase 7; open registration + stewardship handoff
  Phase 8. typecheck + web build green. **Migrations 0009 + 0010 await `db push`.**
  **Phase 6 (portal & discovery) complete (M30–M33).**
- **M32 — searchable portal.** `/portal` split into a server page (data + the M30.2
  LRMI `ItemList` JSON-LD) + a `PortalBrowser` client component: text search over
  title/description plus discipline / license / accessibility facets (client-side
  over the small index), a live result count, license + a11y quality indicators,
  and per-result "Visit site" / "Source" / "Adapt →" (to the workspace AdaptPanel,
  which lists portal sources — M31). typecheck + web build green. Follow-ups:
  level / artifact-type / teaching-time facets (need richer registration metadata);
  one-click portal→adapt with the source preselected. Remaining Phase 6: M33 governance.
- **M31.2 — cross-owner suggest-back (completes the two-way ecosystem loop).** Per
  the chosen model: a dedicated `suggestions` table (migration `0009`) with
  **RLS, no service-role bypass** — insert only to a portal-registered package
  (consent = registration) as yourself; read by the upstream owner (inbox) + the
  sender; resolve by the owner only. `lib/suggestions` (send/list/get/setStatus);
  `suggestBackAction` now routes by ownership (own package → the M28 review queue;
  another owner's → the suggestions inbox); `listIncomingSuggestionsAction` +
  `resolveSuggestionAction` (accept applies the suggested title/body to the block
  via `saveStudyGuide` + sync; reject discards); `SuggestionsInboxPanel` (Review
  group, shown only when suggestions exist). typecheck + all tests + web build
  green. **Awaits migration 0009 `db push`.** **Phase 6 cross-owner ecosystem
  (M31) complete** — adapt a stranger's package + suggest back, both RLS-clean.
  Remaining Phase 6: M32 searchable portal, M33 governance. (28.3 GitHub-PR
  materialization still deferred.)
- **M31.1 — cross-owner adaptation (adapt a stranger's package).** Decision: dedicated
  table + RLS, **public GitHub reads, no service-role bypass**. Groundwork:
  `adaptGivenBlocksInto` (decouples source-read from target-write — the cross-owner
  primitive; 139 package-ops tests unchanged). github-bridge `fetchPublicRepoFile`
  (tokenless raw.githubusercontent read of a public repo). Web `adaptFromPortalAction`
  (gated on portal registration = public + consented; reads the source's `alembic.json`
  + first chapter from its public repo; license-gated via `canAdapt`; lineage +
  attribution recorded) + `listPortalAdaptSourcesAction`; AdaptPanel "From the portal
  (other educators)". typecheck + all tests + web build green. Next: **M31.2** cross-owner
  suggest-back via a `suggestions` table (needs migration `0009_suggestions.sql`).
- **M30 — LRMI / schema.org `LearningResource` markup (Phase 6 leading piece).**
  Published pages are now harvestable independently of the portal (goal.md §6).
  renderer `learning-resource.ts` (pure): `learningResource`/`learningResourceJsonLd`
  build a schema.org `LearningResource` JSON-LD (license URL from the new contract
  `licenseUrl`/`LICENSE_URLS`; accessibility hints only when the audit passed; `<`
  escaped for safe `<script>` embedding); `themedDocument` gained `headHtml`;
  `buildCourseSite` takes `meta` and injects the JSON-LD on the index page; web
  `site-actions` passes manifest-derived meta. M30.2: `/portal` emits a schema.org
  `ItemList` of `LearningResource` from `portal_registrations` via the same builder
  — consuming the standard, no proprietary record. Renderer gained a
  `@alembic/package-contract` dep (for `licenseUrl`); 4 renderer tests (37 total);
  typecheck + all tests + web build green. **Needs a structured-data-tester pass**
  on a published site. Next: M31 cross-owner adapt/suggest-back.
- **M28 — suggest back (adapter → author), data path.** Platform-mediated
  (goal.md): `suggestBackAction` uses the M26 lineage to find the upstream block
  and records a Tier-3 `suggest-back` change on the UPSTREAM package's review
  queue (`listAdaptedBlocksAction` lists eligible blocks; AdaptPanel "Suggest your
  improvements back"; logs `suggestion.sent`). The author accepts it via the
  `change-actions` `suggest-back` branch (applies the suggested title/body to their
  block through `saveStudyGuide`, stale-tolerant; Tier-3 itemized, not batchable).
  typecheck + all tests + web build green. Deferred: GitHub-PR materialization
  (28.3, external); cross-owner suggest-back (service-mediated). **Phase 5 core
  (adapt + pull + suggest-back) complete**; M29 DOI remains (external/Zenodo).
- **M27 — pull updates (upstream → adapter).** The lineage record (M26) now stores
  `sourcePath` + `sourceContentHash`; package-ops `detectUpstreamUpdates` flags
  adapted blocks whose source drifted (M3-style hashing), and
  `applyUpstreamUpdate(take|keep)` resolves each — take replaces the block via
  `saveStudyGuide`, keep records divergence; both advance the stored hash to clear
  the flag. Web `listUpstreamUpdatesAction`/`applyUpstreamUpdateAction` + the
  AdaptPanel "Updates from upstream" (Take/Keep) sync the chapter + provenance and
  log `upstream.update.applied`. 4 tests (139 package-ops); typecheck + build green.
  Deferred: AI-assisted merge for diverged blocks (27.3); cross-owner upstream via
  GitHub. Next: M28 suggest-back.
- **M26 — adaptation & lineage (Phase 5, fork at every scale).** Built durable-first.
  Contract `adaptation.ts` (M26.1): `canAdapt` pure CC-4.0 compatibility matrix
  (CC0→any; BY→any BY* not CC0; SA→same; NC stays NC) with educator-facing
  reasons + `AdaptationSource` (required attribution, snapshot pin = M15.5); manifest
  gains additive `adaptedFrom`. package-ops `adaptBlocksInto` (M26.2): license-gated
  copy of source blocks into a target chapter with NEW minted ids (identity never
  reused) via `saveStudyGuide`, per-block lineage recorded in public
  `provenance/adaptations.json`; `AdaptationNotAllowedError` on incompatible
  licenses. Web (M26.3): `adapt-actions` + `AdaptPanel` (Author group) adapt
  sections from another of your packages — license-gated, lineage + attribution
  recorded, synced to GitHub, `adaptation.completed` logged. 7 contract + 4
  package-ops tests; typecheck + all tests + web build green. Follow-ups:
  whole-package fork (createPackage + manifest.adaptedFrom), cross-owner/portal
  adaptation. Next: M27 pull-updates.
- **M25 — one-way LMS export (completes Phase 4 core).** package-ops `lms-export.ts`
  (subagent): `buildQti12` (QTI 1.2 — MCQ scored against the answer key; open →
  model-answer feedback; XML-escaped), `buildCommonCartridge` (CC 1.1 manifest +
  QTI), and a **dependency-free stored-zip writer** (`zipStore` with hand-rolled
  CRC-32, verified against the system `unzip` — no npm dep, dodging the flaky
  registry) + `exportCommonCartridge`. 15 tests (131 package-ops). Web:
  owner-authenticated `GET …/export/lms` bundles accepted items + their private
  answer keys into a `.imscc` download (logs `export.lms`); "Export to LMS" button
  in the Assessments panel. Confirmed: pure transformer + zip, **no worker tier**.
  typecheck + all tests + web build green. **Phase 4 core complete (M22–M25).**
  Follow-up: blueprint/embargo editor UI + owner early-lift.
- **M22–M24 — assessment & question templates (Phase 4 core).** Built durable-first
  (two concurrent subagents on disjoint packages + hand-integrated web). Contract
  `assessments.ts` (M22): QuestionTemplate/AssessmentBlueprint/QuestionItem (public,
  assessment-support) + AnswerKey (private, private-instructor), with a HARD
  boundary — `assertAnswerKeyPrivate` + path helpers; 8 tests. ai-assist
  `generateQuestions` (M23): pairs public stem/choices with the private
  answer/rationale, prompt forbids leaking the answer; 6 tests. package-ops
  `assessments.ts` (M24): load/save templates/blueprints/items (public) +
  `saveAnswerKey` (private only) + `isReleased()` embargo check + a release-gate
  "Answer keys & embargo" check; adversarial test proves a sentinel answer lands
  only in the private partition. Web: `saveTemplateAction`/`generateItemsAction`
  (Tier-3 review queue) + accept branch writing item→public + key→**private** via
  the new `syncPrivateFilesToGitHub` (commit plan repo:"private", validateCommitPlan
  fail-closed) + Tier-3 excluded from batch-accept + `AssessmentsPanel` (Generate
  group). The full loop — template → AI generate → Tier-3 itemized review → public
  item + private answer key — works; release gate guards leakage. typecheck + all
  tests + web build green. **Needs a live pass** (Portkey on Vercel). Confirmed at
  planning: Phase 4 needs no worker tier. Next: M25 LMS export (QTI + Common
  Cartridge, pure transformer + zip). Follow-up: blueprint/embargo editor UI + early-lift.
- **Light theme.** Added a light/dark toggle (header ☀/☾) alongside the existing
  dark-elegant default. Cookie-based (`alembic-theme`, single source of truth):
  the root layout reads it server-side into `<html data-theme>` (no flash), the
  toggle flips it instantly client-side, and **rendered markdown + `.md.html`
  output switch to orz-markdown `light-neat-1`** when light is selected (vendored
  `ORZ_LIGHT_NEAT_CSS` + `themeCss()` in the renderer; `themedDocument`/
  `renderDocument`/`buildMdHtml` take a `theme`, default dark — backward-compatible).
  Threaded through the in-app preview, worksheet viewer, and `.md.html` exports
  (study-guide + artifact + studio). App-chrome light tokens in `globals.css`.
  **Scoped to in-app rendering + `.md.html`** as requested; the published Pages
  site + slide decks stay dark for now (a separate publish-time choice). renderer
  33 tests + web typecheck + build green.
- **M9.6 — the hidden planning layer, wired end to end (concept-map-first authoring).**
  Confirmed the design is coherent with goal.md (concepts/objectives are public-repo
  layers, adaptable on GitHub but not rendered on the student site; study-guide-centered
  generation), then built out the loop that was data-layer-only: package-ops `planning.ts`
  (load/save concept map + objectives at course/chapter scope through the validated write
  path; facade; 10 tests); web `PlanningPanel` (Author group — add/edit objectives +
  concepts, synced to the repo); **map→study-guide** drafting (ai-assist
  `draftOutlineFromPlan` → Tier-2 review queue via the existing `import-blocks` accept
  path); **map→coherence-agent** (M18 now reads objectives/concepts and checks coverage +
  prerequisite ordering, citing ids, never editing the planning layer itself). Built as a
  Phase-4 prerequisite (assessment aligns to concepts/objectives). package-ops 98 +
  ai-assist 49 tests; web typecheck + build green. The AI drafting + agent linkage need a
  live pass (Portkey on Vercel). Deferred: chapter-scope editor UI, objective↔block
  alignment recording.
- **M21 — leakage remediation (completes Phase 3 core).** M20 quarantine detects a
  leak in a foreign *diff*; M21 audits the WHOLE public tree and documents cleanup.
  github-bridge `listTree` (recursive, truncated flag); package-ops pure
  `findLeakedPaths` (reuses fail-closed `assertPathAllowedInRepo` — flags any
  private-layer or non-allowlisted path in the public repo; 2 tests); web
  `scanPublicRepoForLeaks`/`scanForLeaksAction` + "Scan for leaks" in the Review
  panel; `leak.detected`/`leak.remediated` events. Wrote the remediation runbook
  [specs/leakage-remediation.md](specs/leakage-remediation.md) (contain → confirm
  scope → clean re-publication via `publishToBranch` parentless root commit or
  `git filter-repo` → forced re-publish → incident note → verify; secret-rotation +
  GitHub-cache caveats). Destructive purge stays a **guarded operator step** (not
  one-click). Caught a test assumption — the contract manifest is `alembic.json`,
  not `manifest.json` (root-file allowlist), confirming the audit correctly flags
  unrecognized root files. typecheck + all tests + web build green. **Phase 3 core
  (M18–M21) complete.** Deferred: worker-tier agent execution, one-click in-app
  remediation, history-walking detection, private-repo reconciliation.
- **M20 — external-edit reconciliation.** Repos are the source of truth (CLAUDE.md
  rule 4); an advanced user may edit the public repo directly. New durable core
  (two concurrent subagents on disjoint packages): package-ops `reconcilePublicRepo`
  over a network-free `RepoReader` — detects foreign commits, validates every
  changed path with `assertPathAllowedInRepo` + block-ID integrity, **collect-all
  then fail-closed**: absorbs only a fully-clean changeset, else **quarantines and
  writes nothing** (a private path leaked into the public repo, or corrupted IDs,
  is held back). 11 adversarial tests prove no partial absorb. github-bridge gained
  `compareCommits(base,head)` (9 tests). Web: `packages.last_synced_sha` (migration
  0008) recorded on every commit; save is **reconcile-first / no force-push**
  (detects head≠last-synced, skips the auto-sync with a warning rather than
  overwriting an external commit; commits already keep `base_tree`); explicit
  `reconcilePackageAction` + `ReconcilePanel` (Review group) absorb clean changes
  or surface quarantine violations; `reconcile.completed`/`reconcile.quarantined`
  events. typecheck + all tests (incl. 17 new) + web build green. **Needs a live
  pass** + migration 0008 `db push`. Deferred: private-repo reconcile, same-file
  3-way merge, and leakage *remediation* (M21 — quarantine detects; M21 cleans up).
- **M19 — agent execution & gating.** `AgentRunJob`/`AgentRunResult` job contract
  added to the worker tier (forward-compat seam mirroring `BuildSiteJob`); the
  agent runs in-process for now (gated by the governed provider). Worker-tier
  execution + per-run quota deferred.
- **M18 — bounded Tier-B coherence agent (Phase 3 core).** The differentiator from
  [ai-architecture.md](specs/ai-architecture.md), built the forward-compatible way:
  an **app-orchestrated bounded agent** over the single-call `AIProvider` (not a
  container/CLI harness), producing **typed data** that flows through the existing
  Tier-2 review queue — no parallel write path. Layers: (1) contract
  `ProposedChangeSet` + `validateProposedChangeSet` (block-ID integrity: refs must
  exist, reorder = permutation, agent never invents/reuses IDs; `coherence-edit`
  Tier-2 kind; `agent.run.*`/`reconcile.*` events) — 9 tests; (2) ai-assist
  `CoherenceHarness` boundary (engine swappable) + `createProviderCoherenceHarness`
  (strict ID-preserving prompt, tolerant JSON parse, version-stamp + schema-validate)
  + `createStubCoherenceHarness` — 6 tests; (3) package-ops `gatherCoherenceContext`
  / `applyProposedChangeSet` (applies update/create/reorder through `saveStudyGuide`
  only) wired into the `packageOps` facade — 8 tests; (4) thin web client
  `runCoherenceAgentAction` (governed provider: rate limit + token budget; queues one
  reviewable item per op) + `change-actions` accept branch (stale-tolerant) +
  `CoherencePanel` in the Review group. Built via two concurrent subagents on disjoint
  packages (ai-assist + package-ops). typecheck + all tests + web build green. **Needs
  a live in-app pass** (a configured AI provider). Next: M19 execution/gating.
- **Forward-compatibility guardrails + `PackageOps` boundary (pre-Phase-3 foundation).** To keep Phases 3–8 from entrenching anything the post-v1.0 UI/UX overhaul must redo: wrote [specs/forward-compatibility.md](specs/forward-compatibility.md) (durable-core-stays-presentation-free; extend via existing seams not parallel mechanisms; one validated write path; thin disposable client; per-phase decoupling notes; anti-pattern review checklist) and added CLAUDE.md architecture rules 3 (strengthened: all writers go through `packageOps`) + 9 (Phases 3–8 = durable logic + thin client). Implemented the **`PackageOps` boundary**: `packageOps(store, packageId)` in `@alembic/package-ops` exposes the canonical content operations (study guide, chapters, carrier assets, artifacts) as one typed object — the same surface for cloud (Supabase), local studio (FSA, M17.1), and the Phase-3 agent/worker, all carrying the two-repo/block-ID/layer validation. 69 package-ops tests; web typecheck clean. Existing web actions already route through package-ops; new writers bind to the facade.
- **M15 snapshots & citation — core done; compare/DOI deferred.** Snapshots are immutable Git tags on the public repo (github-bridge `getDefaultBranch`/`listTags`/`createTag`; web `createSnapshotAction`/`listSnapshotsAction`; `SnapshotsPanel` in the Publish & share group). Tagging the whole repo freezes content **and** carrier assets together, so the asset-permalink pinning (15.6) the carrier spec promised is satisfied by construction (repo-relative `materials/…` refs resolve to the tag). Citation: pure `generateCitationCff` (package-ops; SPDX license + version + author + date) committed via `addCitationAction`; each snapshot has a stable tag URL. Deferred: GitHub compare/restore, Zenodo DOI (15.4), `adaptedFrom.snapshot` (15.5, with the adaptation phase). 196 package tests green; web typecheck + build pass. **Completes v0.3 (M9–M17).**
- **M16 model gateway & task routing — core done; budgets wired; per-institution + compliance later.** ai-assist gained `GatewayProvider` (OpenAI-compatible, native fetch — OpenRouter/Portkey/OpenAI) and `modelForTask`/`DEFAULT_ROUTING` (subagent; 49 tests). `lib/ai` now **selects the provider from env** (gateway if `AI_GATEWAY_URL`+`AI_GATEWAY_API_KEY`, else Gemini — provider-swappable, CLAUDE.md rule 6), **routes the model per task kind**, and enforces an optional **per-user token budget** (`recent_ai_token_usage` RPC, migration 0007; `AI_TOKEN_BUDGET`; `BudgetExceededError` surfaced at all AI call sites) atop the existing rate limit. Usage stays attributable via `ai_invocations`. web typecheck + build pass. Deferred: per-institution quotas + usage dashboards, and the third-party data-handling/FERPA review (ops). **Migration 0007 awaits `supabase db push` to enforce budgets.**
- **M17 local mode (v1) — anonymous single-file studio + entitlement seam.** `/studio` (no account, nothing stored): New note / Open a `.md` or `.md.html` (carrier source extracted client-side via `@alembic/carriers`) / live preview / Save `.md` (local) or `.md.html` (built via stateless unauth `/api/render/md-html`); File System Access `showSaveFilePicker` with download fallback. Delivers goal.md's stated student use case (open a downloaded `.md.html`, annotate, save back). **Entitlement seam** `lib/entitlements.ts` (`resolveEntitlements`: anonymous→`{localFile}`, user→full) — the monetization hook; future paid plans add caps there only. Home page "(coming soon)" → real **"Open the studio"** CTA. web typecheck + build pass; `/studio` route compiles. **Needs an interactive pass** (File System Access). Deferred: structures/plots/slides editing in studio (editors need a storage-agnostic save callback), local *projects* (PackageOps/LocalPackageStore, v2), app-wide entitlement enforcement + Google auth + paid AI (with M16).
- **M12 import — lossless re-import + AI restructure done; foreign binaries & bulk-zip deferred.** The carrier payoff: package-ops `classifyImport` + web `importFileAction` bring a `.ketcher.svg`/`.plot.svg`/`.md.html`/`.slides.html`/`.md` file back deterministically (assets stored under `materials/`; document/markdown → blocks appended) — no AI. Lossy path: ai-assist `restructureToBlocks` (subagent) + `restructureImportAction` → Tier-2 `import-blocks` review (accept appends sections). `import.completed` event for provenance; imported markdown gets IDs on save. "Import content" panel in the Author group. Foreign binaries (docx/pdf/pptx/images) and bulk zip/folder upload **deferred to the worker tier** (heavy parsers, npm-flaky). 184 package tests green (incl. ai-assist 33, package-ops 64); web typecheck + build pass.
- **M13 document carriers — slides done; PDF designed + interim print.** Examined the orz extensions (`orz-slides-html-vscode`, `orz-md-pdf-vscode`) and found real design problems (per-slide source islands with no single source of truth; no format-version markers; embedded reveal.js; CDN KaTeX) — fixes captured in [carriers-and-assets.md §4a](specs/carriers-and-assets.md) to feed back. Built: renderer `slides.ts` (lightweight **self-contained** deck — no reveal/CDN) + migrated `.md.html` onto the shared carrier codec (old `md-source` files read as format 0); package-ops `generateSlidesArtifact` (one slide per section, derived artifact with source-block staleness, idempotent regen); contract `DerivedArtifactKind` += `slides`; web "Generate slides" in the **Generate** group (per [workspace-framework.md](specs/workspace-framework.md)) + View/Download via `/api/asset` + "Printable handout (PDF)" via browser Print. `.md.pdf` worker pipeline (Chromium/paged.js) deferred to the worker tier. 171 package tests green (contract 79, renderer 33, package-ops 59); web typecheck + build pass. Decision recap: lightweight deck · design-PDF-now + worker-later · unify `.md.html` now. **Needs an interactive slides render pass.**
- **M11b plots (`.plot.svg`) — code complete (11b.2/11b.3 ✅; 11b.1 🔄 pending a live browser pass).** Proved the carrier registry generalizes: the `plot` kind was already in `BUILTIN_KINDS`, so the picker, `/api/asset` route, preview rewrite, and store all accepted it unchanged. New work was only the **editor** (`plot-editor.tsx`: lazy-loads vendored Plotly basic — `pnpm fetch:plotly` → `/vendor/`, gitignored ~1 MB, deploy-fetched, **never bundled into the site**; spec textarea + live preview; `toImage` SVG → carrier) and **generalizing the shared bits**: `saveAssetAction` (kind-aware path/ext, replaces `saveStructureAssetAction`) + `AssetsPanel` (Draw structure / New chart; Edit by kind). 11b.3 is free — the carrier stores the rendered SVG so the published site needs no runtime. web typecheck + build green; needs an interactive render pass + `fetch:vendor` wired into the Vercel build. New `pnpm fetch:vendor` runs both Ketcher + Plotly fetches.
- **Local mode & entitlements design** ([specs/local-mode.md](specs/local-mode.md)). A light, **anonymous, local** editor (open/edit/save supported carrier files on disk; no account, cloud, or AI) built on the carrier self-containment. Modeled as **capabilities → entitlements** resolved in one place (`resolveEntitlements(identity)`): today anonymous→`{localFile}`, cloud user→all; future paid plans add `ai`/`cloudProject`/sync with **no feature-code changes** — the resolver is the monetization seam (OER content stays open; the *service* is the paid part). Storage stays behind `PackageStore` (new `LocalPackageStore` over File System Access); the editor gets a `PackageOps` interface (cloud=server actions, local=client) — the one real refactor. Decisions: anonymous-only for now (pluggable `AuthProvider` later); no AI for anonymous (AI is an entitlement). Added **M17** to the tracker (17.0 entitlement seam → 17.1 local PackageOps → 17.2 single-file studio → 17.3 client-capability audit; v2/v3/v4 later). Known risk flagged: purge Node-only deps from the browser path (e.g. `hashContent` → Web Crypto).
- **M11 chemistry structures — done & verified live.** The full draw→save→insert→preview round-trip works on alembic.orz.how (Ketcher canvas, `.ketcher.svg` carrier written via `writeAsset`, reference inserted, preview renders via `/api/asset`). First asset kind shipped on the carrier foundation. Delivery decision: **self-host + iframe** (chosen over bundling ketcher-react ~27 MB+ or a CDN). `pnpm fetch:ketcher` vendors the Ketcher v3.12.0 standalone build into `apps/web/public/ketcher/` (gitignored, 96 MB, fetched at deploy — zero JS-bundle impact). `ketcher-editor.tsx` embeds it in a lazy **same-origin** iframe (talks to `window.ketcher` directly — no postMessage) and produces a `.ketcher.svg` carrier (KetJSON source + rendered SVG) via `saveStructureAssetAction` → `writeAsset` → GitHub sync. Insert pipeline: `StructuresPanel` (searchable picker, Draw/Insert/Edit) + caret-aware `insertMarkdown`; preview rewrites `materials/…` refs to `GET /api/asset/[pkg]/[...path]` (store-served, public-only, fail-closed); ai-assist `suggestStructureAltText` powers "Describe with AI". web typecheck + build green. **Needs:** an interactive browser pass on the canvas + `pnpm fetch:ketcher` wired into the Vercel build command. Follow-ups: persist asset alt for re-insert; published-site asset path resolution (with M15 pinning).
- **M11.0 carrier foundation — done.** Built via two concurrent subagents on disjoint pure packages, integrated by hand. New **`@alembic/carriers`** (future orz-artifacts): pure carrier codec (`embedSource`/`extractSource`/`detectFormatVersion`/`hasCarrier`) for SVG (`<metadata id="orz-carrier">` CDATA) + HTML (non-exec `<script>`) with `]]>`/`</` escaping and legacy format-0 detection, plus the **kind registry** (`BUILTIN_KINDS`: ketcher/plot/md/slides; `getKindByExtension` longest-suffix) — 19 tests. **`package-contract`** gained the asset model (`AssetRecordSchema` with required alt text, `newAssetId`), the reference resolver (`assertPublicReference` fail-closed on private layers; `classifyReference`; `livePermalink`/`pinnedPermalink`), and pure **`validateProject(input, {knownCarrierExtensions})`** (kinds injected, no registry dep) — +25 tests. **`package-ops`** gained `listAssets`/`readAsset`/`writeAsset` over the public `materials/` layer (5 tests). Reuses existing `materials` layer — **no new layer** (contract v1 layer set stays closed). 242 package tests green; typecheck + web build pass. Next: M11 Ketcher editor (`.ketcher.svg`) on this foundation.
- **Migrations 0005 + 0006 applied to production** — M10 tier queue and M14 accessibility features now live.
- **Carriers & assets design** ([specs/carriers-and-assets.md](specs/carriers-and-assets.md)). Unifies `.ketcher.svg` / `.plot.svg` / `.md.html` / `.slides.html` / `.md.pdf` under one **carrier** primitive (renderable payload + embedded source + `kind`/`format` markers) with two roles (authored **assets** vs derived **documents**) and a **kind registry** as the single extension point. Assets are standalone, public, addressable, referenced by permalink (intra-package = searchable click-insert; inter-package = paste the universal permalink). Decisions locked: foundation-first; live path + pin-at-publish; reuse via permalink universality. Borrows ideas from the orz VS Code extensions but the Alembic contract is authoritative. **Re-sequenced v0.3** around a new **M11.0 carrier foundation** (gates M11/M12/M13; supersedes the orz gap #5 blocker): `orz-artifacts` codec + registry, carrier resolver over the public `materials` layer (no new layer — contract v1 layer set stays closed), asset records, `validate()` → M11 Ketcher → M11b plot → M13 document carriers → M12 import/local-upload.

### 2026-06-11
- Planning docs: product vision, [Roadmap](Roadmap.md), [InitialReleasePlan](InitialReleasePlan.md) (Gemini as dev-phase AI provider). Repo live at github.com/wangyu16/Alembic; CI green.
- **M0 complete.** Monorepo scaffold (7 projects) + CI; `package-contract` (layers, blocks, manifest, two-repo invariant, adversarial tests); contract v1 spec; orz-markdown spike (heading block IDs work natively via `{{attrs[#blk-…]}}`; 5 upstream gaps filed, none blocking M1–M2); CLAUDE.md + this tracker.
- **M1 code complete.** Supabase schema (profiles/packages/sandbox_files/research_events, RLS), GitHub sign-in (Supabase Auth), app shell, sandbox creation via new `@alembic/package-ops` (M2.1 started early). Contract refined: repo refs optional (sandbox packages have none until graduation). orz-markdown Phase A fixes on branch `phase-a-alembic-fixes` (see [orz-stack ConsolidationPlan](../../orz-stack/docs/ConsolidationPlan.md)).

### 2026-06-14
- **orz-markdown 1.1.0 published** (Phase A merged: TOC ordering fix, Agent Skill shipped + block-ID rules, trailing-space fix).
- **M2.** Block-source parser (`{{attrs[#blk-…]}}`, code-fence aware, idempotent); load/save study guide with ID minting + integrity validation; block editor (add/edit/reorder/delete) + debounced live preview; authoring research events. **M1 + M2 live-verified** end to end against a real Supabase project. [LocalSetup.md](LocalSetup.md) added. Nav auth-state fix; [TechNotes](TechNotes.md) (auth-nav dynamic rendering).
- **M3.** Derived-artifact records + hash-based staleness; ai-assist drafting + worksheet generation (ID strip/reattach); governed provider (per-user rate limit + `ai_invocations` governance log, migration 0002); editor AI draft + worksheet panel; `ai.*` events. **Live-verified** against real Gemini (`gemini-2.5-flash`) + Supabase. Governed-provider failures surfaced (not swallowed); worksheet viewer added.
- **M4.** `.md.html` dual-extension export (`buildMdHtml`/`extractMdHtml`, `data-orz-format` marker, byte-identical round-trip, embedded source hash); download routes; unique-filename fix so re-downloads stay valid `.md.html`.
- **M5.** github-bridge with native fetch + node:crypto (RS256 App JWT, Git Data API commits, generate-from-template) — no Octokit; commit transport enforces the two-repo invariant (adversarial-tested). Connect publishing, sandbox→GitHub graduation, save→commit, version list, restore (migration 0003; [GitHubAppSetup.md](GitHubAppSetup.md)). **Live-verified:** published a real repo pair; public repo's full history has 0 `private-instructor` paths; restore round-trip tested.
- **M6.** App-side `buildSite` → clean `gh-pages` (orphan commit) + auto-enable Pages; release gates (license/content/IDs/separation) + Tier-3 confirm; in-app `/site-preview`. **Live-verified:** study guide live on GitHub Pages (after accepting the App's Pages permission; site-publish messaging clarified). Build runs in-process for v0.1.
- **M7.** Public `/portal` index + gated register/unregister (Tier-3, migration 0004); app `error.tsx`/`not-found.tsx` + retryable educator-facing errors.
- **M8 docs.** Educator [Quickstart](Quickstart.md) + production [Deployment](Deployment.md) guide.
- **UI polish** (impeccable + taste-skill): dark-elegant token system + component classes (`.btn`/`.panel`/`.field`/`.chip`), serif/sans pairing (Source Serif 4 + Geist), dropped uppercase eyebrows + ghost-cards + over-rounding, reduced-motion, focus rings. **All rendered output uses orz-markdown `dark-elegant-1`** (vendored `theme-css.ts`, shared `themedDocument`, shown in iframes) — preview, worksheet viewer, student site, `.md.html`. (Superseded by the light theme — see the 2026-06-16 Light theme entry: in-app rendering + `.md.html` switch to `light-neat-1` when selected.) Collapsible study-guide sections.

### 2026-06-15
- Course→chapter structure documented ([specs/course-structure.md](specs/course-structure.md)); `chapterStudyGuidePath` centralizes the convention; multi-chapter path kept open (additive — v0.1 single chapter is the degenerate case).
- orz family logo in the header; `A` favicon.
- Internal navigation switched to `next/link` (0 lint errors).
- **Production live at https://alembic.orz.how (M8.2).** Vercel (project `alembic`, root `apps/web`, Node 22, pnpm monorepo; env vars set; Supabase Auth + GitHub App callbacks → production; Cloudflare CNAME; Git auto-deploy on push to `main`).
- No-lock-in build config committed to the public template (criterion #3); portal migration 0004 applied. Design notes added: [package-lifecycle.md](specs/package-lifecycle.md) (rename/delete) and [ai-architecture.md](specs/ai-architecture.md) (execution + model access).
- **Phase 2 planned.** Modularized plan + tracker added above (M9–M16: multi-chapter, risk-tiered approvals, chemistry/structures, import, slides/PDF, accessibility, snapshots/citation, model gateway).
- **M9 multi-chapter courses — done.** Built via two concurrent subagents (package-ops chapter CRUD; renderer `buildCourseSite`) on the committed contract foundation (chapters index), integrated by hand: editor ChapterBar (add/select/rename/reorder/delete), per-chapter edit+save, GitHub-backed packages sync chapter files + manifest, and site build + in-app preview render the multi-chapter course (index TOC + per-chapter pages + prev/next). Fully additive — single-chapter packages unchanged. 134 package tests green; web typecheck + build pass. Follow-ups: `.md.html` export currently covers the active chapter only; the standalone no-lock-in build concatenates chapters rather than per-chapter pages.
- **M14 accessibility — done (14.1/14.2/14.3).** New pure `@alembic/a11y` package (built by subagent; 33 tests) audits *rendered HTML* — never a second markdown parser — for img-alt, heading-order, empty-heading, link-text, table-header, with educator-facing messages and per-block locations. ai-assist gained `suggestA11yFix` (subagent; alt/link-text remediation, 17 ai-assist tests). Web: editor "Accessibility" panel (findings + locations + "Fix with AI" → Tier-2 queue), `accessibility` manifest field (additive; "Re-check & record" rolls up all chapters), portal badge (`portal_registrations.accessibility_status`, migration 0006, set at register). AI fixes reuse the M10 Tier-2 queue (`a11y-fix` kind) — reviewable, never auto-applied; accept applies a located source rewrite. Contrast is theme-guaranteed (dark-elegant = AA), so not a per-content check. 195 package tests green; web typecheck + build pass. Migrations 0005 + 0006 applied to production (2026-06-16) — tier queue + a11y features live.
- **M10 risk-tiered approvals — done (10.1/10.2/10.4/10.5; 10.3 deferred to feature milestones).** Contract foundation (`change-tiers.ts`: `BASE_TIER`, `effectiveTier`=max(base,minTier), `canAutoApply`; Tier-3 pinned, never lowerable; 6 tests) + tidy transform (`tidyStudyGuide`, 15 tests, subagent). Infra: `package_changes` table + `packages.review_all` (migration 0005, applied to production 2026-06-16), event taxonomy (`tier1.auto-applied`/`change.undone`/`review.queued` kept separate from human `ai.suggestion.accepted`/`rejected`). Web "Changes & review" panel: **Tier-1** tidy auto-applies and is undoable (restores stored inverse); **Tier-2** queue holds AI drafts (no inline apply) with per-item Accept/Reject + Accept-all (commits deduped per path); **policy** "Review all AI changes" toggle routes even tidy into the queue. All mutating actions sync to the public repo for GitHub-backed packages. 154 package tests green; web typecheck + build pass.

## Known doc drift (2026-07-09 audit)

A coherence audit (two parallel read-only agents + direct verification)
found several specs describing superseded behavior. Fixed directly in this
pass: `docs/specs/document-model.md` (§1 principles + the per-chapter table
— study guide/slides/practice now correctly show `.md` committed /
`.md.html`+`.slides.html` generated, and slides is marked independently
authored, not derived), `docs/specs/course-structure.md` (same slides
correction + practice added to the chapter breakdown),
`docs/specs/ai-operations.md` and `docs/specs/orz-host-ai.md` (hosted-editor
AI bridge status — live for study guide + slides, only paged still pending;
`orz-slides@0.6.0`→`0.6.1` release history added), and the `generateWorksheetAction`
mention in `ai-operations.md`'s migration list (removed as dead code
2026-07-09).

**Not fixed in this pass** — flagged so the drift isn't lost:

- **`.md.html` as the committed source of record** — still stated in
  `docs/specs/package-contract-v2.md` ("Study guide = one `.md.html` file")
  and `docs/specs/package-layout.md`, and implicitly in
  `docs/specs/self-contained-editing.md`. Actual model (owner decision,
  2026-07-08, "lean-source"): the committed source is lean markdown
  (`study-guide/`, `slides/`, `practice/` — `.md`); the self-contained file is
  generated on demand, purely as the editing/viewing surface, never itself
  committed. These three are more foundational/architectural than
  `document-model.md`/`course-structure.md` (which code comments cite
  directly) and would benefit from a careful full pass rather than a
  targeted edit — deferred.
- **No single current page states "these are the chapter's document types
  and how each works."** `document-model.md` §2's table is the closest
  candidate and is now current (per the fixes above), but it's still one
  candidate among several partially-overlapping docs (this file's banner,
  `course-structure.md`, `self-contained-editing.md`) rather than a single
  canonical source — a docs-organization gap, independent of any one
  factual error, worth a real consolidation pass later.

None of the above are code bugs — the code (verified via typecheck/test/
build + live browser checks throughout this session) matches what this file
and the fixed specs say, not what the three still-stale specs say.
