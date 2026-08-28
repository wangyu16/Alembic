# Blind-critique rounds

One file per round: `<date>-report.md`, with per-item verdicts + evidence,
referee decisions (including findings that did NOT reproduce), fixes applied,
spec amendments, deferred free-roam findings, and the residue.

**No round has been run yet.** See
[../README.md](../README.md) for the operator procedure and
[../acceptance-spec.md](../acceptance-spec.md) for the frozen spec.

## Why the first round has not run (2026-08-28)

The method's one unacceptable failure is verifiers operating on real data.
This machine's `apps/web/.env.local` points at the **production** Supabase
project and a live GitHub App, so running context-denied agents here would
create, mutate, and delete packages in real educator accounts. The round
therefore needs an operator step that cannot be automated from this
repository:

1. A **separate staging environment** — its own Supabase project (migrations
   `0001`–`0020` applied, including `0020_staging_bucket.sql`) and a **test**
   GitHub App installed on a throwaway org/account.
2. **One test-educator account per concurrent verifier**, each with the
   GitHub connection already completed and a Playwright storage-state file
   exported (agents must never be asked to solve GitHub login/2FA).
3. **AI entitlement**: one account approved, one not (acceptance Block G
   needs both).
4. **Seeds A–F created through the app itself** (never raw SQL), then
   validated by the operator once before any verifier runs.
5. **Isolation proven before spawning**: each verifier's packages tagged, and
   the operator confirming the tagging/isolation actually holds.

Until that exists, every acceptance item is **UNVERIFIED BY THE METHOD** —
the code-level gates (typecheck, unit/adversarial tests, production build)
are not a substitute, and this project's own history is the argument: the
bugs that prompted this work all passed those gates.
