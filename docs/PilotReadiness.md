# Pilot Readiness (v0.1)

The end-to-end product is built and deployed at **https://alembic.orz.how**.
Two of the six v0.1 release criteria remain open because they can only be met by
a real educator using the live system:

- **Criterion #1** — a non-developer completes the full loop without ever
  meeting a Git/developer term.
- **Criterion #6** — a pilot chemist's verdict is positive.

This runbook is the path to closing them. It has four parts, in order:

1. **Operator setup** — the env/dashboard delta beyond the base deploy.
2. **Live-verification passes** — exercise the flows that have never run against
   a live gateway, so the pilot doesn't surface our bugs.
3. **The M8.3 pilot** — the protocol, mapped to criteria #1 and #6.
4. **After the pilot** — read the de-identified export; triage frictions.

Base deployment steps (Vercel project, domain, auth/App callbacks) live in
[Deployment.md](Deployment.md); do those first.

---

## Part A — Operator setup (delta beyond the base deploy)

All of these are **operator actions** (Supabase dashboard / Vercel env) — not
code. Check each off before the live passes.

- [ ] **Migrations 0005–0011 applied** to the production Supabase project
  (the base guide originally listed only 0001–0004). Confirm `profiles`,
  `suggestions`, `portal_reports`, and `ai_invocations` exist.
- [ ] **`SUPABASE_SECRET_KEY`** set in Vercel (Production) — required for
  `/admin` and the research export.
- [ ] **AI gateway (Portkey)** wired in Vercel: `AI_GATEWAY_URL`,
  `AI_GATEWAY_API_KEY`, `AI_MODEL_DEFAULT`, `AI_MODEL_STRONG` (Model-Catalog
  `@<provider-slug>/<model>` form). The app prefers the gateway when the URL +
  key are present; otherwise it falls back to `GEMINI_API_KEY`.
  > The local `node` egress to Portkey was blocked on the dev Mac (a managed-
  > machine firewall, not an Alembic bug), so the gateway path has only ever
  > been smoke-tested by `curl`. Vercel's egress is unrestricted — **first real
  > gateway call happens here.** Watch for it in Part B.
- [ ] **`RESEARCH_EXPORT_SALT`** set to a dedicated random value (keeps
  pseudonyms stable across exports).
- [ ] **Optional `AI_TOKEN_BUDGET`** set if you want per-user metering during
  the pilot.
- [ ] **Flag yourself admin** (after signing in once):
  `update profiles set is_admin = true where github_username = '<handle>';`
  then confirm `/admin` loads (no "needs the service key" notice).

---

## Part B — Live-verification passes

Run these yourself on the deployed site *before* handing it to an educator.
Each lists where it lives, what to do, and what a pass looks like. The AI passes
also validate the gateway end-to-end (Part A). Use the
[demo content](DemoContent.md) as your input throughout.

> **Why first:** every AI/reconcile/adaptation flow below has been unit-tested
> but never exercised against the live gateway + production DB together. A
> 10-minute sweep here keeps the pilot focused on *educator* friction, not ours.

### Core loop (re-confirm on prod)
- [ ] Create package → edit sections → **Save** → **Preview** renders chemistry
  (`H~2~O`, `$\ce{...}$`) and math correctly.
- [ ] **Download .md.html** opens standalone and round-trips its embedded source.

### AI — Tier A (single-call) — *exercises the gateway*
- [ ] **M23 question / worksheet generation** — tick sections → *Generate
  worksheet* → a coherent worksheet is produced and opens via **View**.
- [ ] **M9.6 draft-from-plan** — with a concept map + objectives present, draft a
  section; confirm the draft reflects the planned objectives, not generic prose.
- [ ] **Gateway sanity** — after the first AI call, `/admin` → **AI usage** shows
  a non-zero token count attributed to your handle. (If it's zero or the call
  errored, the gateway env is wrong — recheck Part A.)

### AI — coherence agent (Tier B, bounded)
- [ ] **M18 whole-course coherence** — *🧭 Review whole-course coherence*
  produces a `ProposedChangeSet` you can review item-by-item; approving applies
  it; block IDs are preserved.

### Reconcile & external edits
- [ ] **M20 reconcile** — edit a published file directly on GitHub, then
  *Reconcile* in the editor: the external change is detected and offered
  (take/keep), and `last_synced_sha` advances.
- [ ] **M21 leakage audit** — *Scan public repo for leaks* reports clean on a
  normally-published package (the two-repo invariant holds).

### Adaptation & portal (cross-owner)
- [ ] **M26–M27 adapt + pull-updates** — adapt one of your own public packages;
  `provenance/adaptations.json` records lineage; change the source, then
  *pull updates* surfaces the drift (take/keep).
