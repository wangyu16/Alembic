# Alembic Initial Release (v0.1) — Implementation Plan

Companion to [Roadmap.md](Roadmap.md) Phase 0–1 and [InitialRelease.md](InitialRelease.md). The target is the end-to-end loop from goal.md: **create a small chemistry module → outline concepts/study guide → edit blocks in the browser → AI-generate one derived artifact → export one dual-extension artifact → preview the student page → publish through the two-repo GitHub flow → register on a minimal index page → log basic research events — with public/private separation enforced throughout.**

Validation target: *one non-developer chemist finds this loop magical.*

---

## 1. Scope

### In scope (v0.1)

| Capability | Notes |
| --- | --- |
| GitHub OAuth sign-in | Identity only — no repo scopes on the OAuth token |
| Trial sandbox (no GitHub) | Server-side workspace; graduation path designed (data model ready), graduation UI may ship in v0.1.x |
| Package creation | From template; concepts + objectives as structured lists; package contract v1 |
| Study-guide block editor | Plain-text/Markdown block editing with live orz-markdown preview; block IDs validated on every save |
| AI assist (direct model calls) | Draft a section from a prompt or pasted raw text; generate **one** derived-artifact type: **worksheet** |
| Derived-artifact lifecycle (minimal) | Record source blocks + versions; flag stale when sources change; options: regenerate / keep mine (AI-merge deferred) |
| Dual-extension export | `.md.html` only (study guide / chapter notes) |
| Two-repo GitHub publish | GitHub App per-repo installation; paired public+private repos from templates; path-level public/private invariant on every commit |
| Static site build + Pages publish | Built app-side in the worker; build config also committed to the repo |
| Educator verbs | save, preview, publish, restore (restore = roll back to a previous save) |
| Release gates | Schema validation, block-ID integrity, public/private path check, license/metadata presence — must pass before publish/registration |
| Minimal portal index | A single generated public index page listing registered packages; no search UI |
| Research events | Append-only event log in Supabase (session, package, action, timing); no dashboards |

### Explicitly out of scope (v0.1)

Agent harness workers (direct model calls only) · Ketcher / structure editing (chemistry rendering via orz-markdown still works) · visual concept-map editor · Word/PDF import pipeline · question templates & assessment layer · adaptation/fork/suggest-back · snapshots & DOI · `.md.pdf`, `.slides.html` · searchable portal · LMS export · institution-managed mode · Tier-1/Tier-2 review machinery (v0.1 has exactly one gate class: Tier-3-style explicit approval for publish/registration) · multi-author anything.

Per [InitialRelease.md](InitialRelease.md): only must-have Git functions, surfaced as educator verbs. Git words (commit, branch, repo) appear only in an "advanced details" panel.

---

## 2. Architecture

### Stack

- **Web app:** Next.js (App Router) + TypeScript on Vercel.
- **Database:** Supabase Postgres — platform records (users, packages index, jobs, research events). All package *content* state is a rebuildable projection; repos are the source of truth.
- **Auth:** GitHub OAuth (via Auth.js or Supabase Auth) for identity; a separate **GitHub App** (installation tokens, per-repo) for repository operations.
- **Worker tier:** one small container service (Fly.io or Railway — pick whichever deploys fastest; the interface is a job queue, so the vendor is swappable) consuming jobs from a Postgres-backed queue (e.g. `pg-boss`). v0.1 jobs: static-site build + Pages push. Renderer version stamped into build metadata.
- **AI:** direct model calls from a server-side route, behind a thin provider-swappable interface (`AIProvider`). **Development phase: Google Gemini** (`@google/genai` SDK, `GEMINI_API_KEY`); Anthropic/Claude or another provider can be slotted in for the funded study without changing any workflow code. Per-user rate limits; prompts/outputs logged to a governance-flagged table.
- **Rendering:** orz-markdown everywhere — editor preview, student page build, `.md.html` generation.

### Monorepo layout

```
alembic/
  apps/
    web/                  # Next.js app (UI + API routes)
    worker/               # container worker: build + publish jobs
  packages/
    package-contract/     # schema, manifest, block-ID rules, validation, release gates (PURE, no IO)
    renderer/             # orz-markdown wrapper, student-page build, .md.html generation
    github-bridge/        # App auth, repo templates, commits, Pages publish, path invariant
    ai-assist/            # AIProvider interface + Gemini implementation (dev phase) + prompts
    research-events/      # event taxonomy + logger client
  docs/
```

