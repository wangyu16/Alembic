# AI Data-Handling Review (FERPA / IRB)

Closes the open compliance task from M16.4 (see [ai-architecture.md](ai-architecture.md))
and the data-governance half of Phase 7 (M36). Records what happens to prompt/
output data, where it is stored, and the obligations to honor before enabling a
hosted gateway for real student/educator data. **Per-deployment record** — fill
in the choices for each deployment.

## What data the AI path touches

- **Prompts** sent to the model: educator-authored study-guide text, restructure
  inputs, template specs, course context. May contain student-identifiable
  information only if an educator pastes it — discouraged; not required by any
  workflow.
- **Outputs**: generated prose / questions / suggestions.
- **Governance log** (`ai_invocations`): stores `prompt`, `output`, token counts,
  `kind`, `provider`, `model`, `user_id`. **RLS: owner-insert-only, no user
  select** — readable only by the service role (admin export). Never committed to
  either repo. The de-identified research export (M34, `/admin/export`) reads
  `research_events` and carries only pseudonymous ids + public-safe
  `research_events.detail` (**no prompts/outputs, and no AI token/kind data**).
  The AI **token/kind aggregates** are a separate concern: they read
  `ai_invocations` and are shown **in-app** in the admin dashboard (M36, `/admin`)
  — they are never exported.

## Where it goes (the gateway question)

Provider decision is **Portkey** (control plane) with Gemini behind it (see
[ai-architecture.md](ai-architecture.md)). A gateway centralizes logging (good)
but routes prompts through a third party. Before enabling it for real data:

1. **Confirm retention.** Determine what Portkey and each routed provider log/
   retain (request/response bodies, duration, region). **Prefer a no-retention /
   zero-data-retention mode**; disable provider-side training on inputs.
2. **Region / residency.** Confirm processing region meets institutional/IRB
   requirements; record it.
3. **FERPA.** Treat prompts as potentially containing education records. Either
   (a) ensure no PII is sent (the default — workflows don't require it and the UI
   should discourage pasting rosters/grades into prompts), or (b) execute the
   provider's data-processing terms covering FERPA before any PII flows.
4. **IRB.** The study's IRB protocol must cover third-party AI processing of
   participant-authored content; obtain consent language accordingly. Research
   logs stay separate from both repos (already enforced).

## Access model invariant

**No cross-owner educator workflow may use the service role.** Cross-owner
adaptation reads **public GitHub content** (no RLS bypass), and cross-owner
suggest-back goes through the RLS-gated `suggestions` table (consent = portal
registration). The service role (`lib/supabase/service`) is reserved
**exclusively** for the `requireAdmin`-gated research/ops surface (e.g. the M34
export, the M36 dashboard). This is the same fail-closed discipline as the
two-repo invariant: a future contributor must not add a "convenient"
service-role shortcut to an educator path.

## Decision record (per deployment)

| Item | Choice |
|---|---|
| Gateway / provider | _e.g. Portkey → Gemini_ |
| Retention mode | _e.g. zero-data-retention; no training on inputs_ |
| Processing region | _…_ |
| FERPA basis | _no-PII default / signed DPA_ |
| IRB protocol covers AI processing | _yes/no + ref_ |
| Date / reviewer | _…_ |

## Status

Governance **mechanism** is built (owner-insert-only logging, admin-only export,
de-identified research export, per-user budgets, gateway behind `AIProvider`).
The **review itself** is an operator/PI action to complete per deployment before
real student data flows through a hosted gateway; Gemini-direct dev use with
non-PII content is the current default. Per-institution quotas + a usage
dashboard: dashboard shipped (M36 admin); per-institution grouping is a follow-up
(needs an institution model).
