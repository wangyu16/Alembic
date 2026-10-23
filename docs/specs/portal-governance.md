# Portal Governance (M33)

Discovery-hub governance for the grant period. Scaffolding now; the full
moderation + stewardship handoff is Phase 8 (goal.md §6 "Governance scaffolding").

## Registration eligibility — open to all educators

Listing a package on the public `/portal` index is **open to every signed-in
educator** (with a published package that passes the Tier-3 release gates). The
original grant-period participant-only gate (`profiles.portal_eligible`) has
been **removed** from `registerPackageAction`; the only requirements now are
GitHub-published + passing release gates.

The `profiles.portal_eligible` column, its `/admin` toggle, and the
`setPortalEligibleAction` server action have been **removed** (admin UI cleanup;
column dropped in migration `0013`).

## Reporting & takedown

- **Report:** anyone (signed-in or anonymous) can report a listed package from
  the portal (a reason → `portal_reports`, status `open`). RLS allows insert by
  all and **read by no normal user** — only operators (service role / dashboard)
  review reports. (Phase 7's admin module surfaces them in-app.)
  **Rate limited** (Phase 5 Track A.6, 2026-10-23): 5 reports per 10 minutes
  and 20 per day per client address, counted in Postgres (`rate_limit_hit`,
  migration 0023; in-process until it is applied). Keys are an HMAC of the
  address — no address is stored. Each accepted report also logs a
  de-identified `portal.reported` research event (the reason's length, never
  its text). The in-app limit does not bind a client that inserts into
  `portal_reports` directly with the public anon key (RLS allows any insert);
  a database-side cap is an open item.
- **Review:** an operator reads `portal_reports` (dashboard), assesses, and sets
  `status` to `resolved` / `dismissed`.
- **Takedown:** to remove a listing, either the **owner unlists** it
  (`unregisterPackageAction`) or an **operator removes** the `portal_registrations`
  row (dashboard). Removing the listing takes it off discovery **at once** — the discovery index
  ([discovery-index.md](discovery-index.md)) drops the course in the same
  transaction, by trigger, and search re-checks the listing live; it does not
  delete the owner's repos (repos are the source of truth and remain the owner's
  — account-lifecycle/transfer is Phase 8).

## Deferred to Phase 8

- Open registration with moderation (lift the participant-only gate).
- Named stewardship + handoff; in-app admin/moderation UI (Phase 7).
- Abuse controls beyond the RLS gates: ~~rate limits on reports~~ ✅ built
  (Track A.6, above); a database-side cap on direct `portal_reports` inserts
  and limits on registration remain.
