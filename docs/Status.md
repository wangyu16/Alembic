# Alembic Status Tracker

Live view of what is done, in progress, and coming. Update this file in the
same commit as the work it tracks. Statuses: ✅ done · 🔄 in progress · ⬜ pending · ⏸ deferred.

**Production:** live at https://alembic.orz.how (Vercel project `alembic`, root `apps/web`, Node 22; Cloudflare DNS; Git auto-deploy on push to `main`).

**Current focus: Phase 2 (v0.2–v0.3) — authoring depth & chemistry-first.** v0.1 is built, deployed, and live-verified end to end (the M8.3 pilot is the only remaining v0.1 activity, ongoing). The Phase 2 modularized plan + tracker is below ("Phase 2 sub-modules"). See [LocalSetup.md](LocalSetup.md) + [GitHubAppSetup.md](GitHubAppSetup.md).

**Deferred chore:** bump renderer to orz-markdown 1.1.0 (published) — reverted to 1.0.0 temporarily because the npm registry was unreachable during M2 and CI uses `--frozen-lockfile`. Behavior is unaffected (1.0.0 supports the attrs block-ID syntax); redo when the registry is reachable.

## Phase overview (full project)

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Foundations & contracts | ✅ |
| 1 | Initial release: end-to-end loop (v0.1) | ✅ built + deployed (pilot M8.3 ongoing) |
| 2 | Authoring depth & chemistry-first (Ketcher, import, tiers, snapshots) | 🔄 planned (M9–M16 below) |
| 3 | Agent harness & reconciliation | ⬜ |
| 4 | Assessment & question templates | ⬜ |
| 5 | Adaptation ecosystem | ⬜ |
| 6 | Portal & discovery | ⬜ |
| 7 | Research operations & study readiness | ⬜ |
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
| 1. TOC vs custom heading IDs ordering bug (one-line fix) | M2 (preview with TOC) | ⬜ |
| 2. Ship Agent Skill in the npm tarball | M3 (AI drafting) | ⬜ |
| 3. Add ID-preservation rules to the Agent Skill | M3 (AI drafting) | ⬜ |
| 4. Versioned embed/extract module + format-version marker | M4 (.md.html export) | ⬜ |
| 5. Attribute pass-through for plugin blocks (equations/structures) | Phase 2 | ⬜ |

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
| 8.1 | Demo content + educator quickstart (1 page) | a new user can follow it unaided | 🔄 [Quickstart.md](Quickstart.md) written; demo content via quickstart sample |
| 8.2 | Deploy at alembic.orz.how (Cloudflare DNS → Vercel) | production URL serves the app | ✅ live on Vercel (project `alembic`, root `apps/web`); https://alembic.orz.how serves (200, valid TLS); Supabase Auth + GitHub App callbacks set to production |
| 8.3 | Pilot with 1–3 chemistry educators; fix top frictions | full loop completed by a non-developer; release criteria met | ⬜ after deploy |

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

- **M8.3 pilot** — run with 1–3 chemistry educators against criteria 1 & 6
  (the last substantive gate).
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

- **v0.2 (authoring core):** M9 multi-chapter → M10 risk-tiered approvals →
  M11 chemistry/structures → M14 accessibility.
- **v0.3 (production depth):** M12 import (→ M9, M10) → M13 slides/PDF +
  artifact lifecycle (→ orz-artifacts) → M15 snapshots & citation →
  M16 model gateway.

**Cross-cutting dependencies:**
- **orz-stack Phase B** (`orz-artifacts`: versioned embed/extract) gates M13;
  **orz-markdown gap #5** (attrs on plugin blocks) gates M11 structure anchors
  (see [orz-stack/docs/ConsolidationPlan.md](../../orz-stack/docs/ConsolidationPlan.md)).
- All AI features route through the **risk tiers (M10)**; the **execution &
  model-access design** is in [specs/ai-architecture.md](specs/ai-architecture.md);
  the **course/chapter model** in [specs/course-structure.md](specs/course-structure.md).

**Phase 2 exit criteria:** an educator builds a multi-module chemistry course
(drawn structures, imported source materials), generates slides + printable
PDFs, snapshots and cites an offering, and works with risk-tiered AI assistance
under bounded, attributable cost.

### M9 — Multi-chapter courses

