# AI Architecture — execution & model access (design note)

Forward-looking design decision for how Alembic employs AI. **Not a v0.1
change** — v0.1 uses direct, single-call model access via the `AIProvider`
interface (`packages/ai-assist`, Gemini). This note records the options, the
comparison, and the rationale for the next phases.

Related: [goal.md](../goal.md) §2 AI Orchestration, §3 Agent Harness, §11 AI
Credits · [Roadmap.md](../Roadmap.md) Phase 3 · CLAUDE.md rule 6 (provider-swappable).

---

## The question

The original plan runs a container worker executing a coding-agent harness
(Claude Code / Codex) for package-wide organization and editing. Powerful — but
is it the right default given cost and a growing user base? Or should we route
through a gateway (OpenRouter / Portkey) and pick a model per task?

**These are two independent axes**, and the answer combines them:

- **Execution** — *how* the AI works: a single request/response call vs. an
  **agent harness** (multi-step, tool-using, repo-aware, sandboxed checkout).
- **Model access** — *how we reach the model(s)*: direct provider SDK vs. a
  **gateway** that routes, falls back, meters, and selects models per task.

A gateway sits *under* both. So decide each axis separately.

## What makes Alembic distinctive: the Tier-B course-coherence agent

A course is **one package spanning many modules — tens to hundreds of files**
(study guides, slides, worksheets, question templates, concept maps,
objectives). Keeping all of that **coherent and consistent** as it grows —
terminology aligned across modules, objectives traceable to content,
cross-references valid, derived artifacts in sync with their source blocks,
prerequisites ordered sensibly — is work no single-call edit can do. **This
whole-package coherence agent is the differentiator and worth investing in,**
even though it is the expensive tier.

But it is **not the common case.** The majority of educator work is **local
editing** of one section/artifact at a time — which a single model call handles
cheaply.

So: **a mixed approach.**

