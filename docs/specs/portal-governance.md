# Portal Governance (M33)

Discovery-hub governance for the grant period. Scaffolding now; the full
moderation + stewardship handoff is Phase 8 (goal.md §6 "Governance scaffolding").

## Registration eligibility — open to all educators

Listing a package on the public `/portal` index is **open to every signed-in
educator** (with a published package that passes the Tier-3 release gates). The
original grant-period participant-only gate (`profiles.portal_eligible`) has
been **removed** from `registerPackageAction`; the only requirements now are
GitHub-published + passing release gates.

`profiles.portal_eligible` (migration `0010`) and its `/admin` toggle remain in
the schema/UI but **no longer gate anything** — they are vestigial and may be
dropped in a later cleanup.

## Reporting & takedown

- **Report:** anyone (signed-in or anonymous) can report a listed package from
  the portal (a reason → `portal_reports`, status `open`). RLS allows insert by
  all and **read by no normal user** — only operators (service role / dashboard)
  review reports. (Phase 7's admin module surfaces them in-app.)
- **Review:** an operator reads `portal_reports` (dashboard), assesses, and sets
  `status` to `resolved` / `dismissed`.
- **Takedown:** to remove a listing, either the **owner unlists** it
  (`unregisterPackageAction`) or an **operator removes** the `portal_registrations`
  row (dashboard). Removing the listing takes it off discovery; it does not
  delete the owner's repos (repos are the source of truth and remain the owner's
  — account-lifecycle/transfer is Phase 8).

## Deferred to Phase 8

- Open registration with moderation (lift the participant-only gate).
- Named stewardship + handoff; in-app admin/moderation UI (Phase 7).
- Abuse controls (rate limits on reports/registration) beyond the RLS gates.