Course = one package = one static site with an index + many chapters (v0.1's
single chapter is the degenerate case). See [course-structure.md](specs/course-structure.md).

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 9.1 | Manifest `chapters` index + contract types (ordered chapters) | old packages (no index) read as one chapter; schema versioned, migration explicit | ⬜ |
| 9.2 | package-ops chapter CRUD + ordering (over `chapterStudyGuidePath`) | unit tests: create / list / reorder / rename / delete chapters | ⬜ |
| 9.3 | renderer multi-page `buildSite` (index/TOC + per-chapter pages + inter-chapter nav) | site builds N chapter pages + index; single-chapter output unchanged | ⬜ |
| 9.4 | Editor chapter switcher wrapping the single-doc editor | author a 2-chapter course; switch/reorder; per-chapter save | ⬜ |
| 9.5 | Course index = student-facing chapter TOC | published landing lists chapters with working links | ⬜ |
| 9.6 | Concepts + objectives at course and chapter level (data layer) | structured records per chapter validate against contract | ⬜ |

*Exit:* author and publish a 3-chapter course as one site.

### M10 — Risk-tiered approvals

Generalize the single Tier-3 publish gate into Tiers 1/2/3 (goal.md §2).

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 10.1 | Tier-1 auto-apply + visible changelog + one-click undo (formatting, link repair, ID/schema housekeeping) | a tier-1 fix applies silently, shows in changelog, undoes cleanly; never changes meaning/public-private | ⬜ |
| 10.2 | Tier-2 batch review queue (accept / edit / reject, batchable) | drafted/restructured items queue; batch accept/reject works | ⬜ |
| 10.3 | Tier-3 itemized review extended (assessments, license/attribution, suggest-back) | each tier-3 item reviewed individually with an explanation | ⬜ |
| 10.4 | Tier policy config (tighten to "review everything"; loosening below Tier-3 impossible) | policy enforced; publish always requires explicit approval | ⬜ |
| 10.5 | Events: Tier-1 auto-applies logged as a separate category | acceptance-rate metrics reflect human decisions only | ⬜ |

*Exit:* AI changes flow through the correct tier; publish stays gated.

### M11 — Chemistry-first: structures

