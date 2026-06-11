# Alembic Status Tracker

Live view of what is done, in progress, and coming. Update this file in the
same commit as the work it tracks. Statuses: ✅ done · 🔄 in progress · ⬜ pending · ⏸ deferred.

**Current focus: v0.1 (Phase 1) — milestone M1 (auth & shell).**

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
| 1.1 | Supabase project + schema (users, packages, events tables) | migration applies; tables queryable | ⬜ |
| 1.2 | GitHub OAuth sign-in (identity only) | sign in/out round-trip; user row created; no repo scopes on token | ⬜ |
| 1.3 | App shell (nav, workspace layout, route structure) | authed layout renders; unauthed redirect | ⬜ |
| 1.4 | Trial sandbox workspace (server-side storage, layer-aware) | create sandbox package; layers enforced in storage paths | ⬜ |

### M2 — Package builder & block editor

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 2.1 | Package operations API (create/read/update/save; UI-independent) | unit tests against sandbox storage; no UI imports | ⬜ |
| 2.2 | Package creation flow (title, course context, license, concepts/objectives lists) | created package validates against contract | ⬜ |
| 2.3 | Block editor UI (add/edit/reorder/delete heading-bounded blocks) | manual: author 5-block module; delete honors new-ID rule | ⬜ |
| 2.4 | Live orz-markdown preview pane | chemistry sample renders while typing | ⬜ |
| 2.5 | Block-ID integrity validation on every save | corrupted-ID save is rejected with educator-facing error | ⬜ |
| 2.6 | Research event wiring for authoring steps | events rows appear for create/edit/save with timings | ⬜ |

### M3 — AI assist & derived artifact

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 3.1 | Server AI route + per-user rate limiting + governance log | prompt/output logged; limit enforced; key never reaches client | ⬜ |
| 3.2 | Draft-section flow (prompt/paste → draft → accept/edit/reject) | accepted draft lands as valid blocks; decision events logged | ⬜ |
| 3.3 | Worksheet generation from selected blocks | artifact records source block IDs + revisions | ⬜ |
| 3.4 | Stale flagging + regenerate / keep-mine | editing a source block flags the artifact; both choices work and are recorded | ⬜ |
| 3.5 | ID-preservation prompt rules + post-generation validation | AI output that damages IDs is rejected automatically | ⬜ |

### M4 — Dual-extension artifact

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 4.1 | `.md.html` generator (rendered HTML + versioned embedded source) | file opens standalone in a browser | ⬜ |
| 4.2 | Source extraction + embedded-source hash in provenance | extract returns byte-identical Markdown; hash recorded | ⬜ |

### M5 — GitHub bridge & two-repo flow

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 5.1 | GitHub App registration + installation flow ("Connect publishing") | App installs scoped to created repos only | ⬜ |
| 5.2 | Paired repo creation from templates (public + private) | both repos created with correct layout, manifest links them | ⬜ |
| 5.3 | Commit transport (Octokit) behind `validateCommitPlan` | adversarial private-leak attempts impossible via every API path | ⬜ |
| 5.4 | Save → readable commits; version list; restore | restore round-trip works; history readable in educator language | ⬜ |
| 5.5 | Sandbox → GitHub graduation | sandbox content becomes initial commits with provenance preserved | ⬜ |

### M6 — Build, publish, preview

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 6.1 | Job queue (pg-boss on Supabase) + worker consumption | enqueued job runs in worker; status reported back | ⬜ |
| 6.2 | Build job: ephemeral checkout → static build → Pages push | live GitHub Pages URL; renderer version stamped; build config committed | ⬜ |
| 6.3 | Publish flow: Tier-3 approval screen + release gates | gates block bad packages with educator-facing reasons; approval required | ⬜ |
| 6.4 | In-app student-page preview (same renderer path as build) | preview matches published output | ⬜ |

### M7 — Portal index & hardening

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 7.1 | Package registration + generated public index page | published package appears on index after gates | ⬜ |
| 7.2 | Failure recovery UX (build, GitHub API, AI provider failures) | each failure mode shows actionable educator-facing message | ⬜ |

### M8 — Pilot & ship

| # | Sub-module | Verify by | Status |
| --- | --- | --- | --- |
| 8.1 | Demo content + educator quickstart (1 page) | a new user can follow it unaided | ⬜ |
| 8.2 | Deploy at alembic.orz.how (Cloudflare DNS → Vercel) | production URL serves the app | ⬜ |
| 8.3 | Pilot with 1–3 chemistry educators; fix top frictions | full loop completed by a non-developer; release criteria met | ⬜ |

## Release criteria (v0.1)

Tracked in [InitialReleasePlan.md](InitialReleasePlan.md) §4 — all six must
hold before calling v0.1 shipped.

## Log

- 2026-06-11 — M0.1, M0.2 complete; repo live at github.com/wangyu16/Alembic; CI green. M0.3 spec + M0.4 spike started.
- 2026-06-11 — **M0 complete.** Contract spec written (docs/specs/package-contract-v1.md); orz-markdown spike done: heading block IDs work natively via `{{attrs[#blk-…]}}`; 5 upstream gaps filed in the table above (none block M1–M2). CLAUDE.md + this tracker added.
