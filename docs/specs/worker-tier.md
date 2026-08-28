# Worker Tier — agent lane, platform-key model

**Status:** adopted (owner decision, **2026-08-28**).
**Revisit posture (owner):** choices here are expected to be re-evaluated as
the agent-infrastructure market shifts — not within ~a month of adoption, but
whenever the benefit of switching is significant. The **boundaries** (harness
seam, gateway, queue/job contract, review flow) are the durable part; vendors,
harnesses, and models swap beneath them.
**Related:** [goal.md](../goal.md) §3 (Agent Harness) + §11 (AI credits),
[ai-architecture.md](ai-architecture.md),
[educator-version-contract.md](educator-version-contract.md),
[Roadmap.md](../Roadmap.md) Module W,
[DecisionLog.md](../DecisionLog.md) 2026-08-28 (worker tier).

## 1. Decisions

1. **Platform-provided AI key; no BYO.** The platform supplies model access
   through its own key(s); the former "individual bring-your-own API keys"
   option is removed from the credit-model list (goal.md §11 amended).
   Consequences: **metering/credits on the entitlement seam become
   required-before-launch**, and **hard per-run budget caps are load-bearing**
   (every runaway loop is the operator's bill).
2. **Two execution tiers, kept separate.**
   - **Tier A — local single-file editing:** direct LLM calls through
     `AIProvider`/gateway with the designed system prompts of the
     ai-operations registry. **No agent SDK involved.**
   - **Tier B — package-level work:** coursewerk running as an agent in the
     worker tier (create many files, whole-chapter/package checks,
     consistency/coherence maintenance).
   - The ai-operations registry gains an `execution: "call" | "agent"` facet
     so one menu dispatches both.
3. **Two lanes, one vendor (Fly.io — the existing footprint).**
   - **Lane 1 — non-AI jobs** (paged/print generation, site builds, periodic
     reconciliation): the existing Fly worker, unchanged.
   - **Lane 2 — agent jobs:** Fly **Sprites** (or plain Machines — spike
     pending) running **the identical harness local coursewerk users run**,
     so local and hosted runs are testably equivalent (parity). Sprites'
     persistent-filesystem / sleeps-idle / active-CPU-billing profile matches
     coursewerk's staged, human-gated pipeline.
4. **Queue lives in Postgres (Supabase).** No new queue infrastructure.
5. **Key isolation — the sandbox never holds the master key.** Each job gets
   a short-lived **gateway virtual key with a hard budget cap**. Gateway
   (decided 2026-08-28): **self-hosted LiteLLM**, deployed on the owner's
   Oracle Cloud Always-Free A1 VPS (may migrate to an always-on Fly machine
   later — a config-only `AI_GATEWAY_URL` swap). Operating rules: upgrade the
   Oracle tenancy to PAYG (removes idle-reclamation of Always-Free compute),
   Cloudflare proxy/tunnel in front, LiteLLM state in Supabase Postgres,
   the whole deployment kept as code (redeployable in minutes anywhere), and
   a **direct-provider fallback** path in the web app as the degraded mode.
   Provider keys live only on the gateway host; Vercel and worker sandboxes
   hold only budgeted virtual keys. Supersedes the 2026-06-16 Portkey choice
   (Portkey was acquired by Palo Alto Networks, 2026-05, and folded into an
   enterprise security platform — no longer a fit for a free, solo-operated
   platform);
   egress is allow-listed (gateway + GitHub). Exfiltration is impossible by
   construction and the per-run cap is enforced *outside* the agent.
6. **Human gates → Inbox.** coursewerk's ⏸ pause gates surface as workspace
   review items (Module T); the sandbox sleeps (persistent state) while the
   educator reviews, resumes on response. Job outputs are **files/changesets,
   never commits**: validation (import gate, leakage audit, near-verbatim
   detector) → tiered review → `packageOps` apply → `github-bridge` commits.
7. **Watch list: Anthropic Managed Agents** (public beta since 2026-04;
   tokens + $0.08/active-session-hour; hard per-session dollar caps since
   2026-08-07). The only option that deletes harness ops entirely; today it
   is beta and would fork coursewerk off the local CLI harness. Re-evaluate
   at GA or in ~2 quarters, whichever first — the harness seam keeps the
   migration a swap, not a rework.

## 2. Ruled out (as of 2026-08-28)

- **GitHub Actions as job runner** — platform key in user-controllable
  workflow context is an exfiltration vector. Permanent exclusion.
- **Cloudflare Sandbox** — disk resets on sleep (breaks gate persistence),
  slowest cold starts of the cohort.
- **Modal** — sandbox price premium, GPU/Python-oriented; no fit advantage.
- **E2B / Daytona / Vercel Sandbox** — capable products, no advantage over
  the already-operated Fly footprint for a solo operator (E2B adds a Pro
  floor; Vercel's 24h session cap + snapshot-resume is clunkier for
  multi-day gates). Revisit with the market.

## 3. Open (under evaluation, not yet decided)

- **Harness selection** for the agent lane: Claude Code / Claude Agent SDK
  (mature harness, heavier) vs minimal plugin-based harnesses (pi-class) vs
  others. Criteria: coursewerk compatibility (it already ships
  CLAUDE.md/AGENTS.md/GEMINI.md — multi-harness by design), model-agnosticism
  (must drive cost-efficient non-Anthropic models), headless/CI operation,
  token overhead, maintenance burden.
- **Model mix**: flash-class model for drafting/mechanical QA plus a
  *different-family* mid-tier model for coherence/error-discovery critique
  (coursewerk Full mode is cross-model review by design). Routed via the
  existing per-task routing map; teaching documents don't need
  max-reasoning models, but package-wide consistency checking rules out
  older lightweight ones.
- **Sprites vs plain Machines** spike.

## 4. Cost model

Compute is noise; tokens dominate. A 30–60 min agent run ≈ $0.05–0.15 of
container time vs $1–10+ of tokens (model-dependent). Therefore: vendor
choice optimizes ops/persistence/isolation, not price; the real cost levers
are (a) the per-run token cap (virtual-key budget), (b) per-user credits and
quotas (entitlement seam), (c) task→model routing. Sleeping sandboxes between
gates cost ~nothing.
