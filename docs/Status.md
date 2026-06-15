# Alembic Status Tracker

Live view of what is done, in progress, and coming. Update this file in the
same commit as the work it tracks. Statuses: ✅ done · 🔄 in progress · ⬜ pending · ⏸ deferred.

**Production:** live at https://alembic.orz.how (Vercel project `alembic`, root `apps/web`, Node 22; Cloudflare DNS; Git auto-deploy on push to `main`).

**Current focus: v0.1 (Phase 1) — milestone M8 (pilot & ship).** M1–M6 live-verified end to end, including a live GitHub Pages student site (https://wangyu16.github.io/test-chemistry-gegpm8vz-oer/) and production deploy (M8.2). Remaining before declaring v0.1 shipped: the pilot (M8.3) and the open items in "Release criteria" below (notably the no-lock-in build config). M7 portal live-verify needs migration 0004 applied to the Supabase project. See [LocalSetup.md](LocalSetup.md) + [GitHubAppSetup.md](GitHubAppSetup.md).

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
