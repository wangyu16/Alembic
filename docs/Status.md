# Alembic Status Tracker

Live view of what is done, in progress, and coming. Update this file in the
same commit as the work it tracks. Statuses: ✅ done · 🔄 in progress · ⬜ pending · ⏸ deferred.

**Production:** live at https://alembic.orz.how (Vercel + Cloudflare DNS). Remaining v0.1 work is the pilot (M8.3).

**Current focus: v0.1 (Phase 1) — milestone M8 (pilot & ship).** M1–M6 live-verified — the full loop runs end to end including a live GitHub Pages student site (https://wangyu16.github.io/test-chemistry-gegpm8vz-oer/). M7 (portal index + error boundaries) code complete; **live verify needs migration 0004 applied.** See [LocalSetup.md](LocalSetup.md) + [GitHubAppSetup.md](GitHubAppSetup.md).

**Deferred chore:** bump renderer to orz-markdown 1.1.0 (published) — reverted to 1.0.0 temporarily because the npm registry was unreachable during M2 and CI uses `--frozen-lockfile`. Behavior is unaffected (1.0.0 supports the attrs block-ID syntax); redo when the registry is reachable.

## Phase overview (full project)

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Foundations & contracts | ✅ |
| 1 | Initial release: end-to-end loop (v0.1) | 🔄 |
| 2 | Authoring depth & chemistry-first (Ketcher, import, tiers, snapshots) | ⬜ |
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
| 5.4 | Save → readable commits; version list; restore | restore round-trip works; history readable in educator language | ✅ code done; live-verified publish commits; restore round-trip pending a manual restore test |
| 5.5 | Sandbox → GitHub graduation | sandbox content becomes initial commits with provenance preserved | ✅ live-verified: sandbox content published to the repo pair |

### M6 — Build, publish, preview

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 6.1 | Job queue (pg-boss on Supabase) + worker consumption | enqueued job runs in worker; status reported back | ⏸ deferred — v0.1 builds in-process on publish (orz-markdown is fast, content small; build is a callable, ready to move to the worker tier later) |
| 6.2 | Build job: static build → Pages push | live GitHub Pages URL; renderer version stamped; build config committed | 🔄 code done (`buildSite` → push to `gh-pages` + enable Pages; renderer version in build-info; build config in repo templates); live verify pending Pages:write |
| 6.3 | Publish flow: Tier-3 approval screen + release gates | gates block bad packages with educator-facing reasons; approval required | ✅ release gates (license/content/IDs/separation) + Tier-3 confirm; failures shown in educator language (unit-tested) |
| 6.4 | In-app student-page preview (same renderer path as build) | preview matches published output | ✅ `/site-preview` renders `buildSite` index in an isolated iframe — same build path |

### M7 — Portal index & hardening

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 7.1 | Package registration + generated public index page | published package appears on index after gates | 🔄 code done (gated register/unregister, public `/portal` index, nav link); live verify pending migration 0004 |
| 7.2 | Failure recovery UX (build, GitHub API, AI provider failures) | each failure mode shows actionable educator-facing message | ✅ retryable educator-facing errors across publish/site/AI/save/restore + app error.tsx / not-found.tsx |

### M8 — Pilot & ship

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 8.1 | Demo content + educator quickstart (1 page) | a new user can follow it unaided | 🔄 [Quickstart.md](Quickstart.md) written; demo content via quickstart sample |
| 8.2 | Deploy at alembic.orz.how (Cloudflare DNS → Vercel) | production URL serves the app | ✅ live on Vercel (project `alembic`, root `apps/web`); https://alembic.orz.how serves (200, valid TLS); Supabase Auth + GitHub App callbacks set to production |
| 8.3 | Pilot with 1–3 chemistry educators; fix top frictions | full loop completed by a non-developer; release criteria met | ⬜ after deploy |

## Release criteria (v0.1)

Tracked in [InitialReleasePlan.md](InitialReleasePlan.md) §4 — all six must
hold before calling v0.1 shipped.

## Log

- 2026-06-11 — **UI polish pass** (impeccable + taste-skill guidance). Dark-elegant app theme: OKLCH-ish token system + component classes (`.btn`, `.panel`, `.field`, `.chip`), serif/sans pairing (Source Serif 4 + Geist), dropped the uppercase "eyebrow" labels, removed ghost-card border+shadow and over-rounding, reduced-motion handling, focus rings. **All rendered output now uses orz-markdown's `dark-elegant-1` theme** (vendored into `@alembic/renderer` as `theme-css.ts`; shared `themedDocument`): in-app preview, worksheet viewer, student site, and `.md.html` exports render identically in iframes. Theme exposure is a candidate for the shared `orz-artifacts` package (consolidation Phase B).

- 2026-06-11 — M0.1, M0.2 complete; repo live at github.com/wangyu16/Alembic; CI green. M0.3 spec + M0.4 spike started.
- 2026-06-11 — **M0 complete.** Contract spec written (docs/specs/package-contract-v1.md); orz-markdown spike done: heading block IDs work natively via `{{attrs[#blk-…]}}`; 5 upstream gaps filed in the table above (none block M1–M2). CLAUDE.md + this tracker added.
- 2026-06-11 — **M1 code complete.** Supabase migration (profiles/packages/sandbox_files/research_events with RLS), GitHub sign-in via Supabase Auth, app shell, sandbox package creation through new `@alembic/package-ops` (M2.1 started early). Contract refined: `publicRepo` now optional (sandbox packages have no repos until graduation). Live verification awaits the user's Supabase project + GitHub OAuth app. orz-markdown Phase A fixes in progress on branch `phase-a-alembic-fixes` (see orz-stack/docs/ConsolidationPlan.md).
- 2026-06-11 — **orz-markdown 1.1.0 published.** Phase A merged + on npm (TOC fix, shipped Agent Skill + block-ID rules, trailing-space fix).
- 2026-06-11 — **M2 code complete.** Block-source parser in package-contract (`{{attrs[#blk-…]}}`, code-fence aware, idempotent); `@alembic/package-ops` load/save study guide with ID minting + integrity validation on save; block editor UI (add/edit/reorder/delete) with debounced server-rendered live preview; research events for create/save. 59 unit tests green. Live verify of the editor pending credentials.
- 2026-06-11 — **M1 + M2 live-verified.** Supabase project provisioned, migration applied (4 tables, RLS). Full loop run against real backend: GitHub sign-in → workspace → create package → editor (seeded blocks load) → live preview (chemistry + KaTeX) → save. Setup steps documented in [LocalSetup.md](LocalSetup.md).
- 2026-06-11 — **M3 live-verified.** In-app AI confirmed against real Gemini + Supabase (migration 0002 applied): drafted a section, generated a worksheet from selected blocks, governance log writing (no errors). Worksheet viewer added (open generated worksheets).
- 2026-06-11 — **M6 live-verified.** Published study guide live on GitHub Pages. Root cause of the missing URL: App's new Pages permission was pending acceptance on the installation (fixed: accept the update; site-publish messaging clarified). Full v0.1 loop now works end to end with a live student site.
- 2026-06-11 — **M7 code complete.** Public discovery index (`/portal`, public read via RLS) + gated register/unregister (Tier-3) with `portal_registrations` (migration 0004); nav "Discover" link; app-level error.tsx + not-found.tsx and retryable educator-facing errors throughout. Live verify needs migration 0004.
- 2026-06-11 — **M6 code complete.** App-side static-site build (`buildSite` in renderer: index + worksheet pages + build-info with renderer version + .nojekyll), pushed to a clean `gh-pages` branch via the bridge (`publishToBranch` orphan commit) with Pages auto-enabled (`enablePages`). Release gates (license/content/IDs/public-private separation) + Tier-3 confirm gate publishing; in-app student-page preview via `/site-preview` (same build path). Build runs in-process for v0.1 (queue/worker deferred). 99 unit tests green. Live verify needs Pages:write on the App.
- 2026-06-11 — **M5 code complete.** GitHub bridge with native fetch + node:crypto (RS256 App JWT, installation token, Git Data API commits, generate-from-template) — no Octokit; commit transport enforces the two-repo invariant (adversarial-tested). Web: connect publishing, sandbox→GitHub graduation (paired repos + separate public/private commits), save→commit, version list, restore. Migrations 0003 + GitHubAppSetup.md. 88 unit tests green. Live verify pending the user's GitHub App.
- 2026-06-11 — **M4 code complete.** `.md.html` dual-extension export: `buildMdHtml`/`extractMdHtml` in `@alembic/renderer` with a `data-orz-format` version marker (legacy = format 0), byte-identical source round-trip, embedded source hash; download routes + buttons for study guide and worksheets; `export.dual-extension` events. Candidate for extraction into the shared `orz-artifacts` package (consolidation Phase B) once the registry is reachable. 82 unit tests green.
- 2026-06-11 — **M3 code complete.** Derived-artifact records + hash-based staleness (package-contract); ai-assist drafting + worksheet generation over the swappable provider with ID-preservation (strip/reattach); governed provider wrapper (per-user rate limit + `ai_invocations` governance log, migration 0002); editor AI draft flow + worksheet panel (generate/regenerate/keep-mine); ai.* research events. 76 unit tests green; Gemini `gemini-2.5-flash` live-verified. **To use in-app AI: apply `supabase/migrations/0002_ai_invocations.sql`.**