Native chemical-structure editing as addressable blocks.

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 11.1 | Ketcher integration in the editor (draw/edit structures) | draw a structure; SMILES/molfile captured | ⬜ |
| 11.2 | Structure block (`kind: structure`) with SMILES/molfile as source + block-ID anchor | structure block round-trips with a stable ID | ⬜ (needs orz gap #5) |
| 11.3 | Structure rendering in preview / site / exports | structure renders in preview and the published site | ⬜ |
| 11.4 | AI alt-text for structures from SMILES/molfile (chemistry-first a11y) | alt text generated then reviewed (Tier-2) | ⬜ |
| 11.5 | orz-markdown gap #5 upstream (attrs on plugin blocks) | equation/structure blocks accept `{{…[#blk-…]}}` | ⬜ (orz-stack) |

*Exit:* a chemistry section with a drawn structure publishes with alt text.

### M12 — Import pipeline

Raw materials → study-guide blocks (Tier-2 reviewed).

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 12.1 | Upload/ingest: Word (.docx), PDF, PPTX, images, text | files accepted and stored for processing | ⬜ |
| 12.2 | Worker-side extraction → normalized text/structure | each format yields normalized content | ⬜ |
| 12.3 | AI-assisted restructuring into blocks (Tier-2 queue) | imported doc becomes reviewable study-guide blocks | ⬜ |
| 12.4 | Provenance: source records + attribution for imports | imported blocks carry source + attribution | ⬜ |
| 12.5 | Imported-markdown ID fallback (sidecar/content-hash until native IDs) | un-ID'd import matched until IDs are assigned (contract §6 r9) | ⬜ |

*Exit:* a Word/PDF dump becomes a reviewed study-guide chapter.

### M13 — Artifacts & dual-extension formats

Slides + PDF artifacts; complete the derived-artifact lifecycle.

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 13.1 | `orz-artifacts` shared package (versioned embed/extract; orz-stack Phase B) | embed/extract for `.md.html`/`.slides.html`/`.md.pdf` with format markers; legacy = format 0 | ⬜ (orz-stack) |
| 13.2 | `.slides.html` generation from blocks + dual-extension | slide deck generated; source embedded + extractable | ⬜ |
| 13.3 | `.md.pdf` generation (worker-side, paged.js/Chromium) + dual-extension | PDF generated with embedded source | ⬜ |
| 13.4 | Slides/PDF as derived artifacts (source blocks + staleness) | edit a source block → slide flagged stale | ⬜ |
| 13.5 | AI-assisted merge for stale artifacts (regenerate / merge / keep-mine complete) | merge applies block changes while preserving local edits, with review | ⬜ |

*Exit:* generate slides + a PDF handout from a chapter; both editable and drift-tracked.

### M14 — Accessibility

WCAG 2.1 AA checks + status (goal.md §2).

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 14.1 | Automated a11y checks (heading order, alt text, contrast, link text) on study guide + site | failing items flagged with locations | ⬜ |
| 14.2 | Accessibility status in metadata + portal indicator | status recorded and shown on the index | ⬜ |
| 14.3 | AI remediation suggestions (Tier-2) | suggested fixes are reviewable | ⬜ |

*Exit:* a package reports and improves its accessibility status.

### M15 — Snapshots & citation

Named immutable versions + citable scholarly output (goal.md §5).

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 15.1 | Snapshot = Git tag via the bridge; create / list | a named snapshot is created and listed | ⬜ |
| 15.2 | Restore-from / compare snapshots | "what changed between offerings" shown in educator language | ⬜ |
| 15.3 | Citation: stable snapshot URL + version; `CITATION.cff` generation | citation metadata generated per snapshot | ⬜ |
| 15.4 | Opt-in DOI minting (Zenodo or equivalent) | snapshot → DOI on opt-in | ⬜ |
| 15.5 | Adaptation/citation target snapshots (`adaptedFrom.snapshot`) | an adaptation references a snapshot, not a moving head | ⬜ |

*Exit:* snapshot a course offering, cite it, compare two offerings.

### M16 — Model gateway & task routing

Cost/scale via a gateway + per-task model selection. See [specs/ai-architecture.md](specs/ai-architecture.md).

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 16.1 | Gateway provider (Portkey/OpenRouter) behind `AIProvider` | provider swap with no workflow-code change | ⬜ |
| 16.2 | task→model routing map (cheap/fast vs strong) | each task uses its configured model | ⬜ |
| 16.3 | Budgets / quotas per user + per institution; usage attribution | quota enforced; usage attributable | ⬜ |
| 16.4 | Governed logging via the gateway; data-handling review (FERPA/IRB) | prompts/outputs logged under governance; third-party data handling reviewed | ⬜ |

*Exit:* per-task model selection + per-user budgets live; still provider-swappable.

## Log

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
- **UI polish** (impeccable + taste-skill): dark-elegant token system + component classes (`.btn`/`.panel`/`.field`/`.chip`), serif/sans pairing (Source Serif 4 + Geist), dropped uppercase eyebrows + ghost-cards + over-rounding, reduced-motion, focus rings. **All rendered output uses orz-markdown `dark-elegant-1`** (vendored `theme-css.ts`, shared `themedDocument`, shown in iframes) — preview, worksheet viewer, student site, `.md.html`. Collapsible study-guide sections.

### 2026-06-15
- Course→chapter structure documented ([specs/course-structure.md](specs/course-structure.md)); `chapterStudyGuidePath` centralizes the convention; multi-chapter path kept open (additive — v0.1 single chapter is the degenerate case).
- orz family logo in the header; `A` favicon.
- Internal navigation switched to `next/link` (0 lint errors).
- **Production live at https://alembic.orz.how (M8.2).** Vercel (project `alembic`, root `apps/web`, Node 22, pnpm monorepo; env vars set; Supabase Auth + GitHub App callbacks → production; Cloudflare CNAME; Git auto-deploy on push to `main`).
- No-lock-in build config committed to the public template (criterion #3); portal migration 0004 applied. Design notes added: [package-lifecycle.md](specs/package-lifecycle.md) (rename/delete) and [ai-architecture.md](specs/ai-architecture.md) (execution + model access).
- **Phase 2 planned.** Modularized plan + tracker added above (M9–M16: multi-chapter, risk-tiered approvals, chemistry/structures, import, slides/PDF, accessibility, snapshots/citation, model gateway).