- [ ] **M28 / M31.2 suggest-back** — send a suggestion to a source package; it
  lands in that owner's **Suggestions inbox** (RLS-gated, no service role).
- [ ] **M31.1 cross-owner adapt** — adapt a *different* account's public package;
  confirm it reads via public GitHub (works without RLS bypass).
- [ ] **M32/M33 portal** — package appears on **Discover**; search + facet
  filters work; report/governance toggles function from `/admin`.

### Standards & metadata
- [ ] **M30 structured data** — run a published student page through Google's
  [Rich Results / structured-data test](https://search.google.com/test/rich-results):
  the `LearningResource` JSON-LD is detected and valid.
- [ ] **M25 LMS export** — export QTI 1.2 / Common Cartridge; the `.zip` opens
  and (ideally) imports into a test LMS sandbox.

### The hard invariant (do not skip)
- [ ] On every published package, the **public repo history contains no
  `private-instructor` path** — answer keys / instructor notes never leaked,
  even transiently. Spot-check:
  `gh api repos/<you>/<pkg>-oer/git/trees/main?recursive=1 | grep -i private` → empty.

Log anything that fails as a friction item (Part D) and fix blockers before the
pilot; cosmetic issues can ride along.

---

## Part C — The M8.3 pilot

**Goal:** 1–3 chemistry educators (non-developers) each complete the full loop
unaided, and give a verdict. This is what closes criteria #1 and #6.

### Setup
- Recruit 1–3 chemistry instructors who are *not* developers.
- Give each only two links: the [Quickstart](Quickstart.md) and the live site.
  Do **not** coach them — watching where they get stuck *is* the test.
- Have the [demo content](DemoContent.md) ready as a fallback topic if they'd
  rather not bring their own.

### The task (what "the full loop" means — criterion #1)
Ask them to, start to finish, on their own:
1. Sign in and create a package.
2. Write a short study guide (2–4 sections) using real chemistry notation.
3. Use **AI draft** and **Generate worksheet** at least once each.
4. Add a concept map + a couple of learning objectives.
5. **Download .md.html** and reopen it.
6. **Connect publishing → Publish to GitHub → Publish website**, then open the
   live student link.
7. **List on Discover**.

### What to observe & capture
- **Git-term leakage (criterion #1):** note *any* moment a developer/Git concept
  (commit, branch, repo, merge, SHA…) surfaced in UI, copy, or an error. Each is
  a defect — the educator should only ever see save/preview/publish/snapshot/
  restore/adapt/cite/share.
- **Stuck points:** every place they hesitated, re-read, or asked for help.
- **AI quality:** were drafts/worksheets useful enough to keep?
- **Verdict (criterion #6):** a direct yes/no — *"Would you use this for a real
  course next term?"* — plus one sentence why.

Capture lightly (a shared notes doc or a short debrief is fine). The
de-identified product-analytics signal is already collected automatically via
`research_events` — read it in Part D.

### Success bar
- **Criterion #1 passes** when at least one non-developer completes all seven
  steps with **zero** Git terms encountered and no hand-holding on the core
  path.
- **Criterion #6 passes** when the pilot chemist's verdict is positive (would
  use it / would recommend it), even if with caveats.

---

## Part D — After the pilot

- [ ] **Read the signal.** `/admin` → **Download CSV/JSON** for the de-identified
  research export (pseudonymous ids, public-safe event detail — no identities,
  no prompts/outputs). Cross-reference with **AI usage** and **Recent errors**.
- [ ] **Triage frictions.** Rank by how often they blocked the loop. The top
  few become immediate fixes; the rest feed Phase 8.
- [ ] **Flip the release criteria** in [Status.md](Status.md) (#1 and #6) once
  met, and mark **M8.3 ✅**. v0.1 is then *shipped*, not just deployed.
- [ ] **Revisit deferrals with real evidence.** M37 (institution-managed mode)
  was deferred specifically to be shaped by pilot needs; the worker tier, M29
  DOI, and per-institution quotas are likewise Phase-8 candidates. Let the pilot
  decide their priority.

---

## Quick reference — what's the assistant's vs. yours

| | Done in repo | Operator / you (deployed) |
|---|---|---|
| Setup | Deployment + this runbook, demo content | Vercel env, migrations, admin flag |
| Verification | unit tests (all green in CI) | the Part B live sweep |
| Pilot | the protocol above | recruiting + running it, the verdict |

The build is complete; what remains is operating it. Everything in Parts A–D
outside the repo needs a human at the dashboard and an educator at the keyboard.
