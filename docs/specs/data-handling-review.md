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
  `research_events` and carries only pseudonymous ids + the **allow-listed**
  `research_events.detail` keys (**no prompts/outputs, and no AI token/kind
  data**; see "Research events" below).
  The AI **token/kind aggregates** are a separate concern: they read
  `ai_invocations` and are shown **in-app** in the admin dashboard (M36, `/admin`)
  — they are never exported.

## Where it goes (the gateway question)

Provider decision is a **self-hosted LiteLLM gateway** (control plane, on the
owner's VPS; decided 2026-08-28, replacing the earlier Portkey choice) with
Gemini behind it (see [worker-tier.md](worker-tier.md) §1.5 and
[ai-architecture.md](ai-architecture.md)). Self-hosting keeps the gateway's own
logs under the operator's control; the provider behind it still needs the checks
below. A gateway centralizes logging (good)
but routes prompts through a third party. Before enabling it for real data:

1. **Confirm retention.** Determine what the gateway and each routed provider log/
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

*(Drift noted 2026-10-23: since P1/P2/P4 (2026-07-06) the service role also
backs three registry reads that the owner-only `documents` RLS cannot express —
the permalink resolver `/d/{docId}`, Discover's Elements list, and
`adaptElementAction`'s source lookup. Each is limited to public files of
published packages (Phase 5 Track 0.2/0.3); private and trial files are checked
against the visitor's own session. The public-safe discovery projection
(Phase 5 Track A.1) is meant to replace these service-role reads.)*

*(Phase 5 Track A.1–A.4, 2026-10-23: **Discover's Elements list no longer
uses the service role** — it, the course search and the course/element pages
read the public discovery index (`discovery_courses`, `discovery_elements`)
through the anonymous client, whose read policy serves listed courses and
shared elements only; `documents` stays owner-only. Cross-owner course
adaptation now checks the source is listed in that index (not the
listing-time snapshot). Two service-role reads remain: the `/d/{docId}`
resolver (it must read a public file's registry row to serve its bytes) and
`adaptElementAction`'s source lookup (it reads the source file's bytes);
both stay limited to public files of published packages.)*

*(Phase 5 Track A.6–A.7, 2026-10-23: two more server-side, non-educator uses,
both write-only and narrow — the report rate limit's counters
(`rate_limit_hit`, executable by the service role only) and **anonymous
visitors' discovery events**. A signed-in visitor's events go through their
own session; an anonymous visitor has no session, so the server writes the
event with **no participant** (`user_id` null, migration 0023). Discovery
events are de-identified by construction (`apps/web/src/lib/discovery-events.ts`):
a search records the query's length and term count and the NAMES of the
filters set — never the text or the values; a report records the reason's
length; no docId, path, IP or fingerprint is ever recorded; the package sits
only in the package column, which the export pseudonymizes. Rate-limit keys
are an HMAC of (bucket, client address) under a server secret and are swept
after two days; addresses themselves are never stored.)*

*(Phase 5 hardening, 2026-10-23: filing a portal report is a third such use —
`file_portal_report` (migration 0024, service role only) is now the only
insert path into `portal_reports`; it stores what the direct insert stored
(package, reason, the signed-in reporter or null) and adds per-package and
global caps keyed by an md5 of the package id. The research export is paged
— same de-identification, same columns, streamed in batches.)*

*(Security loop r1 M1, 2026-10-23: **research events are written by the
server only.** Every `research_events` insert — educator workflows and
discovery alike — goes through one server-side writer
(`apps/web/src/lib/events.ts`) using the service role, write-only; the
browser session is no longer used and migration 0025 removes the
"insert own events" policy and the API roles' insert grant. Deploy the code
before applying 0025. See "Research events" below.)*

## Research events: what `detail` may hold

`detail` is filtered by a per-event-type allowlist
(`packages/research-events/src/allowlist.ts`, exhaustive over the event enum)
at **write** time and again at **export** time. Only these value shapes are
kept, each only under a key listed for that type: a non-negative count, a
boolean, a value from a closed vocabulary, a short lower-case token
`[a-z0-9._-]{1,40}` (kinds, modes, surfaces, licences), or a package/doc id.
On export every kept id (`source`, `sourcePackageId`, `sourceDocId`,
`toPackageId`) is pseudonymised with the same salted function as the package
column. Never kept: URLs (a site URL carries the GitHub login), repository
names, logins, file paths, filenames, snapshot names, commit SHAs, content
hashes, chapter slugs, raw error messages or any other free text. An unknown
event type, an unknown key or a value of the wrong shape is dropped (fail
closed), which also cleans rows stored before the allowlist existed. A new
detail key must be added to the allowlist, or it is not recorded.

## Decision record (per deployment)

| Item | Choice |
|---|---|
| Gateway / provider | _e.g. LiteLLM (self-hosted) → Gemini_ |
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