**Modularity rules (enforced from day one):**
1. `package-contract` is pure TypeScript with no IO — the single owner of the schema. Web, worker, and bridge all consume it.
2. The editor UI calls **package operations** (an internal API: `createPackage`, `updateBlock`, `generateArtifact`, `save`, `publish`, `restore`) and never touches files, Git, or schema internals directly. This is what makes the workspace replaceable later.
3. `github-bridge` is the only code that talks to GitHub. The public/private path invariant lives here *and* in `package-contract` validation (defense in depth).

### Two-repo invariant (the non-negotiable)

- Repo templates: `<pkg>-oer` (public) and `<pkg>-private`. Manifest in the public repo links both.
- `package-contract` declares which package layers map to which repo. `github-bridge.commit()` takes a target repo + file set and **throws if any path's layer doesn't belong to that repo** — private-layer content cannot be staged to the public repo even transiently. There is no API to bypass this.
- Release gates re-check at publish time (second line of defense) and scan for answer-key/private markers in public content.
- Trial sandbox enforces the same layer separation so graduation can't leak.

### Data flow (publish path)

```
Editor (blocks) ─save→ package ops ─→ contract validation ─→ github-bridge commits
                                                            (public + private repos)
User clicks Publish ─→ Tier-3 approval screen (what changes, where it goes)
  ─→ release gates ─→ enqueue build job ─→ worker: checkout public repo,
     orz-markdown build, push to Pages branch ─→ status back to UI
  ─→ on success: register package metadata → regenerate portal index page
  ─→ research events logged at each step
```

---

## 3. Milestones

Sequenced so each milestone is demoable, and the riskiest integrations (orz-markdown, GitHub App, Pages build) are proven early. Estimates assume one developer working with AI assistance.

### M0 — Contracts & scaffolding (week 1–2)
- Monorepo, CI (typecheck, lint, test), Vercel + Supabase projects provisioned.
- **Package contract v1 spec written** (markdown doc + Zod schemas in `package-contract`): manifest, layers, block-ID rules, schema version field.
- orz-markdown spike: render a chemistry-flavored study guide; confirm block-ID syntax round-trips; confirm `.md.html` embed/extract works with a format-version marker. **File issues against orz-markdown now for anything missing.**
- ✅ *Exit:* a sample package round-trips parse→edit→serialize→validate in unit tests, IDs intact.

### M1 — Auth & shell (week 3)
- GitHub OAuth sign-in; user record in Supabase; app shell (nav, workspace layout).
- Trial sandbox workspace creation for signed-in users who haven't installed the App.
- ✅ *Exit:* sign in, land in an empty workspace.

### M2 — Package builder & block editor (week 4–6)
- Create package from template (title, course context, license picker, concepts/objectives lists).
- Study-guide block editor: heading-bounded blocks, edit Markdown text, live orz-markdown preview, add/reorder/delete blocks (delete = new-ID rule honored).
- Save = package op writing to sandbox storage; block-ID integrity validated on every save.
- Research-events logger wired in (`package.created`, `block.edited`, `save`, timings).
- ✅ *Exit:* author a 5-block chemistry mini-module in the browser and save it.

### M3 — AI assist & derived artifact (week 7–8)
- `AIProvider` interface + Gemini impl; prompt templates that carry orz-markdown ID-preservation rules.
- "Draft this section" (from prompt or pasted raw text) → educator reviews → accept/edit/reject (logged).
- Generate worksheet from selected blocks; artifact records source block IDs + versions; stale flag on source change; regenerate / keep-mine choice.
- ✅ *Exit:* generate a worksheet from study-guide blocks, edit a source block, see the stale flag, regenerate.

### M4 — Dual-extension artifact (week 9)
- `.md.html` export of study guide / chapter via `renderer`: rendered HTML + embedded versioned source; extraction tested against the spec.
- Download from UI; embedded-source hash recorded in provenance.
- ✅ *Exit:* download a `.md.html`, open it standalone in a browser, extract identical Markdown source.