| Tier | Work | Frequency | Execution | Cost |
| --- | --- | --- | --- | --- |
| **A — local** | draft/rewrite a section, generate a worksheet/question, alt-text, accessibility/license checks, explain a change | the 90%+ | single structured model call (today's `AIProvider`) | low; serverless-scalable |
| **B — package-wide** | keep the whole course coherent: cross-module consistency, objective↔content traceability, regenerate affected artifacts together, large import → structured package | occasional, high-value | **agent** over the package in the container worker tier | high per run → gate it |

## Teaching documents are not software — so verification is lighter

A coding agent leans on compilers, type-checkers, and test suites as its safety
net. Teaching materials have **no such hard oracle**, and don't need one. That
reshapes the Tier-B agent in two ways:

- **The agent optimizes for coherence and pedagogy, not provable correctness.**
  Its "checks" are advisory (consistent terminology, no orphaned concepts,
  cross-refs resolve, artifacts not stale) — surfaced for the educator, not
  enforced as build gates.
- **The educator is the real verification gate, not automated tests.** This is
  goal.md's risk-tiered approval: Tier-3 review before publish. The agent
  proposes a coherent set of changes + an explanation; the human approves.

Two invariants stay *hard* regardless (they're correctness, not taste):
**public/private separation** and **block-ID integrity** — enforced by the
package contract on every commit, agent or not. Everything else is
review-and-judgment, which is *cheaper and simpler* than a code agent's
gauntlet — no sandboxed test runs, just contract checks + educator review.

## Execution options compared

| Option | Fit | Pros | Cons |
| --- | --- | --- | --- |
| **Direct structured calls** (v0.1) | Tier A | cheapest, fastest, serverless-scalable, simple | can't reason across many files |
| **App-orchestrated bounded agent** (recommended for Tier B) | Tier B | app owns the toolset (read/write-block, list, validate) and enforces invariants between steps; predictable cost; no bash/FS sprawl | more to build than dropping in a CLI |
| **Open-ended coding-agent CLI** (Claude Code / Codex in a container) | heavy Tier B / power users | maximal capability, repo-native | most expensive + operationally heavy (sandbox, queue, checkout); overkill and risky for prose |

**Recommendation:** keep direct calls as the default; build Tier B as a
**bounded, app-orchestrated agent** (the Claude Code SDK may be the *engine*,
but with a tight, package-aware tool surface rather than full filesystem/bash
access). Reserve a full coding-agent CLI for genuinely power-user, multi-file
operations, gated and quota'd.

## Model access: a gateway under `AIProvider`

Independent of execution, put a gateway behind the existing `AIProvider`
interface. This is the main cost/scale lever and almost pure upside.

| Approach | Best for | Notes |
| --- | --- | --- |
| **Direct provider SDK** (today) | simplicity; best prompt-caching fidelity | one provider; manual multi-model |
| **OpenRouter** | breadth + simplicity, pay-as-you-go | huge model marketplace; lighter governance |
| **Portkey** | governance: per-user/org virtual keys, budgets, guardrails, observability, self-host | best fit for managed credits + data governance + institution billing |

What a gateway buys: **task→model routing** (cheap/fast model for drafts &
checks; strong model for restructuring & Tier-B reasoning — one model for
everything is the expensive mistake), **budgets & per-user/per-institution
quotas** (serves goal.md §11), **fallback**, and **usage observability**.
They compose — OpenRouter can run *through* Portkey. Lean **Portkey** as the
control plane for a research platform that needs quotas + governed logging;
OpenRouter if breadth/simplicity dominate.

## Cost & scale rationale

- Tier A is high-volume but cheap per call; on a flash-class model it stays
  negligible and scales on serverless.
- Tier B is low-volume but expensive per run (agent loops re-read many files;
  container minutes). At N users doing mostly Tier A, **agent runs dominate
  cost-per-action** → gate them (explicit action, quota, possibly a higher
  credit tier), don't run them for what a single call does.
- Task→model routing + budgets via the gateway keep the bill bounded and
  attributable as users grow.

## Caveats to weigh when building

1. **Prompt caching matters most for Tier-B loops.** Agents re-send large
   context each step; native-provider caching cuts that sharply, and a generic
   gateway hop can lose caching or tool-call fidelity. Gateways are unambiguous
   wins for Tier A; for Tier B, weigh routing closer to the native provider.
2. **Data governance.** A gateway centralizes logging (good) but routes prompts
   through a third party — for student/IRB data, confirm its data handling
   (Portkey self-host / data controls; OpenRouter forwards to providers). Ties
   to goal.md's governance rules.
3. **Harness ↔ endpoint compatibility.** Claude Code SDK expects an
   Anthropic-compatible endpoint; routing it through a gateway works only if the
   gateway preserves tool-use + caching.

## Fit with the current architecture

Nothing here requires reworking what exists:
- `AIProvider` already abstracts the model → an OpenRouter/Portkey provider is a
  drop-in, plus a small **task→model routing map**.
- The **Agent Workers** module (Roadmap Phase 3) is the home for Tier B *only*,
  not for all AI.
- The gateway operationalizes goal.md §11 (managed credits, BYO keys,
  institution billing, cost visibility).

## Decision status

- **v0.1 (now):** direct single-call `AIProvider` (Gemini). Unchanged.
- **Next (Phase 2–3):** add the gateway + task→model routing behind
  `AIProvider`; build Tier B as a bounded, app-orchestrated agent in the worker
  tier; keep public/private + block-ID invariants hard, everything else
  educator-reviewed.
- **Deferred / power-user:** open-ended coding-agent CLI for the heaviest
  multi-file operations, gated and metered.

## M16 status & open compliance task

Implemented (M16): a provider-swappable **gateway** (`GatewayProvider`,
OpenAI-compatible) selectable by env, **per-task model routing**
(`modelForTask`/`DEFAULT_ROUTING`), and an optional **per-user token budget**
(`recent_ai_token_usage` RPC + `AI_TOKEN_BUDGET`) atop the existing rate limit.
Usage is attributable via the `ai_invocations` governance log.

**Open (ops/compliance, not code):** before enabling a hosted gateway for real
student/educator data, complete a **data-handling review** — what the gateway
and each routed provider may log/retain, region/residency, and FERPA/IRB
obligations. Prefer a gateway mode that disables provider-side retention; record
the decision per deployment. Per-institution quotas and usage dashboards are
future work on top of the per-user budget.
