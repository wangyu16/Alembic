# Blind-critique review — operator guide (Alembic)

How to run the acceptance review of Alembic with the `blind-critique` skill
(context-denied verifier agents + a free-roam critic). The reviewers' ONLY
project artifact is [acceptance-spec.md](acceptance-spec.md) — frozen
2026-08-28, before the storage/write-path implementation it verifies.

## The blindness contract (non-negotiable)

Each verifier receives EXACTLY: (1) its block(s) of the acceptance spec,
(2) the Environment sheet (below), (3) the harness location. It is DENIED:
this repository, all docs/ content, git history, the implementation
conversation, and any statement of what changed. Include in every prompt:
*"If you catch yourself wanting source code to explain a behavior, that
behavior is simply what the product does — judge it."* The free-roam critic
gets even less — only the product promise below and an empty course.

**Product promise (for the free-roam critic, verbatim):**
> Alembic is a free web platform where an educator — with no Git or web
> skills — builds a course as chapters (study guide, slides, practice, and
> private instructor material), publishes it as a public course website
> stored in their own GitHub account, keeps every version of every change,
> and can share the course openly for other educators to adapt. Sign in,
> build a small two-chapter course from scratch, publish it, view it as a
> student, change something, publish again — and complain about everything
> confusing, slow, dead-ended, or surprising, with what you expected in
> each case, ending with: would you keep using it?

## Environment sheet (operator prepares; one per review round)

Never run verifiers against real educators' data. Prepare either a local
instance (`pnpm dev:web` + dev Supabase + a test GitHub App) or a staging
deployment. Then:

1. **Accounts:** one test-educator login per concurrent verifier (verifiers
   mutate and delete). Each account: GitHub connection completed; AI
   approved on at least one account (Block G) and unapproved on another
   (G1). Record how a verifier authenticates (storage-state file for
   Playwright is simplest — pre-login each account once and export).
2. **Isolation:** verifiers create/modify ONLY packages whose titles carry
   their tag (e.g. `[V2] …`). SEED-B/C/E are per-verifier copies when
   blocks run concurrently (B, C, D, E all mutate). State every shared
   resource they must not touch.
3. **Seeds** (create through the app UI/API, never raw DB rows): SEED-A–F
   as specified in the spec's Launching section. Validate every seed
   yourself once (open it, see it) before any verifier runs. For E4,
   include in the sheet the exact GitHub web-edit steps and the file to
   edit (this is app-external, so naming GitHub here is allowed).
4. **Harness:** Playwright (headless) available; note viewports 1280px and
   375px; screenshots directory per verifier.
5. **Sheet contents:** app URL, per-verifier credentials/storage-state
   paths, seed IDs/URLs, GitHub accounts for D5/D6/E4 checks, what to tear
   down afterwards.

## Running the round

1. Split: Blocks A+B / C / D+E / F+G / H → up to five verifiers (fewer is
   fine sequentially; concurrent needs per-verifier seeds). Prompt
   templates: `~/.claude/skills/blind-critique/references/prompt-templates.md`.
2. Spawn the free-roam critic with the promise paragraph + a fresh empty
   account only.
3. Verdict discipline is in the spec (PASS/PARTIAL/FAIL/BLOCKED, evidence,
   friction-on-PASS, BLOCKED over silent skip).
4. **Referee:** reproduce every FAIL/PARTIAL yourself before fixing;
   not-reproduced findings are recorded as such with evidence, not fixed.
   Judge against the spec — the spec outranks implementation intent; if a
   finding faults the spec, amend it in the spec's Amendment log, dated.
5. **Re-verify with FRESH agents** (a used verifier is no longer blind):
   failed items + one-line spot-checks of other fixes. Repeat until clean.
6. Triage free-roam complaints separately; fix the top ones; record the
   deferred rest by name.
7. **Record the residue**: what no agent could verify (real GitHub Pages
   propagation delays, email, long-horizon versioning, multi-week terms)
   goes in the round's report so a human knows what still needs eyes.

## Reports

Each round writes `docs/blind-critique/rounds/<date>-report.md`: per-item
verdicts with evidence, referee decisions, fixes applied, spec amendments,
deferred free-roam findings, residue. Status.md links the round.

## Known sharp edges for the operator

- **GitHub OAuth in Playwright**: pre-authenticate manually and export
  storage state; do not make agents solve GitHub login/2FA.
- **AI items cost tokens**: Block G runs against the configured provider;
  use the cheap route/test budget.
- **Pages build latency** (D2/D4): tell verifiers to allow a bounded wait
  (e.g. 3 minutes) before judging.
- **Never seed via SQL** — every seed goes through the product, or the
  round wastes itself on BLOCKED items.
