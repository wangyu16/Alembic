# Portal Governance (M33)

Discovery-hub governance for the grant period. Scaffolding now; the full
moderation + stewardship handoff is Phase 8 (goal.md §6 "Governance scaffolding").

## Registration eligibility (during the grant)

Listing a package on the public `/portal` index is **limited to study
participants**. Gate: `profiles.portal_eligible` (migration `0010`, default
`false`). `registerPackageAction` checks it and returns an educator-facing
"limited to study participants" message when not eligible. Unlisting and
publishing-to-GitHub are unaffected — only public *discovery listing* is gated.

**Operator action:** flag a participant by setting `profiles.portal_eligible =
true` for their user (Supabase dashboard) during onboarding. There is no in-app
admin UI yet (Phase 7 admin module).

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