### M5 — GitHub bridge & two-repo flow (week 10–12) ⚠ highest-risk milestone
- GitHub App registered; installation flow ("Connect publishing"); paired repo creation from templates.
- Save → commits with readable messages; path-level invariant enforced and **tested with adversarial cases** (private file via every API path).
- Restore (roll back to a previous save) and version list in educator language; advanced panel shows real Git details.
- Sandbox→GitHub graduation: initial commits from sandbox content (if time-boxed out, ship in v0.1.x — data model must support it now).
- ✅ *Exit:* edits land as commits in the right repos; a contrived private-leak attempt is provably impossible.

### M6 — Build, publish, preview (week 13–14)
- Worker service + job queue; build job: ephemeral checkout → orz-markdown static build → push to Pages branch; build config committed to repo too.
- Publish flow with Tier-3 approval screen and release gates; build failures surfaced in educator-facing language; renderer version stamped.
- In-app student-page preview (same renderer path as the real build).
- ✅ *Exit:* click Publish, get a live GitHub Pages URL.

### M7 — Portal index, gates polish, hardening (week 15)
- Package registration after gates → regenerate minimal public index page (hosted on Vercel or a Pages repo).
- Release-gate UX: failed gates explain what and why in educator language.
- Error states: build failure recovery, GitHub API failures, AI provider failures.
- ✅ *Exit:* published package appears on the public index page.

### M8 — Pilot & ship (week 16)
- Seed demo content; write a 1-page educator quickstart.
- **Pilot with 1–3 real chemistry educators**; watch them run the full loop; log everything; fix the top friction points.
- Deploy at `alembic.orz.how` (Cloudflare DNS → Vercel).
- ✅ *Exit (release criteria below).*

~16 weeks end to end; M2/M3 and M4 can overlap if a second contributor joins.

---

## 4. Release criteria (definition of done for v0.1)

1. A non-developer educator completes the full loop — create → edit → AI worksheet → `.md.html` download → publish → live Pages site — **without seeing a Git term** outside the advanced panel.
2. Private-layer content is demonstrably absent from the public repo's *entire history* (test, not assertion).
3. The published repo builds independently of Alembic with the committed build config (the no-lock-in test).
4. Block IDs survive: editor saves, AI rewrites, `.md.html` round-trip.
5. Research events captured for every loop step and exportable as CSV by an admin query.
6. The pilot chemist's verdict on the loop is positive ("magical" is the bar; "useful and painless" is the floor).

---

## 5. Risks & mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| orz-markdown gaps (IDs, embed/extract, build output) | Blocks everything downstream | M0 spike *first*; you own the parser — schedule fix-feedback loops; pin versions, stamp renderer version |
| GitHub App + Pages friction (permissions, Pages-from-branch quirks, token lifetimes) | Blocks the thesis feature | Start M5 spike early (during M3) with a throwaway repo; keep `github-bridge` isolated so reworks don't ripple |
| Two-repo invariant has a hole | Worst-case product failure (permanent leak) | Invariant in two layers (bridge + contract), adversarial tests in CI, gates as backstop; remediation procedure documented even in v0.1 |
| AI output breaks block IDs | Corrupts traceability silently | ID-preservation rules in prompts *and* post-generation validation that rejects ID-damaged output |
| Scope creep toward Phase-2 features (Ketcher, import, templates) | v0.1 never ships | This document is the scope contract; new ideas go to Roadmap phases |
| Worker tier over-engineering | Weeks lost on infra | v0.1 worker does exactly one job type (build+publish); queue interface keeps it swappable |
| Vercel/Supabase/worker split complexity for one dev | Operational drag | Single `docker-compose`/local-dev story in M0; worker is optional in local dev (build runs in-process locally) |

## 6. Decisions taken in this plan (flagging for your confirmation)

- **Worksheet** (not slides) as the single v0.1 derived artifact — simpler rendering, exercises the generate-then-own lifecycle just as well. Slides arrive with `.slides.html` in Phase 2.
- **Restore instead of snapshots** in v0.1 — "go back to a previous save" is the must-have; named immutable snapshots/citation are Phase 2.
- **Google Gemini as the development-phase provider** behind the swappable `AIProvider` interface (decided June 2026 — free-tier friendly for development). The provider-swappable requirement stands; the funded study can switch providers (e.g., Claude) without workflow changes.
- **pg-boss on Supabase Postgres** as the v0.1 queue — no extra infra vendor; swap to a dedicated queue if/when job volume demands.
- **Tier system deferred** except the Tier-3 publish/registration gate, which is architecturally mandatory from day one (loosening below Tier 3 must be impossible).
