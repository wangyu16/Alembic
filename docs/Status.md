# Alembic Status Tracker

Live view of what is done, in progress, and coming. Update this file in the
same commit as the work it tracks. Statuses: ✅ done · 🔄 partially shipped (remainder tracked in "Phase 2 deferred follow-ups") · ⬜ pending · ⏸ deferred.

**Production:** live at https://alembic.orz.how (Vercel project `alembic`, root `apps/web`, Node 22; Cloudflare DNS; Git auto-deploy on push to `main`).

**Current focus: Phase 3 (v0.4) core complete — agent harness & repository intelligence.** M18 (bounded Tier-B coherence agent), M19 (agent-run job seam), M20 (external-edit reconciliation), M21 (leakage audit + remediation runbook) — the Phase-3 core (M18–M21) — are all built and CI-green. The concept-map-first planning layer (M9.6) is now wired end to end as the Phase-4 prerequisite (concepts/objectives → study-guide drafting → coherence-agent checks). Phase 2 (M9–M17) core is complete; v0.1 is deployed (not yet *shipped* — 2 of 6 release criteria pending the M8.3 pilot). Remaining live passes: M18 coherence agent + M20 reconcile + M9.6 AI drafting/agent linkage (need a connected/deployed environment — see Pending operator actions). Heavier deferrals (worker-tier PDF/foreign-import + agent execution, one-click remediation, studio editing/local projects) remain tracked below. Next phase: Phase 4 (assessment & question templates). See [LocalSetup.md](LocalSetup.md) + [GitHubAppSetup.md](GitHubAppSetup.md).

### Pending operator actions (human-in-the-loop)

These are the only things blocking full production parity with the code:

1. **Apply migration `0007_ai_budget.sql`** (`supabase db push` or dashboard) — enables the per-user AI token budget (dormant until `AI_TOKEN_BUDGET` is also set). 0005 + 0006 are already applied.
1b. **Apply migration `0008_reconcile.sql`** — adds `packages.last_synced_sha` for M20 external-edit reconciliation (additive column; safe to backfill NULL).
2. **Set the Vercel build command to run `node ../../scripts/fetch-vendor.mjs && next build`** (not `fetch-ketcher`) so **Plotly** is vendored too — otherwise the plot editor 404s on its runtime in production.
3. **Interactive verification passes** (can't run in CI): plot render (M11b), slides render (M13), studio File System Access open/save (M17). Ketcher (M11) is already verified live.
4. **Set the Portkey env vars in Vercel** (`AI_GATEWAY_URL=https://api.portkey.ai/v1`, `AI_GATEWAY_API_KEY`, `AI_MODEL_DEFAULT/FAST/STRONG` = `@<provider-slug>/<model>`) to verify the **M18 coherence agent** live. Local dev can't reach Portkey from this machine (the dev Mac's security/firewall blocks the `node` binary's outbound — `curl` works, `node` ETIMEDOUTs — not an app issue); Vercel's egress is clean. See [ai-architecture.md](specs/ai-architecture.md).

**Deferred chore:** bump renderer to orz-markdown 1.1.0 (published) — reverted to 1.0.0 temporarily because the npm registry was unreachable during M2 and CI uses `--frozen-lockfile`. Behavior is unaffected (1.0.0 supports the attrs block-ID syntax); redo when the registry is reachable.

## Phase overview (full project)

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Foundations & contracts | ✅ |
| 1 | Initial release: end-to-end loop (v0.1) | ✅ built + deployed (not yet *shipped* — 2 of 6 release criteria pending the M8.3 pilot) |
| 2 | Authoring depth & chemistry-first (tiers, a11y, carriers & assets: Ketcher/plots/slides/PDF, import, snapshots, gateway, local mode) | ✅ core built (M9–M17); documented deferrals → worker tier (PDF, foreign import), studio editing/projects, DOI/compare, per-institution quotas |
| 3 | Agent harness & reconciliation | ✅ core built (M18 coherence agent, M19 job seam, M20 reconciliation, M21 leakage audit + runbook); deferred: worker-tier agent execution, one-click remediation, private-repo reconcile |
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
| 11b.1 | Plot editor (Plotly spec) → `.plot.svg` carrier | author a chart; SVG + embedded spec saved | 🔄 `plot-editor.tsx` (lazy-loads vendored Plotly basic via `pnpm fetch:plotly` → `/vendor/`, gitignored, ~1 MB; spec textarea + live preview; `toImage` SVG → `saveAssetAction`). **Render needs a live browser pass** (can't run in CI) |
| 11b.2 | Registered as a kind; reuses §11.2 insert/search path with no new plumbing | plot assets appear in the same picker as structures | ✅ `plot` already in `BUILTIN_KINDS`; generalized `saveAssetAction` (kind-aware path/ext) + `AssetsPanel` (Draw structure / New chart; Edit by kind) — **no new server/route/store code** (proves the registry generalizes) |
| 11b.3 | Static-SVG render on the published site (no heavy runtime) | chart renders without bundling Plotly into the site | ✅ by design — the carrier stores the rendered SVG; the site shows it via `<img>`; Plotly is authoring-only (vendored, never bundled into the site) |

*Exit:* ✅ a second asset type ships by registration + one editor — the shared pipeline (picker, save, `/api/asset`, preview) was reused unchanged. Render needs an interactive pass (like Ketcher).

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
| 15.5 | Adaptation/citation target snapshots (`adaptedFrom.snapshot`) | an adaptation references a snapshot, not a moving head | ⬜ deferred (adaptation is a later phase; the contract field lands with it) |
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

*Exit:* per-task model selection + per-user budgets live; still provider-swappable. **Migration 0007 awaits `supabase db push` for budget enforcement.**

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
3-way merge for same-file conflicts are future. Migration 0008 awaits `db push`.

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

### 2026-06-16
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
- **M13 document carriers — slides done; PDF designed + interim print.** Examined the orz extensions (`orz-slides-html-vscode`, `orz-md-pdf-vscode`) and found real design problems (per-slide source islands with no single source of truth; no format-version markers; embedded reveal.js; CDN KaTeX) — fixes captured in [carriers-and-assets.md §4a](specs/carriers-and-assets.md) to feed back. Built: renderer `slides.ts` (lightweight **self-contained** deck — no reveal/CDN) + migrated `.md.html` onto the shared carrier codec (old `md-source` files read as format 0); package-ops `generateSlidesArtifact` (one slide per section, derived artifact with source-block staleness, idempotent regen); contract `DerivedArtifactKind` += `slides`; web "Generate slides" in the **Generate** group (per [editor-layout.md](specs/editor-layout.md)) + View/Download via `/api/asset` + "Printable handout (PDF)" via browser Print. `.md.pdf` worker pipeline (Chromium/paged.js) deferred to the worker tier. 171 package tests green (contract 79, renderer 33, package-ops 59); web typecheck + build pass. Decision recap: lightweight deck · design-PDF-now + worker-later · unify `.md.html` now. **Needs an interactive slides render pass.**
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
- **UI polish** (impeccable + taste-skill): dark-elegant token system + component classes (`.btn`/`.panel`/`.field`/`.chip`), serif/sans pairing (Source Serif 4 + Geist), dropped uppercase eyebrows + ghost-cards + over-rounding, reduced-motion, focus rings. **All rendered output uses orz-markdown `dark-elegant-1`** (vendored `theme-css.ts`, shared `themedDocument`, shown in iframes) — preview, worksheet viewer, student site, `.md.html`. Collapsible study-guide sections.

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
